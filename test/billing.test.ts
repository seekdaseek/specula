import { describe, it, expect } from 'vitest';
import { openDb } from '../src/db.js';
import { Engine } from '../src/engine.js';
import { Service } from '../src/service.js';
import { Bot, type TgApi } from '../src/bot.js';
import { Billing, classify, fromRaw, toRaw, type Chain, type Delta } from '../src/billing.js';
import { parsePlans } from '../src/plans.js';

const RECIPIENT = 'Stake11111111111111111111111111111111111111';  // any public address: specula only receives
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const OWNER = '9999'; const DAY = 86_400_000;
const cfg = parsePlans({
  trial: { days: 14, plan: 'starter', max_programs: 1 },
  plans: { starter: { name: 'Starter', price_usd: 9, tx_per_month: 100, max_programs: 3 }, growth: { name: 'Growth', price_usd: 39, tx_per_month: 1000, max_programs: 10 }, proof: { name: 'Proof', price_usd: 0.1, tx_per_month: 100, max_programs: 3, hidden: true } },
  billing: { recipient: RECIPIENT, usdc_mint: USDC },
});

class MockChain implements Chain {
  sigs = new Map<string, { signature: string; err: boolean }[]>(); deltas = new Map<string, Delta[] | null>(); validateErr: string | null = null; validated: string[] = []; calls = 0;
  async signaturesFor(ref: string) { this.calls++; return this.sigs.get(ref) ?? []; }
  async recipientDeltas(sig: string) { return this.deltas.get(sig) ?? null; }
  async validate(sig: string) { this.validated.push(sig); if (this.validateErr) throw new Error(this.validateErr); }
  pay(ref: string, sig: string, deltas: Delta[], err = false) { this.sigs.set(ref, [...(this.sigs.get(ref) ?? []), { signature: sig, err }]); this.deltas.set(sig, deltas); }
}

function setup() {
  const clock = { v: Date.UTC(2026, 10, 14, 12) };
  const db = openDb(':memory:'); const engine = new Engine(db, { now: () => clock.v });
  const svc = new Service(db, engine, cfg, () => clock.v);
  const chain = new MockChain(); const sent: { chat: string; text: string }[] = []; const photos: string[] = [];
  const send = async (chat: string, text: string) => { sent.push({ chat, text }); return sent.length; };
  const billing = new Billing({ svc, chain, cfg: cfg.billing, ownerChatId: OWNER, send, now: () => clock.v });
  const tg: TgApi = { sendMessage: send, getFile: async () => null, download: async () => Buffer.alloc(0), sendPhoto: async (_c, png) => { photos.push(png.subarray(1, 4).toString()); return 1; } };
  const bot = new Bot(svc, { rpc: {} as any, tg, billing, ownerChatId: OWNER });
  svc.ensureUser('1', '1');
  return { clock, db, svc, chain, sent, photos, billing, bot };
}
const msg = (uid: number, text: string) => ({ update_id: 1, message: { chat: { id: uid, type: 'private' }, from: { id: uid }, text } });
const usdcRaw = (usd: number) => [{ mint: USDC, raw: toRaw(usd, 6) }];

describe('amounts', () => {
  it('raw/ui conversion', () => { expect(toRaw(9, 6)).toBe(9_000_000n); expect(toRaw(0.1, 6)).toBe(100_000n); expect(fromRaw(100_000n, 6)).toBe('0.1'); expect(fromRaw(9_000_000n, 6)).toBe('9'); expect(fromRaw(39_500_000n, 6)).toBe('39.5'); });
  it('classify: exact amount only; over, under, wrong mint, nothing', () => {
    expect(classify(usdcRaw(9), USDC, 9_000_000n).kind).toBe('ok');
    expect(classify(usdcRaw(9.000001), USDC, 9_000_000n).kind).toBe('wrong_amount');   // overpaying is a mismatch too
    expect(classify(usdcRaw(8.99), USDC, 9_000_000n).kind).toBe('wrong_amount');
    expect(classify([{ mint: USDT, raw: 9_000_000n }], USDC, 9_000_000n).kind).toBe('wrong_mint');
    expect(classify([{ mint: USDC, raw: -5n }], USDC, 9_000_000n).kind).toBe('none');
  });
});

