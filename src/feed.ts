// The upgrade feed (R39, 16 Nov 2026): one watcher for every program whose ONLY alerts are upgrades and authority changes: the public feed (the census programs, posted to a public Telegram channel)
// and the free tier (one program per user, a private message). No webhook, no program-id polling, no transaction decoding.
//
// WHY STATE POLLING. A webhook on a ProgramData address bills one credit per transaction that touches it (Helius filters nothing before billing: UPGRADE-FEED.md measured 14,574 credits an hour for
// a loader-wide filter), and a popular program's ProgramData address is touched dozens of times a day (census: mean 25, p90 78, max 318 a day). The ProgramData account itself holds exactly what an
// upgrade or an authority change alters: the slot of the last deploy and the upgrade authority (first 45 bytes). getMultipleAccounts reads up to 100 of them for ONE credit (measured: 10 calls of 60
// addresses = 10 credits), so every watched program costs a share of 1 credit a minute, whatever its traffic. When the state moves, ONE signature lookup finds the transaction that did it.
import type { DB } from './db.js';
import type { RawTx } from './types.js';
import { deliver, type Alert } from './channels.js';
import { findUpgrades, type UpgradeEvent } from './upgrade.js';
import bs58 from 'bs58';

export const FEED_SCHEMA = `
CREATE TABLE IF NOT EXISTS upgrade_watch (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL CHECK (kind IN ('public','user')), tenant_id TEXT NOT NULL DEFAULT '', program_id TEXT NOT NULL,
  programdata TEXT NOT NULL, name TEXT, created_at INTEGER NOT NULL, UNIQUE (kind, tenant_id, program_id));
CREATE TABLE IF NOT EXISTS upgrade_state (
  programdata TEXT PRIMARY KEY, deployed_slot INTEGER NOT NULL, authority TEXT, read_slot INTEGER NOT NULL, checked_at INTEGER NOT NULL, unresolved INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS upgrade_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, programdata TEXT NOT NULL, program_id TEXT NOT NULL, action TEXT NOT NULL, signature TEXT NOT NULL, slot INTEGER NOT NULL, block_time INTEGER,
  old_authority TEXT, new_authority TEXT, buffer TEXT, created_at INTEGER NOT NULL, UNIQUE (signature, programdata, action));
CREATE TABLE IF NOT EXISTS upgrade_deliveries (
  event_id INTEGER NOT NULL, watch_id INTEGER NOT NULL, delivered_at INTEGER, error TEXT, PRIMARY KEY (event_id, watch_id));
`;

export const STATE_BYTES = 45;                 // 4 tag + 8 deployed slot + 1 option flag + 32 authority
export interface ProgramDataState { deployedSlot: number; authority: string | null }
/** Parse the first 45 bytes of a ProgramData account (BPF Upgradeable Loader, state tag 3). Null when it is not one. */
export function parseProgramData(data: Buffer): ProgramDataState | null {
  if (data.length < STATE_BYTES || data.readUInt32LE(0) !== 3) return null;
  return { deployedSlot: Number(data.readBigUInt64LE(4)), authority: data[12] === 1 ? bs58.encode(data.subarray(13, 45)) : null };
}

export interface FeedRpc {
  /** one getMultipleAccounts call (up to 100 ids): the first `length` bytes of each account, and the slot the read is as of */
  multiple(ids: string[], slice: { offset: number; length: number }): Promise<{ slot: number; values: (Buffer | null)[] }>;
  sigs(addr: string, o: { limit?: number }): Promise<{ signature: string; slot: number; err: unknown; blockTime: number | null }[]>;
  tx(sig: string): Promise<RawTx | null>;
}

export interface CensusRow { program_id: string; name: string | null; protocol?: string | null; loader: string; upgradeable?: boolean | null; programdata?: string; upgrade_authority?: string | null; authority_kind?: string; deployed_slot?: number; authority_evidence?: string }
export interface Census { read_at_utc: string; slot_min?: number; slot_max?: number; rows: CensusRow[] }

