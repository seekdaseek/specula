// The upgrade feed (R39): ProgramData state polling, the public channel target with its rate limit, the free tier, the census loader, the landing sections.
import { describe, it, expect } from 'vitest';
import bs58 from 'bs58';
import { openDb } from '../src/db.js';
import { Engine } from '../src/engine.js';
import { Service, SERVICE_SCHEMA } from '../src/service.js';
import { parsePlans } from '../src/plans.js';
import { Bot, type TgApi } from '../src/bot.js';
import { UpgradeFeed, parseProgramData, feedRpc, type FeedRpc, type Census } from '../src/feed.js';
import { LOADER } from '../src/upgrade.js';
import { renderLanding, buildPages } from '../src/landing.js';
import type { RawTx } from '../src/types.js';

const key = (n: number) => bs58.encode(Buffer.alloc(32, n));
const PD1 = key(11), PROG1 = key(12), PD2 = key(21), PROG2 = key(22), AUTH_A = key(31), AUTH_B = key(32), BUF = key(41);
const stateBuf = (slot: number, auth: string | null) => { const b = Buffer.alloc(45); b.writeUInt32LE(3, 0); b.writeBigUInt64LE(BigInt(slot), 4); if (auth) { b[12] = 1; Buffer.from(bs58.decode(auth)).copy(b, 13); } return b; };

/** a loader transaction as the reconciler's getTransaction returns it */
function loaderTx(o: { sig: string; slot: number; time: number; pd: string; prog: string; tag: 3 | 4 | 7; buffer?: string; authority: string; newAuthority?: string; err?: unknown }): RawTx {
  const upgrade = o.tag === 3;
  const keys = upgrade ? [o.pd, o.prog, o.buffer ?? BUF, key(90), key(91), key(92), o.authority, LOADER] : [o.pd, o.authority, ...(o.newAuthority ? [o.newAuthority] : []), LOADER];
  const lastIx = keys.length - 1;
  const accounts = upgrade ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, ...(o.newAuthority ? [2] : [])];
  return { slot: o.slot, blockTime: o.time, transaction: { signatures: [o.sig], message: { accountKeys: keys, instructions: [{ programIdIndex: lastIx, accounts, data: bs58.encode(Buffer.from([o.tag, 0, 0, 0])) }] } }, meta: { err: o.err ?? null } };
}

class FakeRpc implements FeedRpc {
  state = new Map<string, { slot: number; auth: string | null }>();
  sigList = new Map<string, { signature: string; slot: number; err: unknown; blockTime: number | null }[]>();
  txs = new Map<string, RawTx>();
  head = 400; multipleCalls = 0; sigCalls = 0; txCalls = 0;
  async multiple(ids: string[]) { this.multipleCalls++; return { slot: this.head, values: ids.map((id) => { const s = this.state.get(id); return s ? stateBuf(s.slot, s.auth) : null; }) }; }
  async sigs(addr: string) { this.sigCalls++; return this.sigList.get(addr) ?? []; }
  async tx(sig: string) { this.txCalls++; return this.txs.get(sig) ?? null; }
  /** the program is upgraded: state moves, and the transaction is findable */
  upgrade(pd: string, prog: string, o: { sig: string; slot: number; time: number; authority: string; buffer?: string }) {
    const cur = this.state.get(pd)!; this.state.set(pd, { slot: o.slot, auth: cur.auth }); this.head = o.slot + 2;
    this.txs.set(o.sig, loaderTx({ ...o, pd, prog, tag: 3 })); this.sigList.set(pd, [{ signature: o.sig, slot: o.slot, err: null, blockTime: o.time }, ...(this.sigList.get(pd) ?? [])]);
  }
  setAuthority(pd: string, prog: string, o: { sig: string; slot: number; time: number; from: string; to: string | null; tag?: 4 | 7 }) {
    const cur = this.state.get(pd)!; this.state.set(pd, { slot: cur.slot, auth: o.to }); this.head = o.slot + 2;
    this.txs.set(o.sig, loaderTx({ sig: o.sig, slot: o.slot, time: o.time, pd, prog, tag: o.tag ?? 4, authority: o.from, ...(o.to ? { newAuthority: o.to } : {}) })); this.sigList.set(pd, [{ signature: o.sig, slot: o.slot, err: null, blockTime: o.time }, ...(this.sigList.get(pd) ?? [])]);
  }
}

