import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { Engine } from './engine.js';
import type { RawTx } from './types.js';

export class Rpc {
  constructor(readonly url: string, private f: typeof fetch = fetch, private sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))) {}
  async call<T>(method: string, params: unknown[]): Promise<T> {
    for (let a = 0; a < 6; a++) {
      let r: Response;
      try { r = await this.f(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }); }
      catch (e) { await this.sleep(1000 * (a + 1)); if (a === 5) throw e; continue; }
      if (r.status === 429 || r.status >= 500) { await this.sleep(1500 * (a + 1)); continue; }
      const j: any = await r.json();
      if (j.error) { if (/rate|limit|429|too many/i.test(JSON.stringify(j.error))) { await this.sleep(1500 * (a + 1)); continue; } throw new Error(`rpc ${method}: ${JSON.stringify(j.error)}`); }
      return j.result as T;
    }
    throw new Error(`rpc ${method}: rate limited / unavailable after retries`);
  }
  sigs(addr: string, o: { before?: string; until?: string; limit?: number }) {
    return this.call<{ signature: string; slot: number; err: unknown; blockTime: number | null }[]>('getSignaturesForAddress', [addr, { limit: o.limit ?? 1000, commitment: 'confirmed', ...(o.before ? { before: o.before } : {}), ...(o.until ? { until: o.until } : {}) }]);
  }
  tx(sig: string) { return this.call<RawTx | null>('getTransaction', [sig, { encoding: 'json', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }]); }
  /** account existence + executable flag (for /watch validation) */
  async account(addr: string): Promise<{ executable: boolean; owner: string } | null> {
    const r = await this.call<{ value: { executable: boolean; owner: string } | null }>('getAccountInfo', [addr, { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }]);
    return r.value ? { executable: r.value.executable, owner: r.value.owner } : null;
  }
  async getAccountData(addr: string): Promise<{ owner: string; data: Buffer } | null> {
    const r = await this.call<{ value: { owner: string; data: [string, string] } | null }>('getAccountInfo', [addr, { encoding: 'base64' }]);
    return r.value ? { owner: r.value.owner, data: Buffer.from(r.value.data[0], 'base64') } : null;
  }
}

export interface PollOpts { maxPages?: number; backfill?: number; sleepMs?: number }

/**
 * Poll one watched address (program id or its programdata). Durable checkpoint = newest fully
 * processed signature; the next poll asks for everything newer (`until`), so a restart replays
 * what was missed. A transaction whose getTransaction is still null (not yet available) stops the
 * run BEFORE the checkpoint moves past it, so it is retried next poll instead of skipped.
 */
export async function pollAddress(engine: Engine, rpc: Rpc, address: string, o: PollOpts = {}): Promise<{ fetched: number; processed: number; skipped: number; stuck: boolean }> {
  const db = engine.db;
  const cp = db.prepare('SELECT last_signature FROM checkpoints WHERE program_id=?').get(address) as { last_signature: string | null } | undefined;
  const pages: { signature: string; slot: number }[] = [];
  let before: string | undefined;
  const maxPages = o.maxPages ?? 50;
  for (let p = 0; p < maxPages; p++) {
    const limit = cp?.last_signature ? 1000 : (o.backfill ?? 1);
    const batch = await rpc.sigs(address, { before, until: cp?.last_signature ?? undefined, limit });
    pages.push(...batch);
    if (batch.length < limit || !cp?.last_signature) break;
    before = batch[batch.length - 1]!.signature;
  }
  const now = engine.now();
  if (!cp) {
    // first run: start at head. Without backfill, mark newest signature as the checkpoint.
    const newest = pages[0];
    const take = o.backfill ? pages.slice().reverse() : [];
    let processed = 0, stuck = false;
    for (const s of take) { const tx = await rpc.tx(s.signature); if (!tx) { stuck = true; break; } await engine.processTx(tx); processed++; }
    if (!stuck) db.prepare('INSERT OR REPLACE INTO checkpoints (program_id, last_signature, last_slot, updated_at) VALUES (?,?,?,?)').run(address, newest?.signature ?? null, newest?.slot ?? null, now);
    return { fetched: pages.length, processed, skipped: 0, stuck };
  }
  // oldest -> newest
  const ordered = pages.slice().reverse();
  let processed = 0, skipped = 0, stuck = false;
  let lastGood: { signature: string; slot: number } | null = null;
  for (const s of ordered) {
    // already delivered by the webhook: no getTransaction (saves 1 credit per transaction); the checkpoint still advances
    if (engine.alreadyObserved(s.signature)) { skipped++; lastGood = s; continue; }
    const tx = await rpc.tx(s.signature);
    if (!tx) { stuck = true; break; }
    await engine.processTx(tx);
    processed++;
    lastGood = s;
    if (o.sleepMs) await new Promise((r) => setTimeout(r, o.sleepMs));
  }
  // a stuck run (transaction not retrievable) must NOT advance the heartbeat, so the stall alert can fire
  db.prepare('UPDATE checkpoints SET last_signature=COALESCE(?, last_signature), last_slot=COALESCE(?, last_slot), updated_at=CASE WHEN ? THEN updated_at ELSE ? END WHERE program_id=?')
    .run(lastGood?.signature ?? null, lastGood?.slot ?? null, stuck ? 1 : 0, engine.now(), address);
  return { fetched: pages.length, processed, skipped, stuck };
}

