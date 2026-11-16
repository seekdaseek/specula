import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { openDb } from '../src/db.js';
import { Engine } from '../src/engine.js';
import { Service, monthKey } from '../src/service.js';
import { Bot, parseCommand, type TgApi } from '../src/bot.js';
import { parsePlans } from '../src/plans.js';
import { inspectIdl, isPubkey } from '../src/idl-fetch.js';
import { backupDb, checkWebhookHealth } from '../src/ops.js';
import { WebhookSync } from '../src/helius.js';
import { JL, jlIdl, jlTx } from './util.js';
import type { RawTx } from '../src/types.js';

const plans = parsePlans({ plans: { starter: { name: 'Starter', price_usd: 9, tx_per_month: 10, max_programs: 1 } }, trial: { days: 14, plan: 'starter', max_programs: 1 } });
const OWNER = '9999';
const DAY = 86_400_000;

function setup(opts: { t?: { v: number }; quota?: number } = {}) {
  const clock = opts.t ?? { v: Date.UTC(2026, 10, 14, 12) };
  const p = opts.quota ? parsePlans({ plans: { starter: { tx_per_month: opts.quota, max_programs: 1 } }, trial: { days: 14, plan: 'starter', max_programs: 1 } }) : plans;
  const sent: { chat: string; text: string; buttons?: any }[] = [];     // bot messages
  const wire: { chat: string; text: string }[] = [];                     // alerts delivered through the Telegram Bot API by the engine
  const fakeFetch = (async (_u: any, init: any) => { const b = JSON.parse(init.body); wire.push({ chat: String(b.chat_id), text: b.text }); return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 }); }) as typeof fetch;
  const holder: { svc?: Service } = {};
  const db = openDb(':memory:');
  const engine = new Engine(db, { now: () => clock.v, env: { TELEGRAM_BOT_TOKEN: 'T' } as any, fetchImpl: fakeFetch, ownerChannels: { telegram: { chat_id: OWNER } }, stallSeconds: 300,
    canAlert: (t, pr) => holder.svc!.canAlert(t, pr), onTx: (t, pr, s) => holder.svc!.onTx(t, pr, s) });
  const svc = holder.svc = new Service(db, engine, p, () => clock.v);
  const tg: TgApi = { sendMessage: async (chat, text, buttons) => { sent.push({ chat, text, buttons }); return sent.length; }, getFile: async () => null, download: async () => Buffer.alloc(0), answerCallback: async () => {} };
  const rpc = { account: async () => ({ executable: true, owner: 'BPFLoaderUpgradeab1e11111111111111111111111' }), getAccountData: async () => null };
  const changed = { n: 0 };
  const bot = new Bot(svc, { rpc: rpc as any, tg, fetchIdl: (async () => jlIdl()) as any, onProgramsChanged: () => { changed.n++; } });
  return { clock, db, engine, svc, bot, sent, wire, changed, tg, rpc };
}
const msg = (uid: number, text: string, extra: any = {}) => ({ update_id: 1, message: { chat: { id: uid, type: 'private' }, from: { id: uid }, text, ...extra } });
const updateRate = () => jlTx('2hCRvAUD2C');
const another = (tx: RawTx, n: number): RawTx => { const c = JSON.parse(JSON.stringify(tx)); c.transaction.signatures[0] = `${c.transaction.signatures[0]!.slice(0, 80)}${String(n).padStart(8, '0')}`; return c; };

describe('command parsing', () => {
  it('parses commands, bot suffix, argument and a pasted block', () => {
    expect(parseCommand('/start')).toEqual({ cmd: 'start', arg: '', rest: '', text: '' });
    expect(parseCommand('/watch@speculaDaBot  ABC')).toEqual({ cmd: 'watch', arg: 'ABC', rest: '', text: 'ABC' });
    expect(parseCommand('/rules ABC\n[[alerts]]\nname = "x"\n')).toEqual({ cmd: 'rules', arg: 'ABC', rest: '[[alerts]]\nname = "x"', text: 'ABC' });
    expect(parseCommand('hello')).toBeNull(); expect(parseCommand('/')).toBeNull();
  });
  it('validates program ids', () => { expect(isPubkey(JL)).toBe(true); expect(isPubkey('abc')).toBe(false); expect(isPubkey('0'.repeat(44))).toBe(false); });
});