export interface FeedOpts {
  now?: () => number;
  log?: (m: string) => void;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  /** env var holding the public channel id; unset or empty means posts wait (they are kept, not lost) */
  publicChannelEnv?: string;
  botUrl?: string;
  /** at most one public post per program per this long (default 10 min); an event inside the gap is posted when it ends */
  minPostGapMs?: number;
  /** how a private (free tier) message is sent: chat id, text */
  sendUser?: (chatId: string, text: string) => Promise<unknown>;
  explorerTx?: (signature: string) => string;
  /** how many polls without finding the transaction before the change is recorded as unresolved and the state moves on */
  maxUnresolved?: number;
}

const short = (a: string | null | undefined) => (a ? `${a.slice(0, 4)}...${a.slice(-4)}` : 'none');
export const utcStamp = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

export class UpgradeFeed {
  readonly now: () => number;
  private census: Census | null = null;
  private warnedNoChannel = false;
  constructor(readonly db: DB, readonly rpc: FeedRpc, readonly o: FeedOpts = {}) {
    this.now = o.now ?? (() => Date.now());
    db.exec(FEED_SCHEMA);
  }
  private log(m: string) { this.o.log?.(m); }
  private get gapMs() { return this.o.minPostGapMs ?? 600_000; }
  private explorer(sig: string) { return (this.o.explorerTx ?? ((s) => `https://explorer.solana.com/tx/${s}`))(sig); }

  // ---- the watch list
  /** The public feed: every census row that is an upgradeable program. Rows that left the census are removed. Returns how many are watched. */
  loadCensus(census: Census): number {
    this.census = census;
    const want = census.rows.filter((r) => r.loader === 'upgradeable' && r.upgradeable === true && r.programdata);
    const keep = new Set(want.map((r) => r.program_id));
    for (const r of want) {
      this.db.prepare("INSERT INTO upgrade_watch (kind, tenant_id, program_id, programdata, name, created_at) VALUES ('public','',?,?,?,?) ON CONFLICT (kind, tenant_id, program_id) DO UPDATE SET programdata=excluded.programdata, name=excluded.name")
        .run(r.program_id, r.programdata!, r.name ?? null, this.now());
    }
    for (const w of this.db.prepare("SELECT id, program_id FROM upgrade_watch WHERE kind='public'").all() as { id: number; program_id: string }[]) {
      if (!keep.has(w.program_id)) this.db.prepare('DELETE FROM upgrade_watch WHERE id=?').run(w.id);
    }
    return want.length;
  }
  addUserWatch(tenantId: string, programId: string, programdata: string, name: string | null = null): void {
    this.db.prepare("INSERT OR IGNORE INTO upgrade_watch (kind, tenant_id, program_id, programdata, name, created_at) VALUES ('user',?,?,?,?,?)").run(tenantId, programId, programdata, name, this.now());
  }
  removeUserWatch(tenantId: string, programId: string): boolean {
    return this.db.prepare("DELETE FROM upgrade_watch WHERE kind='user' AND tenant_id=? AND program_id=?").run(tenantId, programId).changes > 0;
  }
  userWatches(tenantId: string): { program_id: string; programdata: string }[] {
    return this.db.prepare("SELECT program_id, programdata FROM upgrade_watch WHERE kind='user' AND tenant_id=? ORDER BY created_at").all(tenantId) as { program_id: string; programdata: string }[];
  }
  watchedProgramdata(): string[] { return (this.db.prepare('SELECT DISTINCT programdata FROM upgrade_watch').all() as { programdata: string }[]).map((r) => r.programdata); }

