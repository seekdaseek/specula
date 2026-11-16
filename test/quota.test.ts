// R41: a program over its plan quota stops costing credits: it leaves the Helius webhook address list (the webhook is deleted when nothing is left), it is not polled, and it comes back on the 1st or on an upgrade.
import { describe, it, expect } from 'vitest';
import { openDb } from '../src/db.js';
import { Engine } from '../src/engine.js';
import { Service } from '../src/service.js';
import { parsePlans } from '../src/plans.js';
import { WebhookSync } from '../src/helius.js';
import { pollAll, type Rpc } from '../src/ingest.js';
import { JL, jlIdl } from './util.js';

const PROG2 = 'jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC';
const plans = parsePlans({ plans: { starter: { name: 'Starter', price_usd: 9, tx_per_month: 3, max_programs: 3 }, growth: { name: 'Growth', price_usd: 39, tx_per_month: 10, max_programs: 3 } }, trial: { days: 90, plan: 'starter', max_programs: 1 } });

function setup() {
  const clock = { v: Date.UTC(2026, 10, 14, 12) };
  const db = openDb(':memory:'); const holder: { svc?: Service } = {};
  const engine = new Engine(db, { now: () => clock.v, canAlert: (t, p) => holder.svc!.canAlert(t, p), onTx: (t, p, s) => holder.svc!.onTx(t, p, s) });
  const svc = holder.svc = new Service(db, engine, plans, () => clock.v);
  for (const id of ['1', '2']) { svc.ensureUser(id, id); svc.startTrialIfNeeded(id); }
  engine.addProgram({ tenantId: 'tg:1', programId: JL, idl: jlIdl(), rules: [] });
  engine.addProgram({ tenantId: 'tg:2', programId: PROG2, idl: jlIdl(), rules: [] });
  const calls: string[] = []; let nextId = 0;
  const api = { create: async (d: any) => { calls.push(`create:${d.addresses.join(',')}`); return `wh${++nextId}`; }, get: async () => ({ ok: true }), edit: async (_i: string, d: any) => { calls.push(`edit:${d.addresses.join(',')}`); }, remove: async () => { calls.push('remove'); } };
  const sync = new WebhookSync(db, api as any, { url: 'u', auth: 'a', desired: () => engine.programs().filter((e) => !svc.quotaReached(e.tenantId, e.programId)).map((e) => e.programId), now: () => clock.v, minIntervalMs: 300_000 });
  const use = (tenant: string, prog: string, n: number) => { for (let i = 0; i < n; i++) svc.onTx(tenant, prog, `${prog}-${clock.v}-${i}`); };
  return { clock, db, engine, svc, sync, calls, use };
}

describe('quota safety', () => {
  it('quotaReached: false under the quota, true at it, false again on the 1st, false for static tenants, true for a user with no access', () => {
    const s = setup();
    expect(s.svc.quotaReached('tg:1', JL)).toBe(false);
    s.use('tg:1', JL, 3); expect(s.svc.quotaReached('tg:1', JL)).toBe(true); expect(s.svc.quotaReached('tg:2', PROG2)).toBe(false);
    s.clock.v = Date.UTC(2026, 11, 1, 0, 1); expect(s.svc.quotaReached('tg:1', JL)).toBe(false);          // the next month starts at 0
    expect(s.svc.quotaReached('operator-static', JL)).toBe(false);
    s.clock.v = Date.UTC(2027, 2, 1); expect(s.svc.quotaReached('tg:2', PROG2)).toBe(true);               // trial over: no access, no credits
  });
  it('an over-quota program leaves the webhook address list, and returns on the 1st; with every program over quota the webhook is DELETED and made again when one is back', async () => {
    const s = setup();
    expect(await s.sync.tick()).toBe('created'); expect(s.calls.at(-1)).toBe(`create:${[JL, PROG2].sort().join(',')}`);
    s.use('tg:1', JL, 3);                                                            // program 1 reaches its quota
    s.clock.v += 301_000; expect(await s.sync.tick()).toBe('edited'); expect(s.calls.at(-1)).toBe(`edit:${PROG2}`);
    s.use('tg:2', PROG2, 3);                                                         // program 2 too: nothing left to bill
    expect(await s.sync.tick()).toBe('removed'); expect(s.calls.at(-1)).toBe('remove');
    expect(await s.sync.tick()).toBe('idle');                                        // nothing to do while both are over quota
    expect(s.db.prepare("SELECT COUNT(*) n FROM kv WHERE k IN ('wh_id','wh_addresses')").get()).toEqual({ n: 0 });
    s.clock.v = Date.UTC(2026, 11, 1, 0, 1);                                         // the 1st: both come back
    expect(await s.sync.tick()).toBe('created'); expect(s.calls.at(-1)).toBe(`create:${[JL, PROG2].sort().join(',')}`);
  });
  it('an upgrade to a bigger plan puts the program back on the webhook', async () => {
    const s = setup();
    await s.sync.tick(); s.use('tg:1', JL, 3); s.clock.v += 301_000; await s.sync.tick(); expect(s.calls.at(-1)).toBe(`edit:${PROG2}`);
    s.svc.activatePaid('1', 'growth');                                               // 10 tx a month now: 3 used is under it
    s.clock.v += 301_000; expect(await s.sync.tick()).toBe('edited'); expect(s.calls.at(-1)).toBe(`edit:${[JL, PROG2].sort().join(',')}`);
  });
  it('the reconciler does not poll a program over its quota (no getSignaturesForAddress for its id or programdata), and polls the others', async () => {
    const s = setup(); s.use('tg:1', JL, 3);
    const asked: string[] = [];
    const rpc = { sigs: async (a: string) => { asked.push(a); return []; }, tx: async () => null } as unknown as Rpc;
    await pollAll(s.engine, rpc, { skip: s.svc.quotaReached });
    expect(asked).toEqual([PROG2]);                                                  // JL skipped, PROG2 polled
    asked.length = 0; await pollAll(s.engine, rpc); expect(asked.sort()).toEqual([JL, PROG2].sort());      // control: without skip both are polled
  });
});