describe('/watch flow', () => {
  it('on-chain IDL: activates with defaults (upgrade on, 24 h silence) and offers one button per instruction and event', async () => {
    const s = setup();
    await s.bot.handleUpdate(msg(1, `/watch ${JL}`));
    const e = s.engine.getEntry('tg:1', JL)!;
    expect(e.silenceHours).toBe(24); expect(e.upgradeAlerts).toBe(true); expect(s.changed.n).toBe(1);
    const last = s.sent.at(-1)!; const names = last.buttons.flat().map((b: any) => b.text);
    expect(names).toContain('ix deposit'); expect(names).toContain('ev log_deposit');
    expect(s.svc.user('1')!.trial_started_at).toBe(s.clock.v);
  });
  it('rejects a non-executable account and a missing account', async () => {
    const s = setup();
    (s.bot as any).o.rpc = { account: async () => ({ executable: false, owner: 'x' }), getAccountData: async () => null };
    await s.bot.handleUpdate(msg(1, `/watch ${JL}`)); expect(s.sent.at(-1)!.text).toContain('not an executable');
    (s.bot as any).o.rpc = { account: async () => null, getAccountData: async () => null };
    await s.bot.handleUpdate(msg(1, `/watch ${JL}`)); expect(s.sent.at(-1)!.text).toContain('does not exist');
    expect(s.engine.programs().length).toBe(0);
  });
  it('no on-chain IDL: asks for a file, then accepts an Anchor IDL document', async () => {
    const s = setup(); (s.bot as any).o.fetchIdl = async () => null;
    const body = Buffer.from(JSON.stringify(jlIdl()));
    s.tg.getFile = async () => ({ path: 'p', size: body.length }); s.tg.download = async () => body;
    await s.bot.handleUpdate(msg(1, `/watch ${JL}`)); expect(s.sent.at(-1)!.text).toContain('Send me the IDL');
    await s.bot.handleUpdate(msg(1, '', { text: undefined, document: { file_id: 'f', file_size: body.length } }));
    expect(s.engine.getEntry('tg:1', JL)).toBeDefined();
  });
  it('IDL whose declared address does not match PROGRAM_ID is rejected (Anchor and Codama)', async () => {
    expect(() => inspectIdl({ ...jlIdl(), address: '11111111111111111111111111111111' }, JL)).toThrow(/address mismatch/);
    const codama = JSON.parse(fs.readFileSync('fixtures/idl/codama-subscriptions.json', 'utf8'));
    expect(() => inspectIdl(codama, JL)).toThrow(/address mismatch/);
    expect(inspectIdl(codama, codama.program.publicKey).kind).toBe('codama');
    expect(inspectIdl(jlIdl(), JL).instructions).toContain('deposit');   // positive control: the same IDL passes for its own address
    const s = setup(); (s.bot as any).o.fetchIdl = async () => null;
    const bad = Buffer.from(JSON.stringify({ ...jlIdl(), address: '11111111111111111111111111111111' }));
    s.tg.getFile = async () => ({ path: 'p', size: bad.length }); s.tg.download = async () => bad;
    await s.bot.handleUpdate(msg(1, `/watch ${JL}`));
    await s.bot.handleUpdate(msg(1, '', { text: undefined, document: { file_id: 'f', file_size: bad.length } }));
    expect(s.sent.at(-1)!.text).toContain('address mismatch'); expect(s.engine.programs().length).toBe(0);
  });
  it('files over 1 MB are refused', async () => {
    const s = setup(); (s.bot as any).o.fetchIdl = async () => null;
    await s.bot.handleUpdate(msg(1, `/watch ${JL}`));
    await s.bot.handleUpdate(msg(1, '', { text: undefined, document: { file_id: 'f', file_size: 1_000_001 } }));
    expect(s.sent.at(-1)!.text).toContain('larger than 1 MB');
  });
  it('rate limit: 5 /watch per user per hour, then allowed again after the hour (fake clock)', async () => {
    const s = setup(); (s.bot as any).o.rpc = { account: async () => null, getAccountData: async () => null };
    for (let i = 0; i < 5; i++) await s.bot.handleUpdate(msg(1, `/watch ${JL}`));
    expect(s.sent.at(-1)!.text).toContain('does not exist');
    await s.bot.handleUpdate(msg(1, `/watch ${JL}`)); expect(s.sent.at(-1)!.text).toContain('at most 5');
    await s.bot.handleUpdate(msg(2, `/watch ${JL}`)); expect(s.sent.at(-1)!.text).toContain('does not exist');   // another user is unaffected
    s.clock.v += 3_600_001;
    await s.bot.handleUpdate(msg(1, `/watch ${JL}`)); expect(s.sent.at(-1)!.text).toContain('does not exist');
  });
  it('only one program on the trial; a second /watch is refused', async () => {
    const s = setup(); await s.bot.handleUpdate(msg(1, `/watch ${JL}`));
    await s.bot.handleUpdate(msg(1, '/watch SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf')); expect(s.sent.at(-1)!.text).toContain('allows 1 program');
  });
  it('group chats are ignored', async () => {
    const s = setup(); await s.bot.handleUpdate({ update_id: 1, message: { chat: { id: -5, type: 'group' }, from: { id: 1 }, text: `/watch ${JL}` } });
    expect(s.sent.length).toBe(0);
  });
});