describe('/plans and /upgrade', () => {
  it('/plans lists Starter, Growth with config limits and hides the proof plan from everyone except the owner', async () => {
    const s = setup();
    await s.bot.handleUpdate(msg(1, '/plans')); const t = s.sent.at(-1)!.text;
    expect(t).toContain('Starter: $9 per 30 days, 100 tx per program per month, up to 3 programs'); expect(t).toContain('Growth: $39'); expect(t).not.toContain('Proof');
    await s.bot.handleUpdate(msg(Number(OWNER), '/plans')); expect(s.sent.at(-1)!.text).toContain('Proof: $0.1');
    await s.bot.handleUpdate(msg(1, '/upgrade proof')); expect(s.sent.at(-1)!.text).toContain('Unknown plan');
  });
  it('/upgrade creates a fresh reference, a Solana Pay link with amount, USDC mint, recipient and reference, a 30 minute expiry, and a QR image', async () => {
    const s = setup();
    await s.bot.handleUpdate(msg(1, '/upgrade starter'));
    const o = s.db.prepare('SELECT * FROM billing_orders').get() as any;
    expect(o.amount_raw).toBe('9000000'); expect(o.expires_at - o.created_at).toBe(30 * 60_000); expect(o.plan_id).toBe('starter');
    const text = s.sent.at(-1)!.text; const link = text.match(/solana:\S+/)![0]; const u = new URL(link);
    expect(u.pathname).toBe(RECIPIENT); expect(u.searchParams.get('amount')).toBe('9'); expect(u.searchParams.get('spl-token')).toBe(USDC); expect(u.searchParams.get('reference')).toBe(o.reference); expect(u.searchParams.get('label')).toBe('specula');
    expect(s.photos).toEqual(['PNG']);
    await s.bot.handleUpdate(msg(1, '/upgrade starter')); const refs = s.db.prepare('SELECT reference FROM billing_orders').all() as any[];
    expect(new Set(refs.map((r) => r.reference)).size).toBe(2);   // fresh reference each time
  });
  it('the owner can buy the hidden proof plan at 0.10 USDC (link amount 0.1)', async () => {
    const s = setup(); s.svc.ensureUser(OWNER, OWNER);
    await s.bot.handleUpdate(msg(Number(OWNER), '/upgrade proof'));
    expect(new URL(s.sent.at(-1)!.text.match(/solana:\S+/)![0]).searchParams.get('amount')).toBe('0.1');
    expect((s.db.prepare('SELECT amount_raw FROM billing_orders').get() as any).amount_raw).toBe('100000');
  });
});

