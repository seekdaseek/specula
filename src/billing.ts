// USDC billing over Solana Pay transfer requests, verified by specula itself. specula only ever RECEIVES: the recipient is a public address from config.
import { Keypair } from '@solana/web3.js';
// @solana/pay, @solana/kit and qrcode are loaded lazily (they add ~25 MB RSS); the service must stay under 150 MB until the first payment is verified.
import type { DB } from './db.js';
import type { Service, UserRow } from './service.js';
import type { BillingConfig, Plan } from './plans.js';

export interface SigInfo { signature: string; err: boolean }
export interface Delta { mint: string; raw: bigint }
export interface Chain {
  /** finalized signatures that reference `reference`, oldest first */
  signaturesFor(reference: string): Promise<SigInfo[]>;
  /** token balance changes of the recipient owner in that transaction; null when the transaction is not available */
  recipientDeltas(signature: string, recipient: string): Promise<Delta[] | null>;
  /** @solana/pay validateTransfer at finalized commitment; throws on any mismatch */
  validate(signature: string, p: { recipient: string; amountUi: number; amountRaw: bigint; mint: string; reference?: string }): Promise<void>;
}

export type Verdict = { kind: 'ok' } | { kind: 'wrong_amount'; raw: bigint } | { kind: 'wrong_mint'; received: Delta[] } | { kind: 'none' };
/** Exact-amount check: the expected mint must have received EXACTLY expectedRaw (overpaying is a mismatch too; validateTransfer alone would accept it). */
export function classify(deltas: Delta[], mint: string, expectedRaw: bigint): Verdict {
  const mine = deltas.filter((d) => d.mint === mint).reduce((a, d) => a + d.raw, 0n);
  if (mine === expectedRaw) return { kind: 'ok' };
  if (mine > 0n) return { kind: 'wrong_amount', raw: mine };
  const other = deltas.filter((d) => d.mint !== mint && d.raw > 0n);
  return other.length ? { kind: 'wrong_mint', received: other } : { kind: 'none' };
}

/**
 * Strict self-contained check used when @solana/pay cannot read a transaction (version 1, or address lookup tables). Throws unless ALL hold:
 *  1. meta.err is null (the transaction succeeded); 2. (caller) it was fetched at finalized commitment;
 *  3. the increase of the recipient OWNER's balance in the expected MINT, from preTokenBalances/postTokenBalances, equals amountRaw exactly;
 *  4. the reference key is among the account keys, including lookup-table-loaded addresses.
 */
export function strictCheck(tx: any, p: { recipient: string; mint: string; amountRaw: bigint; reference: string }): void {
  const meta = tx?.meta; if (!meta) throw new Error('transaction not available');
  if (meta.err !== null && meta.err !== undefined) throw new Error('transaction failed on chain');
  let delta = 0n;
  for (const b of meta.postTokenBalances ?? []) if (b.owner === p.recipient && b.mint === p.mint) delta += BigInt(b.uiTokenAmount.amount);
  for (const b of meta.preTokenBalances ?? []) if (b.owner === p.recipient && b.mint === p.mint) delta -= BigInt(b.uiTokenAmount.amount);
  if (delta !== p.amountRaw) throw new Error(`recipient received ${delta} of the expected mint, expected exactly ${p.amountRaw}`);
  const keys: string[] = [...(tx.transaction?.message?.accountKeys ?? []).map((k: any) => (typeof k === 'string' ? k : k.pubkey)), ...(meta.loadedAddresses?.writable ?? []), ...(meta.loadedAddresses?.readonly ?? [])];
  if (!keys.includes(p.reference)) throw new Error('reference not found in transaction');
}

export const toRaw = (usd: number, decimals: number): bigint => BigInt(Math.round(usd * 10 ** decimals));
export const fromRaw = (raw: bigint, decimals: number): string => {
  const s = raw.toString().padStart(decimals + 1, '0'); const int = s.slice(0, -decimals); const frac = s.slice(-decimals).replace(/0+$/, '');
  return frac ? `${int}.${frac}` : int;
};