describe('tenant isolation', () => {
  it('two users watching the same program: each alert goes only to its own chat; nobody can touch the other user\'s rules or programs', async () => {
    const s = setup({ quota: 1000 });
    await s.bot.handleUpdate(msg(1, `/watch ${JL}`)); await s.bot.handleUpdate(msg(2, `/watch ${JL}`));
    // user 1 adds an alert for update_rate through the button; user 2 does not
    const rowid = (s.db.prepare("SELECT rowid r FROM programs WHERE tenant_id='tg:1'").get() as any).r;
    await s.bot.handleUpdate({ update_id: 2, callback_query: { id: 'c', from: { id: 1 }, message: { chat: { id: 1 } }, data: `a:${rowid}:i:update_rate` } });
    expect(s.engine.rulesOf('tg:1', JL).length).toBe(1);
    await s.engine.processTx(updateRate());
    expect(s.wire.map((w) => w.chat)).toEqual(['1']);
    // user 2 tries to use user 1's program row id and rule id
    await s.bot.handleUpdate({ update_id: 3, callback_query: { id: 'c', from: { id: 2 }, message: { chat: { id: 2 } }, data: `a:${rowid}:i:deposit` } });
    expect(s.engine.rulesOf('tg:1', JL).length).toBe(1); expect(s.engine.rulesOf('tg:2', JL).length).toBe(0);
    const rid = s.engine.rulesOf('tg:1', JL)[0]!.id;
    await s.bot.handleUpdate({ update_id: 4, callback_query: { id: 'c', from: { id: 2 }, message: { chat: { id: 2 } }, data: `r:${rid}` } });
    expect(s.engine.rulesOf('tg:1', JL).length).toBe(1);
    // user 2 cannot list or remove user 1's data; /list shows only their own
    await s.bot.handleUpdate(msg(3, `/rules ${JL}`)); expect(s.sent.at(-1)!.text).toContain('Usage');
    await s.bot.handleUpdate(msg(3, `/remove ${JL}`)); expect(s.sent.at(-1)!.text).toContain('do not watch');
    await s.bot.handleUpdate(msg(2, '/list')); expect(s.sent.at(-1)!.text).toContain(JL); expect(s.sent.at(-1)!.chat).toBe('2');
    // a callback pressed from a different chat than the user's own is rejected
    await s.bot.handleUpdate({ update_id: 5, callback_query: { id: 'c', from: { id: 1 }, message: { chat: { id: 777 } }, data: `r:${rid}` } });
    expect(s.engine.rulesOf('tg:1', JL).length).toBe(1);
    // both users get the alert once each when both have the rule
    await s.bot.handleUpdate({ update_id: 6, callback_query: { id: 'c', from: { id: 2 }, message: { chat: { id: 2 } }, data: `a:${(s.db.prepare("SELECT rowid r FROM programs WHERE tenant_id='tg:2'").get() as any).r}:i:update_rate` } });
    s.wire.length = 0; await s.engine.processTx(another(updateRate(), 1));
    expect(s.wire.map((w) => w.chat).sort()).toEqual(['1', '2']);
  });
  it('pipeline-stall alerts go to the OWNER chat only, never to a customer', async () => {
    const s = setup(); await s.bot.handleUpdate(msg(1, `/watch ${JL}`));
    s.clock.v += 3600_000;   // no poll heartbeat for an hour > stallSeconds
    const r = await s.engine.checkHealth(); expect(r.pipeline).toBeGreaterThan(0);
    expect(s.wire.length).toBeGreaterThan(0); expect(s.wire.every((w) => w.chat === OWNER)).toBe(true);
  });
});