describe('verification and activation', () => {
  const order = async (s: ReturnType<typeof setup>, plan = 'starter') => { await s.bot.handleUpdate(msg(1, `/upgrade ${plan}`)); return s.db.prepare('SELECT * FROM billing_orders ORDER BY id DESC').get() as any; };
  it('a matching payment activates the plan for 30 days, confirms to the user and sends the owner one line with the signature; /billing lists it', async () => {
    const s = setup(); const o = await order(s); s.sent.length = 0;
    s.chain.pay(o.reference, 'SIG1', usdcRaw(9));
    expect(await s.billing.poll()).toBe(1);
    const u = s.svc.user('1')!; expect(u.paid_plan).toBe('starter'); expect(u.paid_until).toBe(s.clock.v + 30 * DAY); expect(s.svc.state(u)).toBe('paid');
    expect(s.sent.find((m) => m.chat === '1')!.text).toContain('Starter is active until');
    expect(s.sent.find((m) => m.chat === OWNER)!.text).toContain('SIG1'); expect(s.sent.filter((m) => m.chat === OWNER).length).toBe(1);
    expect(s.chain.validated).toEqual(['SIG1']);
    await s.bot.handleUpdate(msg(1, '/billing')); expect(s.sent.at(-1)!.text).toContain('SIG1'); expect(s.sent.at(-1)!.text).toContain('Plan: Starter (active)');
  });
  it('double delivery of the same payment activates once and notifies once', async () => {
    const s = setup(); const o = await order(s); s.chain.pay(o.reference, 'SIG1', usdcRaw(9)); s.sent.length = 0;
    await s.billing.poll(); await s.billing.poll(); await s.billing.checkOrder(o);
    s.chain.sigs.get(o.reference)!.push({ signature: 'SIG1', err: false });          // the RPC lists it again
    await s.billing.checkOrder(o);
    expect((s.db.prepare("SELECT COUNT(*) n FROM payments WHERE status='activated'").get() as any).n).toBe(1);
    expect(s.svc.user('1')!.paid_until).toBe(s.clock.v + 30 * DAY); expect(s.sent.length).toBe(2);
  });
  it('wrong amount (under and over): not activated, user told plainly, owner gets the signature', async () => {
    for (const [sig, usd] of [['LOW', 8.5], ['HIGH', 9.5]] as const) {
      const s = setup(); const o = await order(s); s.chain.pay(o.reference, sig, usdcRaw(usd)); s.sent.length = 0;
      expect(await s.billing.poll()).toBe(0);
      expect(s.svc.user('1')!.paid_plan).toBeNull(); expect(s.chain.validated).toEqual([]);
      expect(s.sent.find((m) => m.chat === '1')!.text).toMatch(/plan costs exactly 9 USDC/); expect(s.sent.find((m) => m.chat === OWNER)!.text).toContain(sig);
      await s.billing.poll(); expect(s.sent.length).toBe(2);   // told once, not on every poll
    }
  });
  it('wrong mint: not activated, plain message, owner told', async () => {
    const s = setup(); const o = await order(s); s.chain.pay(o.reference, 'USDT1', [{ mint: USDT, raw: 9_000_000n }]); s.sent.length = 0;
    await s.billing.poll(); expect(s.svc.user('1')!.paid_plan).toBeNull();
    expect(s.sent.find((m) => m.chat === '1')!.text).toContain('was not USDC'); expect(s.sent.find((m) => m.chat === OWNER)!.text).toContain('USDT1');
  });
  it('validateTransfer failing after an exact amount match still blocks activation', async () => {
    const s = setup(); const o = await order(s); s.chain.validateErr = 'invalid reference'; s.chain.pay(o.reference, 'SIGV', usdcRaw(9));
    await s.billing.poll(); expect(s.svc.user('1')!.paid_plan).toBeNull(); expect(s.chain.validated).toEqual(['SIGV']);
  });
  it('failed transactions and transfers that move nothing to us are ignored', async () => {
    const s = setup(); const o = await order(s); s.sent.length = 0;
    s.chain.pay(o.reference, 'FAILED', usdcRaw(9), true); s.chain.pay(o.reference, 'EMPTY', []);
    await s.billing.poll(); expect(s.svc.user('1')!.paid_plan).toBeNull(); expect(s.sent.length).toBe(0);
  });
  it('a payment that is not retrievable yet is retried on the next poll', async () => {
    const s = setup(); const o = await order(s); s.chain.sigs.set(o.reference, [{ signature: 'LATER', err: false }]);
    expect(await s.billing.poll()).toBe(0); s.chain.deltas.set('LATER', usdcRaw(9)); expect(await s.billing.poll()).toBe(1);
  });
  it('late payment (after the 30-minute window, even days later) is still honoured', async () => {
    const s = setup(); const o = await order(s);
    s.clock.v += 3 * DAY; s.chain.pay(o.reference, 'LATE', usdcRaw(9)); s.sent.length = 0;
    expect(await s.billing.poll()).toBe(1); expect(s.sent.find((m) => m.chat === '1')!.text).toContain('arrived after the 30-minute window');
    expect(s.svc.user('1')!.paid_until).toBe(s.clock.v + 30 * DAY);
  });
  it('orders older than the late-payment horizon are no longer polled', async () => {
    const s = setup(); const o = await order(s); s.clock.v += 15 * DAY; s.chain.pay(o.reference, 'TOOLATE', usdcRaw(9)); s.chain.calls = 0;
    expect(await s.billing.poll()).toBe(0); expect(s.chain.calls).toBe(0);
  });
  it('renewal stacks: a second payment while active extends from the current expiry; a payment after expiry starts from now', async () => {
    const s = setup(); const o1 = await order(s); s.chain.pay(o1.reference, 'P1', usdcRaw(9)); await s.billing.poll();
    const t0 = s.clock.v; s.clock.v += 10 * DAY;
    const o2 = await order(s); s.chain.pay(o2.reference, 'P2', usdcRaw(9)); await s.billing.poll();
    expect(s.svc.user('1')!.paid_until).toBe(t0 + 60 * DAY);
    s.clock.v = t0 + 70 * DAY;    // past expiry + grace
    const o3 = await order(s); s.chain.pay(o3.reference, 'P3', usdcRaw(9)); await s.billing.poll();
    expect(s.svc.user('1')!.paid_until).toBe(s.clock.v + 30 * DAY);
  });
  it('a second valid payment for an already paid order is kept but not stacked; the owner is told', async () => {
    const s = setup(); const o = await order(s); s.chain.pay(o.reference, 'A', usdcRaw(9)); await s.billing.poll(); s.sent.length = 0;
    s.chain.pay(o.reference, 'B', usdcRaw(9)); await s.billing.poll();
    expect(s.svc.user('1')!.paid_until).toBe(s.clock.v + 30 * DAY); expect(s.sent.find((m) => m.chat === OWNER)!.text).toContain('EXTRA');
  });
  it('payment in a different order of two users never activates the wrong user (a reference belongs to one order)', async () => {
    const s = setup(); s.svc.ensureUser('2', '2'); const o = await order(s);
    s.chain.pay(o.reference, 'X', usdcRaw(9)); await s.billing.poll();
    expect(s.svc.user('2')!.paid_plan).toBeNull(); expect(s.svc.user('1')!.paid_plan).toBe('starter');
  });
});