export class RealChain implements Chain {
  constructor(private url: string, private f: typeof fetch = fetch, private log: (m: string) => void = () => {}) {}
  private async call<T>(method: string, params: unknown[]): Promise<T> {
    const r = await this.f(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`rpc ${method}: HTTP ${r.status}`);   // never echo the URL (it holds the key)
    const j: any = await r.json(); if (j.error) throw new Error(`rpc ${method}: ${String(j.error.message ?? '').slice(0, 100)}`);
    return j.result as T;
  }
  async signaturesFor(reference: string): Promise<SigInfo[]> {
    // Same RPC call as @solana/pay findReference, but all signatures: findReference returns only the oldest, so a failed attempt would mask a later good payment.
    const r = await this.call<{ signature: string; err: unknown }[]>('getSignaturesForAddress', [reference, { commitment: 'finalized', limit: 100 }]);
    return [...r].reverse().map((x) => ({ signature: x.signature, err: x.err !== null && x.err !== undefined }));
  }
  async recipientDeltas(signature: string, recipient: string): Promise<Delta[] | null> {
    const tx = await this.call<any>('getTransaction', [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, commitment: 'finalized' }]);   // mainnet has version-1 transactions
    if (!tx?.meta) return null;
    const sum = (bs: any[] | undefined) => { const m = new Map<string, bigint>(); for (const b of bs ?? []) if (b.owner === recipient) m.set(b.mint, (m.get(b.mint) ?? 0n) + BigInt(b.uiTokenAmount.amount)); return m; };
    const pre = sum(tx.meta.preTokenBalances), post = sum(tx.meta.postTokenBalances);
    return [...new Set([...pre.keys(), ...post.keys()])].map((mint) => ({ mint, raw: (post.get(mint) ?? 0n) - (pre.get(mint) ?? 0n) }));
  }
  /** Fetch at FINALIZED commitment (version 1 allowed) and apply strictCheck. */
  async strictValidate(signature: string, p: { recipient: string; amountRaw: bigint; mint: string; reference?: string }): Promise<void> {
    if (!p.reference) throw new Error('reference required');
    const tx = await this.call<any>('getTransaction', [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, commitment: 'finalized' }]);
    if (!tx) throw new Error('transaction not finalized yet');
    strictCheck(tx, { recipient: p.recipient, mint: p.mint, amountRaw: p.amountRaw, reference: p.reference });
  }
  async validate(signature: string, p: { recipient: string; amountUi: number; amountRaw: bigint; mint: string; reference?: string }): Promise<void> {
    const [{ validateTransfer }, { address, createSolanaRpc }] = await Promise.all([import('@solana/pay'), import('@solana/kit')]);
    try {
      await validateTransfer(createSolanaRpc(this.url) as any, signature as any, { recipient: address(p.recipient), amount: p.amountUi, splToken: address(p.mint), ...(p.reference ? { reference: address(p.reference) } : {}) }, { commitment: 'finalized' });
      this.log(`validateTransfer ok ${signature.slice(0, 12)}`);
    } catch (e) {
      // @solana/pay reads transactions with maxSupportedTransactionVersion 0 and static accounts only, so it cannot read version-1 transactions or v0 transactions that use address lookup tables.
      if (!/version|missing instruction accounts/i.test((e as Error).message) || !p.reference) throw e;
      await this.strictValidate(signature, p);
      this.log(`fallback validation ok (strict check: no error, finalized, exact owner+mint delta, reference in keys) ${signature.slice(0, 12)}`);
    }
  }
}

export interface OrderRow { id: number; telegram_id: string; plan_id: string; amount_raw: string; reference: string; created_at: number; expires_at: number; status: string; last_checked: number }
export interface BillingDeps { svc: Service; chain: Chain; cfg: BillingConfig; ownerChatId: string; send: (chatId: string, text: string) => Promise<number | undefined>; log?: (m: string) => void; now?: () => number }

export class Billing {
  private now: () => number;
  constructor(private d: BillingDeps) { this.now = d.now ?? d.svc.now; }
  private get db(): DB { return this.d.svc.db; }
  private usd(raw: bigint | string) { return fromRaw(BigInt(raw), this.d.cfg.decimals); }