describe('quota metering', () => {
  it('counts distinct signatures per program per month, warns once at 80%, pauses at 100%, resumes next month', async () => {
    const s = setup({ quota: 10 });
    await s.bot.handleUpdate(msg(1, `/watch ${JL}`));
    const rowid = (s.db.prepare("SELECT rowid r FROM programs").get() as any).r;
    await s.bot.handleUpdate({ update_id: 2, callback_query: { id: 'c', from: { id: 1 }, message: { chat: { id: 1 } }, data: `a:${rowid}:i:update_rate` } });
    const base = updateRate(); s.sent.length = 0;
    for (let i = 0; i < 7; i++) await s.engine.processTx(another(base, i));
    await s.engine.processTx(another(base, 3));                    // re-delivery of an already counted signature
    expect(s.svc.usage('tg:1', JL)).toBe(7); expect(s.wire.length).toBe(7);
    expect(s.svc.tick()).toEqual([]);                              // below 80%
    await s.engine.processTx(another(base, 7));                    // 8th = 80%
    const n80 = s.svc.tick(); expect(n80.length).toBe(1); expect(n80[0]!.text).toContain('80%');
    await s.engine.processTx(another(base, 8));                    // 9th
    expect(s.svc.tick()).toEqual([]);                              // warned once only
    await s.engine.processTx(another(base, 9));                    // 10th = 100%: counted, alert suppressed from here
    const n100 = s.svc.tick(); expect(n100.length).toBe(1); expect(n100[0]!.text).toContain('paused');
    const wired = s.wire.length; await s.engine.processTx(another(base, 10));
    expect(s.wire.length).toBe(wired); expect(s.svc.canAlert('tg:1', JL)).toBe(false);
    await s.bot.handleUpdate(msg(1, '/status')); expect(s.sent.at(-1)!.text).toContain('PAUSED');
    s.db.prepare('UPDATE users SET trial_ends_at=?').run(Date.UTC(2027, 0, 1));   // keep the trial open so only the month changes
    s.clock.v = Date.UTC(2026, 11, 1, 1);                          // next calendar month (UTC)
    expect(monthKey(s.clock.v)).toBe('2026-12'); expect(s.svc.canAlert('tg:1', JL)).toBe(true);
    await s.engine.processTx(another(base, 11)); expect(s.wire.length).toBe(wired + 1);
  });
  it('operator tenants (not users) are not metered', async () => {
    const s = setup({ quota: 1 }); s.engine.addTenant('proof', { telegram: { chat_id: OWNER } });
    s.engine.addProgram({ tenantId: 'proof', programId: JL, idl: jlIdl(), rules: [{ kind: 'instruction', name: 'update_rate', match: 'all', conditions: [], severity: 'info', channels: ['telegram'], unsupportedChannels: [] }] });
    for (let i = 0; i < 4; i++) await s.engine.processTx(another(updateRate(), i));
    expect(s.wire.length).toBe(4);
  });
});