describe('expiry, reminders and grace (fake clock)', () => {
  it('reminders 3 days before and on the expiry day, then 3 days of grace with alerts still allowed, then alerts pause; each message once', async () => {
    const s = setup(); await s.bot.handleUpdate(msg(1, '/upgrade starter')); const o = s.db.prepare('SELECT * FROM billing_orders').get() as any;
    s.chain.pay(o.reference, 'P1', usdcRaw(9)); await s.billing.poll(); const t0 = s.clock.v; const until = t0 + 30 * DAY;
    s.svc.engine.addTenant('tg:1', { telegram: { chat_id: '1' } });
    s.clock.v = until - 5 * DAY; expect(s.svc.tick()).toEqual([]);
    s.clock.v = until - 3 * DAY + 1000; let n = s.svc.tick(); expect(n.length).toBe(1); expect(n[0]!.text).toContain('expires on'); expect(s.svc.tick()).toEqual([]);
    s.clock.v = until + 1000; n = s.svc.tick(); expect(n.length).toBe(1); expect(n[0]!.text).toContain('expired today'); expect(s.svc.paidPhase(s.svc.user('1')!)).toBe('grace'); expect(s.svc.canAlert('tg:1', 'P')).toBe(true);
    s.clock.v = until + 2 * DAY; expect(s.svc.tick()).toEqual([]); expect(s.svc.canAlert('tg:1', 'P')).toBe(true);
    s.clock.v = until + 3 * DAY + 1000; n = s.svc.tick(); expect(n.length).toBe(1); expect(n[0]!.text).toContain('grace period is over');
    expect(s.svc.canAlert('tg:1', 'P')).toBe(false); expect(s.svc.state(s.svc.user('1')!)).toBe('expired');
    await s.bot.handleUpdate(msg(1, '/billing')); expect(s.sent.at(-1)!.text).toContain('Plan: none (trial ended)');
  });
  it('renewing resets the reminders for the next period', async () => {
    const s = setup(); const o = (await s.bot.handleUpdate(msg(1, '/upgrade starter')), s.db.prepare('SELECT * FROM billing_orders').get() as any); s.chain.pay(o.reference, 'P1', usdcRaw(9)); await s.billing.poll();
    s.clock.v += 28 * DAY; expect(s.svc.tick().length).toBe(1);
    await s.bot.handleUpdate(msg(1, '/upgrade starter')); const o2 = s.db.prepare('SELECT * FROM billing_orders ORDER BY id DESC').get() as any; s.chain.pay(o2.reference, 'P2', usdcRaw(9)); await s.billing.poll();
    expect(s.svc.user('1')!.renew_flags).toBe(''); s.clock.v += 30 * DAY; expect(s.svc.tick().length).toBe(1);
  });
  it('plan limits follow the paid plan (Growth quota and program count)', async () => {
    const s = setup(); await s.bot.handleUpdate(msg(1, '/upgrade growth')); const o = s.db.prepare('SELECT * FROM billing_orders').get() as any;
    s.chain.pay(o.reference, 'G', usdcRaw(39)); await s.billing.poll();
    const l = s.svc.limits(s.svc.user('1')!)!; expect(l.plan.txPerMonth).toBe(1000); expect(l.maxPrograms).toBe(10);
  });
});