  // ---- one poll
  /** Read every watched ProgramData (batches of 100, one credit each), compare with the stored state, resolve what changed to its transaction, record it, deliver it. */
  async tick(): Promise<{ checked: number; changed: number; resolved: number; posted: number }> {
    const ids = this.watchedProgramdata();
    let changed = 0, resolved = 0;
    for (let i = 0; i < ids.length; i += 100) {
      const part = ids.slice(i, i + 100);
      const r = await this.rpc.multiple(part, { offset: 0, length: STATE_BYTES });
      for (let k = 0; k < part.length; k++) {
        const pd = part[k]!; const buf = r.values[k]; const st = buf ? parseProgramData(buf) : null;
        if (!st) continue;                                                   // not readable this time: leave the stored state alone
        const prev = this.db.prepare('SELECT * FROM upgrade_state WHERE programdata=?').get(pd) as { deployed_slot: number; authority: string | null; read_slot: number; unresolved: number } | undefined;
        if (!prev) { this.db.prepare('INSERT INTO upgrade_state (programdata, deployed_slot, authority, read_slot, checked_at) VALUES (?,?,?,?,?)').run(pd, st.deployedSlot, st.authority, r.slot, this.now()); continue; }   // first sight: baseline, never an alert
        if (prev.deployed_slot === st.deployedSlot && prev.authority === st.authority) { this.db.prepare('UPDATE upgrade_state SET read_slot=?, checked_at=?, unresolved=0 WHERE programdata=?').run(r.slot, this.now(), pd); continue; }
        changed++;
        if (await this.resolve(pd, prev, st, r.slot)) resolved++;
      }
    }
    const posted = await this.flushPosts();
    await this.deliverPrivate();                                              // retries free-tier messages that failed before
    return { checked: ids.length, changed, resolved, posted };
  }