describe('trial', () => {
  it('14 days from the first /watch; one trial per Telegram id; expiry pauses alerts and sends ONE message; the trial cannot restart', async () => {
    const s = setup({ quota: 1000 });
    await s.bot.handleUpdate(msg(1, '/status')); expect(s.sent.at(-1)!.text).toContain('Send /start');
    await s.bot.handleUpdate(msg(1, '/start')); await s.bot.handleUpdate(msg(1, '/status')); expect(s.sent.at(-1)!.text).toContain('starts at your first /watch');
    await s.bot.handleUpdate(msg(1, `/watch ${JL}`));
    const rowid = (s.db.prepare("SELECT rowid r FROM programs").get() as any).r;
    await s.bot.handleUpdate({ update_id: 2, callback_query: { id: 'c', from: { id: 1 }, message: { chat: { id: 1 } }, data: `a:${rowid}:i:update_rate` } });
    expect(s.svc.trialDaysLeft(s.svc.user('1')!)).toBe(14);
    s.clock.v += 13 * DAY; await s.engine.processTx(updateRate()); expect(s.wire.length).toBe(1);
    await s.bot.handleUpdate(msg(1, '/status')); expect(s.sent.at(-1)!.text).toContain('1 days left');
    s.clock.v += 2 * DAY;
    const notes = s.svc.tick(); expect(notes.length).toBe(1); expect(notes[0]!.text).toContain('/upgrade PLAN'); expect(s.svc.tick()).toEqual([]);
    await s.engine.processTx(another(updateRate(), 1)); expect(s.wire.length).toBe(1);     // paused
    await s.bot.handleUpdate(msg(1, '/remove ' + JL)); await s.bot.handleUpdate(msg(1, `/watch ${JL}`));
    expect(s.sent.at(-1)!.text).toContain('trial has ended'); expect(s.engine.getEntry('tg:1', JL)).toBeUndefined();   // no second trial
    await s.bot.handleUpdate(msg(1, '/start')); expect(s.svc.state(s.svc.user('1')!)).toBe('expired');
  });
});

describe('rules command', () => {
  it('pasting a Microscope [[alerts]] block goes through the validator; invalid blocks are rejected; channels forced to telegram', async () => {
    const s = setup(); await s.bot.handleUpdate(msg(1, `/watch ${JL}`));
    await s.bot.handleUpdate(msg(1, `/rules ${JL}\n[[alerts]]\nkind = "event"\nname = "log_deposit"\nconditions = [{ field = "data.assets", operator = "gt", value = 5 }]\nseverity = "warning"\nchannels = ["slack", "webhook"]`));
    expect(s.sent.at(-1)!.text).toContain('Added 1 rule');
    expect(s.engine.rulesOf('tg:1', JL)[0]!.rule.channels).toEqual(['telegram']);
    await s.bot.handleUpdate(msg(1, `/rules ${JL}\n[[alerts]]\nname = "x"\nseverity = "info"\nconditions = [{ field = "data.a", operator = "bogus", value = 1 }]`));
    expect(s.sent.at(-1)!.text).toContain('Could not use'); expect(s.engine.rulesOf('tg:1', JL).length).toBe(1);
    await s.bot.handleUpdate(msg(1, `/rules ${JL}`)); expect(s.sent.at(-1)!.buttons[0][0].callback_data).toMatch(/^r:\d+$/);
  });
  it('rules survive a restart (restore from the database), without duplicates', async () => {
    const s = setup(); await s.bot.handleUpdate(msg(1, `/watch ${JL}`));
    s.engine.addRule('tg:1', JL, { kind: 'instruction', name: 'deposit', match: 'all', conditions: [], severity: 'info', channels: ['telegram'], unsupportedChannels: [] });
    const e2 = new Engine(s.db, { now: () => s.clock.v }); const svc2 = new Service(s.db, e2, plans, () => s.clock.v);
    svc2.restoreTenants(); e2.restore(); e2.restore();
    expect(e2.programs().length).toBe(1); expect(e2.rulesOf('tg:1', JL).length).toBe(1);
  });
});