const CENSUS: Census = { read_at_utc: '2026-11-16T06:28:39.592Z', slot_max: 470030423, rows: [
  { program_id: PROG1, name: 'Alpha Swap', protocol: 'Alpha', loader: 'upgradeable', upgradeable: true, programdata: PD1, upgrade_authority: AUTH_A, authority_kind: 'plain-key', deployed_slot: 500 },
  { program_id: PROG2, name: null, loader: 'upgradeable', upgradeable: true, programdata: PD2, upgrade_authority: AUTH_B, authority_kind: 'squads-v4-vault', deployed_slot: 600 },
  { program_id: key(51), name: 'Frozen', loader: 'upgradeable', upgradeable: false, programdata: key(52), upgrade_authority: null, authority_kind: 'none' },
  { program_id: key(53), name: 'Native-ish', loader: 'bpf-loader-2 (immutable)' },
] };

function setup(o: { channel?: string; gapMs?: number; sendUser?: (c: string, t: string) => Promise<unknown>; maxUnresolved?: number } = {}) {
  const clock = { v: Date.UTC(2026, 10, 16, 12) };
  const rpc = new FakeRpc(); rpc.state.set(PD1, { slot: 500, auth: AUTH_A }); rpc.state.set(PD2, { slot: 600, auth: AUTH_B });
  const wire: { chat: string; text: string }[] = [];
  const fetchImpl = (async (_u: any, init: any) => { const b = JSON.parse(init.body); wire.push({ chat: String(b.chat_id), text: b.text }); return new Response(JSON.stringify({ ok: true, result: { message_id: wire.length } }), { status: 200, headers: { 'content-type': 'application/json' } }); }) as typeof fetch;
  const env: any = { TELEGRAM_BOT_TOKEN: 'T', ...(o.channel === undefined ? {} : { SPECULA_PUBLIC_CHANNEL: o.channel }) };
  const db = openDb(':memory:'); db.exec(SERVICE_SCHEMA);
  const logs: string[] = [];
  const feed = new UpgradeFeed(db, rpc, { now: () => clock.v, env, fetchImpl, log: (m) => logs.push(m), minPostGapMs: o.gapMs ?? 600_000, ...(o.sendUser ? { sendUser: o.sendUser } : {}), ...(o.maxUnresolved ? { maxUnresolved: o.maxUnresolved } : {}) });
  return { clock, rpc, wire, env, db, feed, logs };
}

describe('ProgramData state', () => {
  it('parses the deploy slot and the authority, an immutable program, and refuses anything that is not a ProgramData account', () => {
    expect(parseProgramData(stateBuf(777, AUTH_A))).toEqual({ deployedSlot: 777, authority: AUTH_A });
    expect(parseProgramData(stateBuf(778, null))).toEqual({ deployedSlot: 778, authority: null });
    const bad = stateBuf(1, AUTH_A); bad.writeUInt32LE(2, 0);
    expect(parseProgramData(bad)).toBeNull(); expect(parseProgramData(Buffer.alloc(10))).toBeNull();
  });
});

describe('census loader', () => {
  it('watches only upgradeable programs with a programdata address, and drops rows that left the census', () => {
    const s = setup();
    expect(s.feed.loadCensus(CENSUS)).toBe(2);
    expect(s.feed.watchedProgramdata().sort()).toEqual([PD1, PD2].sort());
    expect(s.feed.loadCensus({ ...CENSUS, rows: CENSUS.rows.slice(0, 1) })).toBe(1);
    expect(s.feed.watchedProgramdata()).toEqual([PD1]);
  });
});