  visiblePlans(telegramId: string): Plan[] { return Object.values(this.d.svc.cfg.plans).filter((p) => !p.hidden || telegramId === this.d.ownerChatId); }
  plan(id: string, telegramId: string): Plan | undefined { return this.visiblePlans(telegramId).find((p) => p.id === id); }

  /** Create an order with a fresh reference key. Only the public key is kept. */
  createOrder(u: UserRow, plan: Plan): { order: OrderRow; link: string } {
    if (!this.d.cfg.recipient) throw new Error('billing recipient is not configured');
    const open = (this.db.prepare("SELECT COUNT(*) n FROM billing_orders WHERE telegram_id=? AND status='open' AND expires_at > ?").get(u.telegram_id, this.now()) as { n: number }).n;
    if (open >= 5) throw new Error('You have 5 unpaid payment requests open. Pay one or wait 30 minutes.');
    const reference = Keypair.generate().publicKey.toBase58();
    const raw = toRaw(plan.priceUsd, this.d.cfg.decimals);
    const t = this.now(); const exp = t + this.d.cfg.orderTtlMinutes * 60_000;
    const id = Number(this.db.prepare('INSERT INTO billing_orders (telegram_id, plan_id, amount_raw, reference, created_at, expires_at) VALUES (?,?,?,?,?,?)').run(u.telegram_id, plan.id, raw.toString(), reference, t, exp).lastInsertRowid);
    // Solana Pay transfer request (spec: solana:<recipient>?amount&spl-token&reference&label&message)
    const link = `solana:${this.d.cfg.recipient}?amount=${this.usd(raw)}&spl-token=${this.d.cfg.usdcMint}&reference=${reference}&label=specula&message=${encodeURIComponent(`specula ${plan.name} ${this.d.svc.cfg.billing.periodDays} days`)}`;
    return { order: this.db.prepare('SELECT * FROM billing_orders WHERE id=?').get(id) as OrderRow, link };
  }
  async qr(link: string): Promise<Buffer> { const QRCode = (await import('qrcode')).default; return QRCode.toBuffer(link, { type: 'png', margin: 2, width: 512 }); }

  /** Check every order that can still receive money: open ones every call, expired ones (late payments are honoured) every 10 minutes for lateOrderDays. */
  async poll(): Promise<number> {
    const now = this.now(); const late = this.d.cfg.lateOrderDays * 86_400_000;
    const orders = this.db.prepare("SELECT * FROM billing_orders WHERE status IN ('open','paid') AND created_at > ? AND (expires_at > ? OR last_checked < ?)").all(now - late, now, now - 600_000) as OrderRow[];
    let activated = 0;
    for (const o of orders) {
      try { activated += await this.checkOrder(o); } catch (e) { this.d.log?.(`billing check order ${o.id}: ${(e as Error).message}`); }
      this.db.prepare('UPDATE billing_orders SET last_checked=? WHERE id=?').run(now, o.id);
    }
    return activated;
  }

  async checkOrder(o: OrderRow): Promise<number> {
    const d = this.d; const sigs = await d.chain.signaturesFor(o.reference); let activated = 0;
    for (const s of sigs) {
      if (s.err) continue;
      if (this.db.prepare('SELECT 1 FROM payments WHERE signature=?').get(s.signature)) continue;     // already handled: a re-delivery never activates twice
      const deltas = await d.chain.recipientDeltas(s.signature, d.cfg.recipient); if (!deltas) continue;   // not retrievable yet: retry next poll
      const v = classify(deltas, d.cfg.usdcMint, BigInt(o.amount_raw));
      if (v.kind === 'none') { this.record(s.signature, o, 'ignored', 'no tokens reached the recipient'); continue; }
      if (v.kind !== 'ok') { await this.reject(o, s.signature, v); continue; }
      try { await d.chain.validate(s.signature, { recipient: d.cfg.recipient, amountUi: Number(this.usd(o.amount_raw)), amountRaw: BigInt(o.amount_raw), mint: d.cfg.usdcMint, reference: o.reference }); }
      catch (e) { await this.reject(o, s.signature, { kind: 'none' }, `validateTransfer: ${(e as Error).message}`); continue; }
      const fresh = this.db.prepare('SELECT status FROM billing_orders WHERE id=?').get(o.id) as { status: string };
      if (fresh.status === 'paid') {      // second valid payment for an already paid order: keep the money, do not stack silently, tell the owner
        this.record(s.signature, o, 'extra', 'second payment for a paid order');
        await this.owner(`EXTRA payment for an already paid order #${o.id} (${o.plan_id}, ${this.usd(o.amount_raw)} USDC), signature ${s.signature}. Not activated; refund or credit by hand.`);
        continue;
      }
      await this.activate(o, s.signature); activated++;
    }
    return activated;
  }

