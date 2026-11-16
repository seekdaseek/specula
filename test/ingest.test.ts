import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JL, jlAll, jlIdl, jlTx, receiver } from './util.js';
import { Engine } from '../src/engine.js';
import { openDb } from '../src/db.js';
import { normalizeWebhookTx, pollAddress, pollAll, Rpc, webhookServer } from '../src/ingest.js';
import type { RawTx } from '../src/types.js';

/** Fake chain: newest first like getSignaturesForAddress. */
function fakeRpc(chain: RawTx[], withheld = new Set<string>()): Rpc {
  const sig = (t: RawTx) => t.transaction.signatures[0]!;
  const r = Object.create(Rpc.prototype) as Rpc;
  (r as any).sigs = async (_a: string, o: { before?: string; until?: string; limit?: number }) => {
    let list = chain.map((t) => ({ signature: sig(t), slot: t.slot, err: t.meta?.err ?? null, blockTime: t.blockTime }));
    if (o.before) list = list.slice(list.findIndex((x) => x.signature === o.before) + 1);
    if (o.until) { const i = list.findIndex((x) => x.signature === o.until); if (i >= 0) list = list.slice(0, i); }
    return list.slice(0, o.limit ?? 1000);
  };
  (r as any).tx = async (s: string) => (withheld.has(s) ? null : chain.find((t) => sig(t) === s) ?? null);
  return r;
}
const mk = (db: string, opts = {}) => { const e = new Engine(openDb(db), opts); e.addTenant('t1'); e.addProgram({ tenantId: 't1', programId: JL, idl: jlIdl(), rules: [], upgradeAlerts: false }); return e; };
const sigOf = (t: RawTx) => t.transaction.signatures[0]!;
const count = (e: Engine) => (e.db.prepare('SELECT COUNT(DISTINCT signature) c FROM records').get() as any).c;

