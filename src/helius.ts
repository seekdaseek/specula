// Helius webhook management. Editing the address list costs 100 credits (COSTS.md), so WebhookSync batches changes and edits at most once per minInterval.
import type { DB } from './db.js';

export interface WebhookDef { url: string; auth: string; addresses: string[] }
export class HeliusWebhooks {
  constructor(private key: string, private f: typeof fetch = fetch, private base = 'https://api-mainnet.helius-rpc.com/v0/webhooks') {}
  private u(p = '') { return `${this.base}${p}?api-key=${this.key}`; }
  private body(d: WebhookDef) { return JSON.stringify({ webhookURL: d.url, transactionTypes: ['ANY'], accountAddresses: d.addresses, webhookType: 'raw', authHeader: d.auth }); }
  private async check(r: Response, what: string) { if (!r.ok) throw new Error(`helius ${what}: HTTP ${r.status}`); return r.json() as Promise<any>; }   // never echo the URL (it holds the key)
  async create(d: WebhookDef): Promise<string> { const j = await this.check(await this.f(this.u(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: this.body(d) }), 'create'); if (!j.webhookID) throw new Error('helius create: no webhookID'); return j.webhookID; }
  async get(id: string): Promise<any | null> { const r = await this.f(this.u(`/${id}`)); if (r.status === 404) return null; return this.check(r, 'get'); }
  async edit(id: string, d: WebhookDef): Promise<void> { await this.check(await this.f(this.u(`/${id}`), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: this.body(d) }), 'edit'); }
  async list(): Promise<any[]> { return this.check(await this.f(this.u()), 'list'); }
  async remove(id: string): Promise<void> { const r = await this.f(this.u(`/${id}`), { method: 'DELETE' }); if (!r.ok) throw new Error(`helius delete: HTTP ${r.status}`); }
}

const kvGet = (db: DB, k: string) => (db.prepare('SELECT v FROM kv WHERE k=?').get(k) as { v: string } | undefined)?.v;
const kvSet = (db: DB, k: string, v: string) => { db.prepare('INSERT INTO kv (k, v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, v); };

export class WebhookSync {
  constructor(private db: DB, private api: Pick<HeliusWebhooks, 'create' | 'get' | 'edit'>, private o: { url: string; auth: string; desired: () => string[]; now?: () => number; minIntervalMs?: number; log?: (m: string) => void }) {}
  private now() { return (this.o.now ?? Date.now)(); }
  /** Create the webhook if there is none (and at least one address); otherwise apply a changed address list at most once per minInterval. */
  async tick(): Promise<'created' | 'edited' | 'idle' | 'wait'> {
    const desired = [...new Set(this.o.desired())].sort();
    if (desired.length === 0) return 'idle';
    let id = kvGet(this.db, 'wh_id');
    if (id && !(await this.api.get(id))) { this.o.log?.('webhook id no longer exists at Helius; recreating'); id = undefined; }
    if (!id) {
      id = await this.api.create({ url: this.o.url, auth: this.o.auth, addresses: desired });
      kvSet(this.db, 'wh_id', id); kvSet(this.db, 'wh_addresses', JSON.stringify(desired)); kvSet(this.db, 'wh_last_edit', String(this.now()));
      return 'created';
    }
    const applied = kvGet(this.db, 'wh_addresses') ?? '[]';
    if (applied === JSON.stringify(desired)) return 'idle';
    if (this.now() - Number(kvGet(this.db, 'wh_last_edit') ?? 0) < (this.o.minIntervalMs ?? 300_000)) return 'wait';
    await this.api.edit(id, { url: this.o.url, auth: this.o.auth, addresses: desired });
    kvSet(this.db, 'wh_addresses', JSON.stringify(desired)); kvSet(this.db, 'wh_last_edit', String(this.now()));
    return 'edited';
  }
}