  private record(signature: string, o: OrderRow, status: string, detail: string) {
    this.db.prepare('INSERT OR IGNORE INTO payments (signature, order_id, telegram_id, plan_id, amount_raw, status, detail, created_at) VALUES (?,?,?,?,?,?,?,?)').run(signature, o.id, o.telegram_id, o.plan_id, o.amount_raw, status, detail, this.now());
  }
  private async owner(text: string) { const id = await this.d.send(this.d.ownerChatId, text).catch((e) => { this.d.log?.(`owner notify failed: ${(e as Error).message}`); return undefined; }); this.d.log?.(`owner message_id=${id}`); return id; }

  private async activate(o: OrderRow, signature: string) {
    const svc = this.d.svc; const u = svc.user(o.telegram_id)!;
    const plan = svc.cfg.plans[o.plan_id]!;
    // one transaction: the payment row (primary key = signature) and the activation happen together or not at all
    const tx = this.db.transaction(() => {
      const ins = this.db.prepare('INSERT OR IGNORE INTO payments (signature, order_id, telegram_id, plan_id, amount_raw, status, detail, created_at) VALUES (?,?,?,?,?,?,?,?)').run(signature, o.id, o.telegram_id, o.plan_id, o.amount_raw, 'activated', '', this.now());
      if (ins.changes === 0) return null;
      this.db.prepare("UPDATE billing_orders SET status='paid' WHERE id=?").run(o.id);
      return svc.activatePaid(o.telegram_id, o.plan_id);
    });
    const until = tx(); if (until === null) return;
    const late = this.now() > o.expires_at ? ' (it arrived after the 30-minute window; honoured)' : '';
    const mid = await this.d.send(u.chat_id, `Payment received: ${this.usd(o.amount_raw)} USDC. ${plan.name} is active until ${new Date(until).toISOString().slice(0, 10)}${late}. /billing shows the details.`).catch(() => undefined);
    this.d.log?.(`activation message_id=${mid}`);
    await this.owner(`PAID: ${plan.name} ${this.usd(o.amount_raw)} USDC from Telegram ${o.telegram_id}, signature ${signature}`);
  }

  private async reject(o: OrderRow, signature: string, v: Verdict, extra?: string) {
    const d = this.d;
    const exp = `${this.usd(o.amount_raw)} USDC`;
    const what = extra ? `the payment could not be validated (${extra})` : v.kind === 'wrong_amount' ? `it carried ${fromRaw(v.raw, d.cfg.decimals)} USDC but the plan costs exactly ${exp}` : v.kind === 'wrong_mint' ? `it was not USDC (${v.received.map((x) => `${x.raw} units of ${x.mint}`).join(', ')})` : 'it did not match';
    this.record(signature, o, 'rejected', what);
    const u = d.svc.user(o.telegram_id); const user = u ? await d.send(u.chat_id, `We received a payment (${signature}) for your request, but ${what}. Nothing was activated. Send /support with this signature and we will refund it by hand.`).catch(() => undefined) : undefined;
    d.log?.(`reject message_id=${user}`);
    await this.owner(`REJECTED payment for order #${o.id} (${o.plan_id}) from Telegram ${o.telegram_id}: ${what}. Signature ${signature}. Refund by hand.`);
  }

  history(telegramId: string): { signature: string; plan_id: string; amount_raw: string; status: string; created_at: number }[] {
    return this.db.prepare('SELECT signature, plan_id, amount_raw, status, created_at FROM payments WHERE telegram_id=? AND status IN (\'activated\',\'rejected\',\'extra\') ORDER BY created_at DESC LIMIT 10').all(telegramId) as any;
  }
}