describe('ops', () => {
  it('Helius webhook edits are batched: at most one edit per 5 minutes, and only when the address list changed', async () => {
    const db = openDb(':memory:'); db.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    const calls: string[] = []; let t = 1_000_000; let want = ['A'];
    const api = { create: async () => { calls.push('create'); return 'wh1'; }, get: async () => ({ ok: 1 }), edit: async (_i: string, d: any) => { calls.push('edit:' + d.addresses.join(',')); } };
    const sync = new WebhookSync(db, api as any, { url: 'u', auth: 'a', desired: () => want, now: () => t, minIntervalMs: 300_000 });
    expect(await sync.tick()).toBe('created'); expect(await sync.tick()).toBe('idle');
    want = ['A', 'B']; t += 60_000; expect(await sync.tick()).toBe('wait');
    want = ['A', 'B', 'C']; t += 60_000; expect(await sync.tick()).toBe('wait');
    t += 300_000; expect(await sync.tick()).toBe('edited'); expect(calls).toEqual(['create', 'edit:A,B,C']);
    expect(await sync.tick()).toBe('idle');
  });
  // R38: the honest "missed" rule. A reconciler row counts only when it is older than 10 min and the webhook STILL has not delivered it; the alert needs more than 20% of the window's transactions (and at least 3),
  // is a WARNING, and repeats at most once per 6 h. The dead-webhook alert stays CRITICAL.
  const health = () => {
    const db = openDb(':memory:'); const texts: string[] = [];
    const f = (async (_u: any, i: any) => { texts.push(String(JSON.parse(i.body).text)); return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })); }) as typeof fetch;
    const env = { TELEGRAM_BOT_TOKEN: 'T' } as any; const now = Date.UTC(2026, 10, 15, 12);
    const obs = (sig: string, source: 'poll' | 'webhook', at: number) => db.prepare('INSERT OR IGNORE INTO observations (signature, source, seen_at, block_time, failed) VALUES (?,?,?,?,0)').run(sig, source, at, 1);
    const run = (t: number, o: Record<string, unknown> = {}) => checkWebhookHealth(db, t, { telegram: { chat_id: OWNER } }, env, { programs: 1, fetchImpl: f, startedAt: now - 3600_000, ...o } as any);
    return { db, texts, now, obs, run };
  };
  const MIN = 60_000;
  it('a reconciler-first transaction that the webhook delivered a moment later is NOT a miss (the 14-16 Nov false alarm): no alert however many there are', async () => {
    const h = health();
    for (let i = 0; i < 12; i++) { h.obs(`race${i}`, 'poll', h.now - 20 * MIN + i * 1000); h.obs(`race${i}`, 'webhook', h.now - 20 * MIN + i * 1000 + 190); }   // 12 of 12 raced, delivered 190 ms later
    for (let i = 0; i < 30; i++) h.obs(`ok${i}`, 'webhook', h.now - 25 * MIN + i * 1000);
    expect(await h.run(h.now)).toEqual([]); expect(h.texts).toEqual([]);
  });
  it('a transaction younger than 10 min with no webhook yet is not counted either: it has not had its chance', async () => {
    const h = health();
    for (let i = 0; i < 6; i++) h.obs(`young${i}`, 'poll', h.now - 5 * MIN);      // 6 poll-only rows, 5 min old
    expect(await h.run(h.now)).toEqual([]);
  });
  it('a real miss: old poll-only rows above 20% of the window fire ONE warning (not critical), and not again within 6 h', async () => {
    const h = health();
    for (let i = 0; i < 6; i++) h.obs(`miss${i}`, 'poll', h.now - 20 * MIN + i);        // 6 undelivered
    for (let i = 0; i < 14; i++) h.obs(`ok${i}`, 'webhook', h.now - 22 * MIN + i);      // 14 delivered: 6 of 20 = 30%
    expect(await h.run(h.now)).toEqual(['webhook-missed']);
    expect(h.texts).toHaveLength(1); expect(h.texts[0]).toMatch(/^\[WARNING\] specula webhook is missing transactions/); expect(h.texts[0]).toContain('6 of 20 transactions (30%)'); expect(h.texts[0]).not.toContain('CRITICAL');
    expect(await h.run(h.now + 30 * MIN)).toEqual([]); expect(await h.run(h.now + 5 * 3600_000 + 59 * MIN, { deadHours: 1000 })).toEqual([]);      // inside 6 h: silent (deadHours raised so the unrelated silence alert is out of the way)
    expect(h.texts).toHaveLength(1);
    h.db.prepare('UPDATE observations SET seen_at = seen_at + ?').run(6 * 3600_000);        // the same misses, 6 h later, still undelivered
    expect(await h.run(h.now + 6 * 3600_000, { deadHours: 1000 })).toEqual(['webhook-missed']);
    expect(h.texts).toHaveLength(2);
  });
  it('at or below 20% of the window, or fewer than 3, there is no alert (negative controls for the ratio and the count)', async () => {
    const h = health();
    for (let i = 0; i < 4; i++) h.obs(`miss${i}`, 'poll', h.now - 20 * MIN + i);        // 4 undelivered
    for (let i = 0; i < 16; i++) h.obs(`ok${i}`, 'webhook', h.now - 22 * MIN + i);      // 4 of 20 = exactly 20%: not above
    expect(await h.run(h.now)).toEqual([]);
    const g = health();
    for (let i = 0; i < 2; i++) g.obs(`miss${i}`, 'poll', g.now - 20 * MIN + i);        // 2 of 2 = 100% but under the 3 minimum
    expect(await g.run(g.now)).toEqual([]);
    const k = health();
    for (let i = 0; i < 3; i++) k.obs(`miss${i}`, 'poll', k.now - 20 * MIN + i);        // control: 3 of 3 does fire
    expect(await k.run(k.now)).toEqual(['webhook-missed']);
  });
  it('a dead webhook is still CRITICAL, once per hour bucket, and only while programs are watched; it does not need the miss rule', async () => {
    const h = health();
    expect(await h.run(h.now, { startedAt: h.now - 7 * 3600_000 })).toEqual(['webhook-silent']);
    expect(h.texts[0]).toMatch(/^\[CRITICAL\] specula webhook silent/);
    expect(await h.run(h.now + 1000, { startedAt: h.now - 7 * 3600_000 })).toEqual([]);          // same hour: deduped
    expect(await health().run(Date.UTC(2026, 10, 15, 12), { programs: 0, startedAt: Date.UTC(2026, 10, 15, 5) })).toEqual([]);   // nothing watched: no alarm
  });
  it('daily backup uses sqlite3 .backup, is a valid database, and keeps only 7 files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specula-bk-')); const dbFile = path.join(dir, 'x.db');
    const db = openDb(dbFile); db.prepare("INSERT INTO tenants (id, name, created_at) VALUES ('a','a',1)").run();
    let last = '';
    for (let d = 0; d < 10; d++) last = backupDb(dbFile, path.join(dir, 'bk'), Date.UTC(2026, 10, 1 + d, 3, 30), 7);
    expect(fs.readdirSync(path.join(dir, 'bk')).length).toBe(7);
    const copy = openDb(last); expect((copy.prepare('SELECT COUNT(*) n FROM tenants').get() as any).n).toBe(1);
    expect(fs.readdirSync(path.join(dir, 'bk')).sort()[0]).toContain('20261104');
  });
});