/** Poll every watched address of every registered program (program id + programdata). */
export async function pollAll(engine: Engine, rpc: Rpc, o: PollOpts = {}): Promise<{ addr: string; error?: string; fetched?: number; processed?: number; skipped?: number; stuck?: boolean }[]> {
  const addrs = new Set<string>();
  for (const e of engine.programs()) { addrs.add(e.programId); if (e.programdata && e.upgradeAlerts !== false) addrs.add(e.programdata); }
  const out = [];
  for (const a of addrs) {
    try { out.push({ addr: a, ...(await pollAddress(engine, rpc, a, o)) }); }
    catch (e) { out.push({ addr: a, error: (e as Error).message }); } // heartbeat is NOT advanced: stall alert will fire
  }
  return out;
}

/** Normalize a delivered transaction (Helius raw webhook shape: getTransaction-like objects). UNTESTED against a live Helius webhook. */
export function normalizeWebhookTx(x: any): RawTx | null {
  if (!x?.transaction?.message || !x.transaction.signatures) return null;
  const keys = (x.transaction.message.accountKeys ?? []).map((k: any) => (typeof k === 'string' ? k : k.pubkey));
  return { ...x, transaction: { ...x.transaction, message: { ...x.transaction.message, accountKeys: keys } } } as RawTx;
}

export function webhookServer(engine: Engine, opts: { authToken: string; port: number; host?: string; path?: string; onRaw?: (body: string) => void; health?: () => Record<string, unknown>; onError?: (e: unknown) => void; pages?: Record<string, { type: string; body: string | Buffer; cache?: string } | (() => { type: string; body: string | Buffer; cache?: string })>; feed?: { path: string; authToken: string; onBody: (body: string) => void } }): http.Server & { drain(): Promise<void> } {
  // Transactions are processed ONE BATCH AT A TIME, in arrival order, off the request path (R38): the webhook answers 200 as soon as the caller is authenticated and the body parses, and processTx
  // (decode, rules, and any Telegram/Discord send an alert makes) runs afterwards. Before, the reply waited for processTx, so one slow alert delivery held Helius's request open (tunnel: "Incoming
  // request ended abruptly: context canceled") and made it time out and retry.
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (txs: RawTx[]): void => {
    queue = queue.then(async () => {
      for (const tx of txs) { try { await engine.processTx(tx, 'webhook'); } catch (e) { try { opts.onError?.(e); } catch { /* logging must not stop the queue */ } } }
    });
  };
  const server = http.createServer((req, res) => {
    if (opts.health && req.method === 'GET' && req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, ...opts.health() })); return; }
    if (opts.pages && (req.method === 'GET' || req.method === 'HEAD') && req.url && Object.prototype.hasOwnProperty.call(opts.pages, req.url)) {
      const pg0 = opts.pages[req.url]!; const pg = typeof pg0 === 'function' ? pg0() : pg0;     // a function = rendered per request (R39: the census table and the last upgrades)
      res.writeHead(200, { 'content-type': pg.type, 'cache-control': pg.cache ?? 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'", 'referrer-policy': 'no-referrer' }).end(req.method === 'HEAD' ? undefined : pg.body);
      return;
    }
    if (opts.feed && req.method === 'POST' && req.url === opts.feed.path) {
      const g = Buffer.from(String(req.headers['authorization'] ?? '')); const w = Buffer.from(opts.feed.authToken);
      if (g.length !== w.length || !timingSafeEqual(g, w)) { res.writeHead(401).end(); return; }
      const cs: Buffer[] = []; req.on('data', (c) => cs.push(c));
      req.on('end', () => { try { opts.feed!.onBody(Buffer.concat(cs).toString('utf8')); res.writeHead(200).end('{}'); } catch { res.writeHead(400).end(); } });
      return;
    }
    if (req.method !== 'POST' || req.url !== (opts.path ?? '/webhook')) { res.writeHead(404).end(); return; }
    const got = Buffer.from(String(req.headers['authorization'] ?? ''));
    const want = Buffer.from(opts.authToken);
    if (got.length !== want.length || !timingSafeEqual(got, want)) { res.writeHead(401).end(); return; }
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let txs: RawTx[];
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        try { opts.onRaw?.(body); } catch { /* capture must never break ingest */ }
        const arr = JSON.parse(body);
        txs = (Array.isArray(arr) ? arr : [arr]).map(normalizeWebhookTx).filter((t): t is RawTx => t !== null);
      } catch { res.writeHead(400).end(); return; }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ processed: txs.length }));   // the reply goes out FIRST
      enqueue(txs);
    });
  }).listen(opts.port, opts.host ?? '127.0.0.1');
  return Object.assign(server, { drain: () => queue });
}