describe('public feed: detection and the post', () => {
  it('the first read is a silent baseline; an upgrade posts ONE message with name, buffer, authority, explorer link, UTC time and the last line', async () => {
    const s = setup({ channel: '-1001' }); s.feed.loadCensus(CENSUS);
    expect(await s.feed.tick()).toMatchObject({ checked: 2, changed: 0, posted: 0 }); expect(s.wire).toEqual([]);
    expect(s.rpc.multipleCalls).toBe(1);                                    // both ProgramData accounts, ONE call
    s.clock.v += 60_000; s.rpc.upgrade(PD1, PROG1, { sig: 'SIGUP1', slot: 700, time: Math.floor(Date.UTC(2026, 10, 16, 12, 0, 30) / 1000), authority: AUTH_A, buffer: BUF });
    const r = await s.feed.tick();
    expect(r).toMatchObject({ changed: 1, resolved: 1, posted: 1 });
    expect(s.wire).toHaveLength(1); expect(s.wire[0]!.chat).toBe('-1001');
    const lines = s.wire[0]!.text.split('\n');
    expect(lines[0]).toBe('Alpha Swap: program upgraded');
    expect(lines).toContain(`Program: ${PROG1}`); expect(lines).toContain(`Upgrade authority: ${AUTH_A} (unchanged)`); expect(lines).toContain(`Buffer: ${BUF}`);
    expect(lines).toContain('https://explorer.solana.com/tx/SIGUP1'); expect(lines).toContain('2026-11-16 12:00:30 UTC');
    expect(lines.at(-1)).toBe('Watch your own program: https://t.me/speculaDaBot');
    expect(s.wire[0]!.text).not.toMatch(/^\[/);                              // no [SEVERITY] prefix
    expect((await s.feed.tick()).changed).toBe(0); expect(s.wire).toHaveLength(1);       // the new state is the baseline now: no repeat
  });
  it('an authority change posts old -> new, and handing the program to nobody says it becomes immutable; an unnamed program is shown by a short id', async () => {
    const s = setup({ channel: '-1001', gapMs: 0 }); s.feed.loadCensus(CENSUS); await s.feed.tick();
    s.rpc.setAuthority(PD1, PROG1, { sig: 'SIGSA1', slot: 710, time: 1794800000, from: AUTH_A, to: AUTH_B });
    s.rpc.setAuthority(PD2, PROG2, { sig: 'SIGSA2', slot: 711, time: 1794800001, from: AUTH_B, to: null, tag: 4 });
    await s.feed.tick();
    const a = s.wire.find((w) => w.text.includes('SIGSA1'))!.text, b = s.wire.find((w) => w.text.includes('SIGSA2'))!.text;
    expect(a.split('\n')[0]).toBe('Alpha Swap: upgrade authority changed'); expect(a).toContain(`Authority: ${AUTH_A} -> ${AUTH_B}`); expect(a).not.toContain('Buffer:');
    expect(b.split('\n')[0]).toMatch(/^program [1-9A-Za-z]{4}\.\.\.[1-9A-Za-z]{4}: upgrade authority changed$/); expect(b).toContain(`Authority: ${AUTH_B} -> none (the program becomes immutable)`);
  });
  it('SetAuthorityChecked (tag 7) is detected like SetAuthority', async () => {
    const s = setup({ channel: '-1001' }); s.feed.loadCensus(CENSUS); await s.feed.tick();
    s.rpc.setAuthority(PD1, PROG1, { sig: 'SIGCHK', slot: 720, time: 1794800100, from: AUTH_A, to: AUTH_B, tag: 7 });
    await s.feed.tick(); expect(s.wire[0]!.text).toContain(`Authority: ${AUTH_A} -> ${AUTH_B}`);
  });
  it('FAILED transactions never post: a failed upgrade in the signature list is skipped, and a list of only failed ones never changes state or posts', async () => {
    const s = setup({ channel: '-1001' }); s.feed.loadCensus(CENSUS); await s.feed.tick();
    s.rpc.txs.set('SIGFAIL', loaderTx({ sig: 'SIGFAIL', slot: 705, time: 1794800200, pd: PD1, prog: PROG1, tag: 3, authority: AUTH_A, err: { InstructionError: [0, 'Custom'] } }));
    s.rpc.sigList.set(PD1, [{ signature: 'SIGFAIL', slot: 705, err: { InstructionError: [0, 'Custom'] }, blockTime: 1794800200 }]);
    expect((await s.feed.tick()).changed).toBe(0);                          // the account did not change, so nothing is even looked up
    expect(s.rpc.sigCalls).toBe(0); expect(s.wire).toEqual([]);
    s.rpc.upgrade(PD1, PROG1, { sig: 'SIGOK', slot: 706, time: 1794800210, authority: AUTH_A });   // a real upgrade lands next to the failed one
    await s.feed.tick();
    expect(s.wire).toHaveLength(1); expect(s.wire[0]!.text).toContain('SIGOK'); expect(s.wire[0]!.text).not.toContain('SIGFAIL');
    expect(s.db.prepare("SELECT COUNT(*) n FROM upgrade_events WHERE signature='SIGFAIL'").get()).toEqual({ n: 0 });
  });
  it('a change no transaction explains is retried, then recorded as unresolved with the state moved on and NOTHING posted', async () => {
    const s = setup({ channel: '-1001', maxUnresolved: 3 }); s.feed.loadCensus(CENSUS); await s.feed.tick();
    s.rpc.state.set(PD1, { slot: 800, auth: AUTH_A });                       // the state moved, no signature explains it
    for (let i = 0; i < 2; i++) { const r = await s.feed.tick(); expect(r.resolved).toBe(0); }
    expect(s.db.prepare('SELECT deployed_slot FROM upgrade_state WHERE programdata=?').get(PD1)).toEqual({ deployed_slot: 500 });   // still waiting
    await s.feed.tick();
    expect(s.db.prepare('SELECT deployed_slot FROM upgrade_state WHERE programdata=?').get(PD1)).toEqual({ deployed_slot: 800 });
    expect(s.wire).toEqual([]); expect(s.logs.some((l) => /no loader transaction explains/.test(l))).toBe(true);
  });
});

describe('public feed: rate limit and channel', () => {
  it('at most ONE post per program per 10 minutes: a second upgrade inside the gap waits and goes out when it ends; another program is not held back', async () => {
    const s = setup({ channel: '-1001' }); s.feed.loadCensus(CENSUS); await s.feed.tick();
    s.rpc.upgrade(PD1, PROG1, { sig: 'U1', slot: 700, time: 1794800300, authority: AUTH_A }); await s.feed.tick();
    expect(s.wire.map((w) => w.text.includes('U1'))).toEqual([true]);
    s.clock.v += 120_000; s.rpc.upgrade(PD1, PROG1, { sig: 'U2', slot: 701, time: 1794800420, authority: AUTH_A });
    s.rpc.upgrade(PD2, PROG2, { sig: 'V1', slot: 702, time: 1794800421, authority: AUTH_B });
    await s.feed.tick();
    expect(s.wire).toHaveLength(2); expect(s.wire[1]!.text).toContain('V1');             // program 2 posted at once, program 1's second upgrade is held
    s.clock.v += 7 * 60_000; await s.feed.tick(); expect(s.wire).toHaveLength(2);        // 9 min after the first post: still inside the gap
    s.clock.v += 61_000; const r = await s.feed.tick(); expect(r.posted).toBe(1);        // 10 min 1 s after it: out
    expect(s.wire[2]!.text).toContain('U2');
    expect((await s.feed.tick()).posted).toBe(0);
  });
  it('with SPECULA_PUBLIC_CHANNEL unset nothing is posted and nothing is lost: the post goes out once the id is set', async () => {
    const s = setup(); s.feed.loadCensus(CENSUS); await s.feed.tick();
    s.rpc.upgrade(PD1, PROG1, { sig: 'U1', slot: 700, time: 1794800300, authority: AUTH_A });
    expect((await s.feed.tick()).posted).toBe(0); await s.feed.tick(); expect(s.wire).toEqual([]);
    expect(s.logs.filter((l) => /waiting/.test(l))).toHaveLength(1);                     // said once, not every minute
    s.env.SPECULA_PUBLIC_CHANNEL = '-1002';
    expect((await s.feed.tick()).posted).toBe(1); expect(s.wire[0]).toMatchObject({ chat: '-1002' }); expect(s.wire[0]!.text).toContain('U1');
  });
  it('a failing Telegram call is kept for the next tick, not lost and not marked delivered', async () => {
    const s = setup({ channel: '-1001' }); s.feed.loadCensus(CENSUS); await s.feed.tick();
    s.rpc.upgrade(PD1, PROG1, { sig: 'U1', slot: 700, time: 1794800300, authority: AUTH_A });
    let fail = true; const real = (s.feed as any).o.fetchImpl; (s.feed as any).o.fetchImpl = async (u: any, i: any) => (fail ? new Response(JSON.stringify({ ok: false, description: 'down' }), { status: 500 }) : real(u, i));
    expect((await s.feed.tick()).posted).toBe(0); fail = false;
    expect((await s.feed.tick()).posted).toBe(1); expect(s.wire).toHaveLength(1);
  });
});

describe('free tier', () => {
  const plans = parsePlans({ plans: { starter: { name: 'Starter', price_usd: 9, tx_per_month: 5000, max_programs: 1 } }, trial: { days: 14, plan: 'starter', max_programs: 1 }, free: { max_programs: 1 } });
  function bot(o: { freeCfg?: boolean } = {}) {
    const s = setup({ channel: '-1001' }); const sent: { chat: string; text: string }[] = [];
    const engine = new Engine(s.db, { now: () => s.clock.v, env: s.env, fetchImpl: s.rpc as any });
    const cfg = o.freeCfg === false ? { ...plans, free: null } : plans;
    const svc = new Service(s.db, engine, cfg, () => s.clock.v);
    const tg: TgApi = { sendMessage: async (chat, text) => { sent.push({ chat, text }); return sent.length; }, getFile: async () => null, download: async () => Buffer.alloc(0), answerCallback: async () => {} };
    const progAcc = (pd: string) => { const d = Buffer.alloc(36); d.writeUInt32LE(2, 0); Buffer.from(bs58.decode(pd)).copy(d, 4); return { owner: LOADER, data: d }; };
    const accounts = new Map<string, { owner: string; data: Buffer }>([[PROG1, progAcc(PD1)], [PROG2, progAcc(PD2)], [key(61), { owner: 'BPFLoader2111111111111111111111111111111111', data: Buffer.alloc(36) }]]);
    const rpc = { account: async () => null, getAccountData: async (a: string) => accounts.get(a) ?? null };
    s.feed.o.sendUser = async (chat, text) => { sent.push({ chat, text }); };
    const b = new Bot(svc, { rpc: rpc as any, tg, feed: s.feed });
    const msg = (uid: number, text: string) => ({ update_id: 1, message: { chat: { id: uid, type: 'private' }, from: { id: uid }, text } });
    return { ...s, svc, b, sent, msg };
  }
  it('/start explains free versus paid in four lines, then the command list', async () => {
    const t = bot(); await t.b.handleUpdate(t.msg(1, '/start'));
    const intro = t.sent.at(-1)!.text.split('\n\n')[0]!.split('\n');
    expect(intro).toHaveLength(4); expect(intro[1]).toMatch(/^Free, no expiry: 1 program, alerts for upgrades and authority changes/); expect(intro[2]).toMatch(/^Paid \(from \$9 per 30 days/); expect(t.sent.at(-1)!.text).toContain('/watch PROGRAM_ID');
  });
  it('/watch on the free tier: one upgradeable program, no IDL, no trial started, no rules; a second program, an immutable-loader program and a missing one are refused', async () => {
    const t = bot();
    await t.b.handleUpdate(t.msg(1, `/watch ${PROG1}`));
    expect(t.sent.at(-1)!.text).toContain('for upgrades and authority changes (free, no expiry)');
    expect(t.feed.userWatches('tg:1')).toEqual([{ program_id: PROG1, programdata: PD1 }]);
    expect(t.svc.user('1')!.trial_started_at).toBeNull(); expect(t.svc.engine.programs()).toHaveLength(0);          // no IDL entry, no webhook, no polling of the program id
    await t.b.handleUpdate(t.msg(1, `/watch ${PROG2}`)); expect(t.sent.at(-1)!.text).toContain('watches 1 program'); expect(t.feed.userWatches('tg:1')).toHaveLength(1);
    await t.b.handleUpdate(t.msg(2, `/watch ${key(61)}`)); expect(t.sent.at(-1)!.text).toContain('not an upgradeable program'); expect(t.feed.userWatches('tg:2')).toEqual([]);
    await t.b.handleUpdate(t.msg(2, `/watch ${key(62)}`)); expect(t.sent.at(-1)!.text).toContain('does not exist');
    await t.b.handleUpdate(t.msg(1, `/rules ${PROG1}\n[[alerts]]\nname = "x"`)); expect(t.sent.at(-1)!.text).toContain('Rules are on the paid plans');
    await t.b.handleUpdate(t.msg(1, '/list')); expect(t.sent.at(-1)!.text).toContain(`${PROG1} (free: upgrades and authority changes)`);
    await t.b.handleUpdate(t.msg(1, '/status')); expect(t.sent.at(-1)!.text).toMatch(/^Plan: free \(no expiry\)\nPrograms: 1 \/ 1/);
    await t.b.handleUpdate(t.msg(1, `/remove ${PROG1}`)); expect(t.feed.userWatches('tg:1')).toEqual([]);
    await t.b.handleUpdate(t.msg(1, `/watch ${PROG2}`)); expect(t.feed.userWatches('tg:1')).toHaveLength(1);                     // after removing, a new one is allowed
  });
  it('a free-tier user gets a PRIVATE message when their program is upgraded (not the public channel), and a paid user keeps the old flow', async () => {
    const t = bot(); await t.b.handleUpdate(t.msg(7, `/watch ${PROG1}`)); await t.feed.tick();
    t.rpc.upgrade(PD1, PROG1, { sig: 'FREE1', slot: 900, time: 1794800500, authority: AUTH_A });
    await t.feed.tick();
    const dm = t.sent.filter((m) => m.chat === '7' && m.text.includes('FREE1')); expect(dm).toHaveLength(1);
    expect(dm[0]!.text.split('\n')[0]).toMatch(/: program upgraded$/); expect(t.wire).toEqual([]);                           // no public channel post: this is not a census program
    t.svc.activatePaid('7', 'starter');
    expect(t.svc.isFree(t.svc.user('7')!)).toBe(false);
  });
  it('a private message that fails is retried on the next tick and delivered once', async () => {
    const t = bot(); await t.b.handleUpdate(t.msg(9, `/watch ${PROG1}`)); await t.feed.tick();
    let fail = true; const sent: string[] = []; t.feed.o.sendUser = async (_c, text) => { if (fail) throw new Error('telegram down'); sent.push(text); };
    t.rpc.upgrade(PD1, PROG1, { sig: 'RETRY1', slot: 950, time: 1794800600, authority: AUTH_A });
    await t.feed.tick(); expect(sent).toEqual([]);
    fail = false; await t.feed.tick(); await t.feed.tick();
    expect(sent).toHaveLength(1); expect(sent[0]).toContain('RETRY1');
  });
  it('with the free tier off (no [free] section) /start and /watch behave exactly as before', async () => {
    const t = bot({ freeCfg: false }); await t.b.handleUpdate(t.msg(1, '/start'));
    expect(t.sent.at(-1)!.text).toContain('Free trial: 14 days'); expect(t.svc.isFree(t.svc.user('1')!)).toBe(false);
  });
});

describe('landing page sections and the feed RPC', () => {
  it('the census table and the last 10 upgrades are rendered from the feed, with the headline count of single-key programs', async () => {
    const s = setup({ channel: '-1001', gapMs: 0 }); s.feed.loadCensus(CENSUS); await s.feed.tick();
    for (let i = 0; i < 12; i++) { s.rpc.upgrade(PD1, PROG1, { sig: `UP${String(i).padStart(2, '0')}`, slot: 700 + i, time: 1794800000 + i * 60, authority: AUTH_A }); await s.feed.tick(); }
    const plans = parsePlans({ plans: { starter: { name: 'Starter', price_usd: 9, tx_per_month: 5000, max_programs: 1 } }, trial: { days: 14, plan: 'starter', max_programs: 1 }, free: { max_programs: 1 } });
    const html = renderLanding(plans, undefined, s.feed.landingData());
    expect(html).toContain('Who can change Solana&#39;s biggest programs'.replace('&#39;', "'")); expect(html).toContain('<b>1 of 2</b> upgradeable programs'); expect(html).toContain('Alpha Swap'); expect(html).toContain('single key'); expect(html).toContain('Squads v4 multisig');
    expect((html.match(/>tx<\/a>/g) ?? []).length).toBe(10); expect(html).toContain('UP11'); expect(html).not.toContain('UP01"');          // the newest 10 only
    expect(html).toContain('Free: 1 program, upgrade and authority-change alerts, no expiry');
    const pages = buildPages(plans, '/nonexistent', () => s.feed.landingData());
    const p = pages['/'] as () => { body: string }; expect(p().body).toContain('Last 10 upgrades');
    expect(JSON.parse(((pages['/upgrades.json'] as () => { body: string })()).body).last_10).toHaveLength(10);
    expect(JSON.parse(((pages['/census.json'] as () => { body: string })()).body).programs).toHaveLength(4);
  });
  it('feedRpc turns one getMultipleAccounts reply into the slot and the byte slices, null for a missing account', async () => {
    const call = async <T,>(method: string, params: unknown[]): Promise<T> => { expect(method).toBe('getMultipleAccounts'); expect((params[1] as any).dataSlice).toEqual({ offset: 0, length: 45 });
      return { context: { slot: 55 }, value: [{ data: [stateBuf(9, AUTH_A).toString('base64'), 'base64'] }, null] } as T; };
    const r = await feedRpc({ call, sigs: async () => [], tx: async () => null }).multiple([PD1, PD2], { offset: 0, length: 45 });
    expect(r.slot).toBe(55); expect(parseProgramData(r.values[0]!)).toEqual({ deployedSlot: 9, authority: AUTH_A }); expect(r.values[1]).toBeNull();
  });
});