describe('polling with a durable per-address checkpoint', () => {
  const txs = jlAll().filter((t) => !t.meta!.err).sort((a, b) => b.slot - a.slot); // newest first
  it('first poll starts at the head without backfilling; later polls pick up only newer signatures', async () => {
    const e = mk(':memory:');
    const chain = txs.slice(3); // 3 old ones exist
    expect((await pollAddress(e, fakeRpc(chain), JL)).processed).toBe(0);
    expect(count(e)).toBe(0);
    const chain2 = [...txs.slice(0, 2), ...chain];
    const r = await pollAddress(e, fakeRpc(chain2), JL);
    expect(r.processed).toBe(2); expect(count(e)).toBe(2);
    expect((await pollAddress(e, fakeRpc(chain2), JL)).processed).toBe(0);
  });
  it('a restart replays signatures missed while the process was down (file DB, new Engine)', async () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'specula-')), 'x.db');
    const old = txs.slice(3);
    let e = mk(f); await pollAddress(e, fakeRpc(old), JL); e.db.close(); // checkpoint at head of `old`
    const later = [...txs.slice(0, 3), ...old]; // 3 txs arrive while we are "down"
    e = mk(f);                                  // restart
    const r = await pollAddress(e, fakeRpc(later), JL);
    expect(r.processed).toBe(3); expect(count(e)).toBe(3);
    e.db.close();
  });
  it('a transaction that cannot be fetched yet is retried next poll, not skipped, and does not advance the heartbeat', async () => {
    let t = 1000; const e = mk(':memory:', { now: () => t });
    const base = txs.slice(3); await pollAddress(e, fakeRpc(base), JL);
    const hb0 = (e.db.prepare('SELECT updated_at u FROM checkpoints').get() as any).u;
    const chain = [...txs.slice(0, 3), ...base];
    t = 5000; const hold = new Set([sigOf(txs[1]!)]);
    const r1 = await pollAddress(e, fakeRpc(chain, hold), JL);
    expect(r1.stuck).toBe(true); expect(r1.processed).toBe(1); // oldest of the three only
    expect((e.db.prepare('SELECT updated_at u FROM checkpoints').get() as any).u).toBe(hb0);
    t = 9000; const r2 = await pollAddress(e, fakeRpc(chain), JL);
    expect(r2.stuck).toBe(false); expect(r2.processed).toBe(2); expect(count(e)).toBe(3);
    expect((e.db.prepare('SELECT updated_at u FROM checkpoints').get() as any).u).toBe(9000);
  });
  it('an RPC error leaves the heartbeat alone so the stall alert can fire; pollAll reports it', async () => {
    let t = 1000; const e = mk(':memory:', { now: () => t, stallSeconds: 60 });
    await pollAddress(e, fakeRpc(txs), JL);
    const broken = Object.create(Rpc.prototype) as Rpc; (broken as any).sigs = async () => { throw new Error('boom'); };
    t = 200_000; const out = await pollAll(e, broken);
    expect(out[0]!.error).toBe('boom');
    expect((await e.checkHealth()).pipeline).toBe(1); // stall detected after the failed poll (no channel configured: claimed, not delivered)
  });
  it('webhook and poll overlap is harmless: same transactions delivered by both produce one record set', async () => {
    const e = mk(':memory:'); const srv = webhookServer(e, { authToken: 'tok', port: 0 });
    await new Promise((r) => srv.on('listening', r)); const port = (srv.address() as any).port;
    const body = JSON.stringify([jlTx('23JuFJJdra'), jlTx('23JuFJJdra')]);
    const bad = await fetch(`http://127.0.0.1:${port}/webhook`, { method: 'POST', body, headers: { authorization: 'nope' } }); expect(bad.status).toBe(401);
    const ok = await fetch(`http://127.0.0.1:${port}/webhook`, { method: 'POST', body, headers: { authorization: 'tok' } }); expect(await ok.json()).toEqual({ processed: 2 });
    await srv.drain();                                              // R38: processing happens after the reply
    expect(count(e)).toBe(1); expect((e.db.prepare('SELECT COUNT(*) c FROM records').get() as any).c).toBe(3);
    await pollAddress(e, fakeRpc([jlTx('23JuFJJdra')]), JL); // checkpoint at head
    srv.close();
  });
  // R38: the webhook replies 200 as soon as the caller is authenticated and the body parses; processTx (and any Telegram send an alert makes) runs afterwards, off the request path.
  it('the webhook answers 200 BEFORE processTx runs: a processTx that never returns cannot hold the reply, and the work still happens afterwards, in order', async () => {
    const order: string[] = []; let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
    const eng = { processTx: async (tx: any) => { order.push(`start:${tx.transaction.signatures[0]}`); if (order.length === 1) await gate; order.push(`done:${tx.transaction.signatures[0]}`); } } as any;
    const srv = webhookServer(eng, { authToken: 'tok', port: 0 });
    await new Promise((r) => srv.on('listening', r)); const port = (srv.address() as any).port;
    const a = jlTx('23JuFJJdra'), b = { ...jlTx('23JuFJJdra'), transaction: { ...jlTx('23JuFJJdra').transaction, signatures: ['second-sig'] } };
    const t0 = Date.now();
    const ok = await fetch(`http://127.0.0.1:${port}/webhook`, { method: 'POST', body: JSON.stringify([a, b]), headers: { authorization: 'tok' } });
    expect(ok.status).toBe(200); expect(await ok.json()).toEqual({ processed: 2 });
    expect(Date.now() - t0).toBeLessThan(2000);                     // processTx is still blocked on the gate, and the reply is already here
    expect(order).toEqual([`start:${a.transaction.signatures[0]}`]);
    release(); await srv.drain();
    expect(order).toEqual([`start:${a.transaction.signatures[0]}`, `done:${a.transaction.signatures[0]}`, 'start:second-sig', 'done:second-sig']);
    srv.close();
  });
  it('the webhook still verifies auth first (401, nothing processed), refuses a body that is not JSON (400, nothing processed), and a failing processTx is reported and does not stop the next one', async () => {
    const seen: string[] = []; const errs: string[] = [];
    const eng = { processTx: async (tx: any) => { seen.push(tx.transaction.signatures[0]); if (seen.length === 1) throw new Error('boom'); } } as any;
    const srv = webhookServer(eng, { authToken: 'tok', port: 0, onError: (e) => errs.push((e as Error).message) });
    await new Promise((r) => srv.on('listening', r)); const port = (srv.address() as any).port;
    const post = (body: string, authorization: string) => fetch(`http://127.0.0.1:${port}/webhook`, { method: 'POST', body, headers: { authorization } });
    const t = jlTx('23JuFJJdra');
    expect((await post(JSON.stringify([t]), 'nope')).status).toBe(401);
    expect((await post('{not json', 'tok')).status).toBe(400);
    await srv.drain(); expect(seen).toEqual([]);
    expect((await post(JSON.stringify([t, t]), 'tok')).status).toBe(200);
    await srv.drain(); expect(seen).toHaveLength(2); expect(errs).toEqual(['boom']);
    srv.close();
  });
  it('normalizeWebhookTx accepts {pubkey} account keys and rejects junk', () => {
    const t = jlTx('23JuFJJdra'); const n = normalizeWebhookTx({ ...t, transaction: { ...t.transaction, message: { ...t.transaction.message, accountKeys: t.transaction.message.accountKeys.map((k) => ({ pubkey: k })) } } });
    expect(n!.transaction.message.accountKeys[0]).toBe(t.transaction.message.accountKeys[0]);
    expect(normalizeWebhookTx({ nope: 1 })).toBeNull();
  });
});

describe('reconciler does not re-fetch what the webhook already delivered', () => {
  const txs = jlAll().filter((t) => !t.meta!.err).sort((a, b) => b.slot - a.slot);
  it('a signature already ingested by webhook is skipped (no getTransaction), the checkpoint still advances, and a missed one is fetched', async () => {
    const e = mk(':memory:'); const base = txs.slice(3);
    await pollAddress(e, fakeRpc(base), JL);
    const chain = [...txs.slice(0, 3), ...base];
    await e.processTx(txs[1]!, 'webhook');                         // webhook delivered #1 only
    const fetched: string[] = []; const rpc = fakeRpc(chain); const orig = (rpc as any).tx; (rpc as any).tx = async (s: string) => { fetched.push(s); return orig(s); };
    const r = await pollAddress(e, rpc, JL);
    expect(r.skipped).toBe(1); expect(r.processed).toBe(2);
    expect(fetched).not.toContain(sigOf(txs[1]!)); expect(fetched).toContain(sigOf(txs[0]!)); expect(fetched).toContain(sigOf(txs[2]!));
    expect(count(e)).toBe(3);
    expect((e.db.prepare("SELECT source s, COUNT(*) n FROM observations GROUP BY source ORDER BY source").all() as any[]).map((x) => `${x.s}:${x.n}`)).toEqual(['poll:2', 'webhook:1']);
    // checkpoint advanced to the newest: a second poll fetches nothing
    expect((await pollAddress(e, rpc, JL)).fetched).toBe(0);
  });
});