  /** Find the successful loader transactions after the previous read that explain the new state. Moves the stored state on once they are recorded (or after maxUnresolved polls without them). */
  private async resolve(pd: string, prev: { deployed_slot: number; authority: string | null; read_slot: number; unresolved: number }, st: ProgramDataState, readSlot: number): Promise<boolean> {
    const watches = this.db.prepare('SELECT * FROM upgrade_watch WHERE programdata=?').all(pd) as { id: number; kind: string; tenant_id: string; program_id: string; name: string | null }[];
    const found: UpgradeEvent[] = [];
    let sigs: Awaited<ReturnType<FeedRpc['sigs']>> = [];
    try { sigs = await this.rpc.sigs(pd, { limit: 30 }); } catch (e) { this.log(`feed: signatures for ${pd}: ${(e as Error).message}`); }
    for (const s of sigs.filter((x) => !x.err && x.slot > prev.read_slot - 5).reverse()) {      // oldest first; failed transactions never changed anything
      let tx: RawTx | null = null;
      try { tx = await this.rpc.tx(s.signature); } catch { tx = null; }
      if (!tx) continue;
      for (const u of findUpgrades(tx, pd)) if (!u.failed) found.push(u);
    }
    const explains = found.some((u) => (u.action === 'upgrade' && u.slot === st.deployedSlot) || (u.action === 'set_authority' && (u.new_authority ?? null) === st.authority));
    if (!explains && prev.unresolved + 1 < (this.o.maxUnresolved ?? 10)) {
      this.db.prepare('UPDATE upgrade_state SET unresolved=unresolved+1 WHERE programdata=?').run(pd);
      return false;
    }
    if (!explains) this.log(`feed: state of ${pd} changed but no loader transaction explains it after ${prev.unresolved + 1} polls; state moved on, nothing posted`);
    // old authority per event: walk in order from the previous state
    let auth = prev.authority;
    for (const u of found) {
      const oldA = auth; const newA = u.action === 'set_authority' ? (u.new_authority ?? null) : auth;
      const ins = this.db.prepare('INSERT OR IGNORE INTO upgrade_events (programdata, program_id, action, signature, slot, block_time, old_authority, new_authority, buffer, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(pd, watches[0]?.program_id ?? '', u.action, u.signature, u.slot, u.block_time, oldA, newA, u.buffer ?? null, this.now());
      if (u.action === 'set_authority') auth = newA;
      if (ins.changes === 1) {
        const eid = Number(ins.lastInsertRowid);
        for (const w of watches) this.db.prepare('INSERT OR IGNORE INTO upgrade_deliveries (event_id, watch_id) VALUES (?,?)').run(eid, w.id);
      }
    }
    this.db.prepare('UPDATE upgrade_state SET deployed_slot=?, authority=?, read_slot=?, checked_at=?, unresolved=0 WHERE programdata=?').run(st.deployedSlot, st.authority, readSlot, this.now(), pd);
    await this.deliverPrivate();
    return explains;
  }

  // ---- delivery
  private eventText(e: { program_id: string; action: string; signature: string; block_time: number | null; created_at: number; old_authority: string | null; new_authority: string | null; buffer: string | null }, name: string | null): string {
    const label = name ?? `program ${short(e.program_id)}`;
    const when = utcStamp((e.block_time ?? Math.floor(e.created_at / 1000)) * 1000);
    const head = e.action === 'upgrade' ? `${label}: program upgraded` : `${label}: upgrade authority changed`;
    const body = e.action === 'upgrade'
      ? [`Program: ${e.program_id}`, `Upgrade authority: ${e.new_authority ?? 'none (immutable)'} (unchanged)`, `Buffer: ${e.buffer ?? 'unknown'}`]
      : [`Program: ${e.program_id}`, `Authority: ${e.old_authority ?? 'none'} -> ${e.new_authority ?? 'none (the program becomes immutable)'}`];
    return [head, ...body, this.explorer(e.signature), when, `Watch your own program: ${this.o.botUrl ?? 'https://t.me/speculaDaBot'}`].join('\n');
  }

  /** Free-tier users: one private message per event, to the chat that owns the watch. */
  private async deliverPrivate(): Promise<void> {
    const rows = this.db.prepare(`SELECT d.event_id, d.watch_id, w.tenant_id, w.name, e.* FROM upgrade_deliveries d JOIN upgrade_watch w ON w.id=d.watch_id JOIN upgrade_events e ON e.id=d.event_id WHERE w.kind='user' AND d.delivered_at IS NULL`).all() as any[];
    for (const r of rows) {
      const u = this.db.prepare('SELECT chat_id FROM users WHERE tenant_id=?').get(r.tenant_id) as { chat_id: string } | undefined;
      if (!u || !this.o.sendUser) { this.db.prepare('UPDATE upgrade_deliveries SET error=? WHERE event_id=? AND watch_id=?').run(u ? 'no sender' : 'no user', r.event_id, r.watch_id); continue; }
      try { await this.o.sendUser(u.chat_id, this.eventText(r, r.name)); this.db.prepare('UPDATE upgrade_deliveries SET delivered_at=?, error=NULL WHERE event_id=? AND watch_id=?').run(this.now(), r.event_id, r.watch_id); }
      catch (e) { this.db.prepare('UPDATE upgrade_deliveries SET error=? WHERE event_id=? AND watch_id=?').run(String((e as Error).message).slice(0, 120), r.event_id, r.watch_id); }
    }
  }

  /** The public channel: oldest pending event first; at most one post per program per minPostGapMs, later ones wait for the gap; nothing is posted while the channel id is not set (and nothing is lost). */
  async flushPosts(): Promise<number> {
    const env = this.o.env ?? process.env; const chat = env[this.o.publicChannelEnv ?? 'SPECULA_PUBLIC_CHANNEL'];
    const pending = this.db.prepare(`SELECT d.event_id, d.watch_id, w.name, e.* FROM upgrade_deliveries d JOIN upgrade_watch w ON w.id=d.watch_id JOIN upgrade_events e ON e.id=d.event_id WHERE w.kind='public' AND d.delivered_at IS NULL ORDER BY e.id`).all() as any[];
    if (!pending.length) return 0;
    if (!chat) { if (!this.warnedNoChannel) { this.warnedNoChannel = true; this.log(`feed: ${pending.length} upgrade post(s) waiting: ${this.o.publicChannelEnv ?? 'SPECULA_PUBLIC_CHANNEL'} is not set`); } return 0; }
    let posted = 0; const now = this.now();
    for (const p of pending) {
      const last = (this.db.prepare("SELECT MAX(d.delivered_at) t FROM upgrade_deliveries d JOIN upgrade_watch w ON w.id=d.watch_id WHERE w.kind='public' AND w.program_id=? AND d.delivered_at IS NOT NULL").get(p.program_id) as { t: number | null }).t;
      if (last !== null && now - last < this.gapMs) continue;                       // inside the 10 min gap: stays pending, goes out when the gap ends
      const alert: Alert = { severity: 'info', title: '', text: '', tenant_id: 'public', program_id: p.program_id, kind: 'upgrade', signature: p.signature, raw: this.eventText(p, p.name) };
      try {
        await deliver('telegram', { telegram: { chat_id: chat } }, alert, env, this.o.fetchImpl);
        this.db.prepare('UPDATE upgrade_deliveries SET delivered_at=?, error=NULL WHERE event_id=? AND watch_id=?').run(this.now(), p.event_id, p.watch_id);
        posted++;
      } catch (e) { this.db.prepare('UPDATE upgrade_deliveries SET error=? WHERE event_id=? AND watch_id=?').run(String((e as Error).message).slice(0, 120), p.event_id, p.watch_id); }
    }
    return posted;
  }

  // ---- what the landing page shows
  landingData(): { census: Census | null; rows: { program_id: string; name: string | null; protocol: string | null; authority: string | null; authority_kind: string | null; deployed_slot: number | null; upgradeable: boolean | null; loader: string }[]; upgrades: { name: string | null; program_id: string; action: string; signature: string; block_time: number | null; old_authority: string | null; new_authority: string | null }[] } {
    const state = new Map((this.db.prepare('SELECT programdata, deployed_slot, authority FROM upgrade_state').all() as { programdata: string; deployed_slot: number; authority: string | null }[]).map((s) => [s.programdata, s]));
    const rows = (this.census?.rows ?? []).map((r) => {
      const s = r.programdata ? state.get(r.programdata) : undefined;
      return { program_id: r.program_id, name: r.name ?? null, protocol: r.protocol ?? null, authority: s ? s.authority : (r.upgrade_authority ?? null), authority_kind: r.authority_kind ?? null, deployed_slot: s ? s.deployed_slot : (r.deployed_slot ?? null), upgradeable: r.upgradeable ?? null, loader: r.loader };
    });
    const upgrades = this.db.prepare(`SELECT (SELECT name FROM upgrade_watch w WHERE w.kind='public' AND w.programdata=e.programdata LIMIT 1) name, e.program_id, e.action, e.signature, e.block_time, e.old_authority, e.new_authority
      FROM upgrade_events e WHERE EXISTS (SELECT 1 FROM upgrade_watch w WHERE w.kind='public' AND w.programdata=e.programdata) ORDER BY COALESCE(e.block_time, e.created_at/1000) DESC, e.id DESC LIMIT 10`).all() as any[];
    return { census: this.census, rows, upgrades };
  }
}

/** FeedRpc over the existing Rpc class (src/ingest.ts) plus the batch read. */
export function feedRpc(rpc: { call<T>(method: string, params: unknown[]): Promise<T>; sigs: FeedRpc['sigs']; tx: FeedRpc['tx'] }): FeedRpc {
  return {
    sigs: (a, o) => rpc.sigs(a, o), tx: (s) => rpc.tx(s),
    async multiple(ids, slice) {
      const r = await rpc.call<{ context: { slot: number }; value: ({ data: [string, string] } | null)[] }>('getMultipleAccounts', [ids, { encoding: 'base64', commitment: 'confirmed', dataSlice: slice }]);
      return { slot: r.context.slot, values: r.value.map((v) => (v ? Buffer.from(v.data[0], 'base64') : null)) };
    },
  };
}