describe('/support', () => {
  it('forwards the text with the sender\'s Telegram id to the owner chat, acks the user, and rate-limits', async () => {
    const s = setup();
    await s.bot.handleUpdate(msg(1, '/support my alerts stopped\nplease check')); 
    const fwd = s.sent.find((m) => m.chat === OWNER)!.text; expect(fwd).toContain('Telegram id 1'); expect(fwd).toContain('my alerts stopped'); expect(fwd).toContain('please check');
    expect(s.sent.at(-1)).toEqual({ chat: '1', text: 'Sent. The operator will reply here by hand.' });
    await s.bot.handleUpdate(msg(1, '/support')); expect(s.sent.at(-1)!.text).toContain('Usage');
    for (let i = 0; i < 6; i++) await s.bot.handleUpdate(msg(1, '/support spam'));
    expect(s.sent.at(-1)!.text).toContain('Too many'); expect(s.sent.filter((m) => m.chat === OWNER).length).toBe(5);
  });
});

import { strictCheck, RealChain } from '../src/billing.js';
describe('strict fallback check (transactions @solana/pay cannot read)', () => {
  const REF = '8pM1DN3RiT8vgfaBVRUzf4x1qaGzGyqqK7r3xW1uq3ge'; const OTHER = '7nYabs9dUhvxYwdTnrWNVcX1vjnmGxHYVFRP9xYNb2aV';
  const p = { recipient: RECIPIENT, mint: USDC, amountRaw: 100_000n, reference: REF };
  const tx = (o: { err?: unknown; mint?: string; owner?: string; raw?: string; keys?: string[]; loaded?: string[] } = {}) => ({
    meta: {
      err: o.err ?? null,
      preTokenBalances: [{ owner: o.owner ?? RECIPIENT, mint: o.mint ?? USDC, uiTokenAmount: { amount: '5000000' } }],
      postTokenBalances: [{ owner: o.owner ?? RECIPIENT, mint: o.mint ?? USDC, uiTokenAmount: { amount: String(5_000_000n + BigInt(o.raw ?? '100000')) } }],
      loadedAddresses: { writable: [], readonly: o.loaded ?? [] },
    },
    transaction: { message: { accountKeys: (o.keys ?? ['payer', REF]).map((pubkey) => ({ pubkey })) } },
  });
  it('positive control: successful, exact amount, right owner and mint, reference present', () => { expect(() => strictCheck(tx(), p)).not.toThrow(); });
  it('failed transaction that carries the reference is rejected', () => { expect(() => strictCheck(tx({ err: { InstructionError: [0, 'Custom'] } }), p)).toThrow(/failed on chain/); });
  it('fake mint with the same amount is rejected', () => { expect(() => strictCheck(tx({ mint: 'FakeMint1111111111111111111111111111111111' }), p)).toThrow(/expected exactly/); });
  it('transfer of the right mint and amount to a different owner is rejected', () => { expect(() => strictCheck(tx({ owner: OTHER }), p)).toThrow(/expected exactly/); });
  it('wrong amounts (under and over) are rejected', () => { for (const raw of ['99999', '100001']) expect(() => strictCheck(tx({ raw }), p)).toThrow(/expected exactly/); });
  it('reference loaded from an address lookup table is accepted; a reference nowhere in the keys is rejected', () => {
    expect(() => strictCheck(tx({ keys: ['payer'], loaded: [REF] }), p)).not.toThrow();
    expect(() => strictCheck(tx({ keys: ['payer'], loaded: [OTHER] }), p)).toThrow(/reference not found/);
  });
  it('RealChain.strictValidate reads at FINALIZED commitment with version 1 allowed, and refuses a transaction that is not finalized yet', async () => {
    const seen: any[] = []; let result: any = tx();
    const f = (async (_u: any, init: any) => { seen.push(JSON.parse(init.body)); return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result })); }) as typeof fetch;
    const chain = new RealChain('https://rpc.invalid/?api-key=SECRET', f);
    await chain.strictValidate('SIG', { recipient: RECIPIENT, amountRaw: 100_000n, mint: USDC, reference: REF });
    expect(seen[0].method).toBe('getTransaction'); expect(seen[0].params[1]).toMatchObject({ commitment: 'finalized', maxSupportedTransactionVersion: 1 });
    result = null; await expect(chain.strictValidate('SIG', { recipient: RECIPIENT, amountRaw: 100_000n, mint: USDC, reference: REF })).rejects.toThrow(/not finalized/);
    result = tx({ err: 'x' }); await expect(chain.strictValidate('SIG', { recipient: RECIPIENT, amountRaw: 100_000n, mint: USDC, reference: REF })).rejects.toThrow(/failed on chain/);
  });
});
