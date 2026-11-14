// Devnet end-to-end of the REAL verification path (RealChain: getSignaturesForAddress finalized, parsed transaction deltas, @solana/pay validateTransfer).
// Opt-in: RUN_DEVNET=1 [DEVNET_PAYER_KEYFILE=funded-devnet-keypair.json] npx vitest run test/billing-devnet.test.ts. Uses a devnet payer (airdrop, or the keyfile) and a throwaway test mint
// (Circle's devnet USDC needs a manual faucet). The mint and cluster are configuration, exactly as in production.
import { describe, it, expect } from 'vitest';
import { Connection, Keypair, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { openDb } from '../src/db.js';
import { Engine } from '../src/engine.js';
import { Service } from '../src/service.js';
import { Billing, RealChain } from '../src/billing.js';
import { parsePlans } from '../src/plans.js';

const RUN = process.env.RUN_DEVNET === '1';
const URL = process.env.DEVNET_RPC ?? 'https://api.devnet.solana.com';

describe.skipIf(!RUN)('devnet end-to-end (real chain)', () => {
  it('exact payment with the reference activates; an over-payment is rejected; validateTransfer runs at finalized', async () => {
    const conn = new Connection(URL, 'confirmed');
    // devnet's RPC faucet is closed (410 on 14 Nov 2026): fund a payer at https://faucet.solana.com and point DEVNET_PAYER_KEYFILE at its keypair JSON
    const keyfile = process.env.DEVNET_PAYER_KEYFILE;
    const payer = keyfile ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse((await import('node:fs')).readFileSync(keyfile, 'utf8')))) : Keypair.generate(); const recipient = Keypair.generate().publicKey;   // recipient key is thrown away: it only receives
    if (!keyfile) { const sig0 = await conn.requestAirdrop(payer.publicKey, 1 * LAMPORTS_PER_SOL); await conn.confirmTransaction(sig0, 'confirmed'); }
    const mint = await createMint(conn, payer, payer.publicKey, null, 6);
    const payerAta = await getOrCreateAssociatedTokenAccount(conn, payer, mint, payer.publicKey);
    const recAta = await getOrCreateAssociatedTokenAccount(conn, payer, mint, recipient);
    await mintTo(conn, payer, mint, payerAta.address, payer, 100_000_000n);
    const send = async (raw: bigint, ref: string) => {
      const ix = createTransferCheckedInstruction(getAssociatedTokenAddressSync(mint, payer.publicKey), mint, recAta.address, payer.publicKey, raw, 6);
      ix.keys.push({ pubkey: new (await import('@solana/web3.js')).PublicKey(ref), isSigner: false, isWritable: false });
      return sendAndConfirmTransaction(conn, new Transaction().add(ix), [payer]);
    };
    const cfg = parsePlans({ trial: { days: 14, plan: 'starter', max_programs: 1 }, plans: { starter: { name: 'Starter', price_usd: 9, tx_per_month: 100, max_programs: 3 } }, billing: { cluster: 'devnet', recipient: recipient.toBase58(), usdc_mint: mint.toBase58() } });
    const db = openDb(':memory:'); const svc = new Service(db, new Engine(db, {}), cfg); svc.ensureUser('1', '1');
    const sent: string[] = [];
    const billing = new Billing({ svc, chain: new RealChain(URL), cfg: cfg.billing, ownerChatId: 'o', send: async (_c, t) => { sent.push(t); return 1; } });
    const good = billing.createOrder(svc.user('1')!, cfg.plans.starter!).order, bad = billing.createOrder(svc.user('1')!, cfg.plans.starter!).order;
    const goodSig = await send(9_000_000n, good.reference); const badSig = await send(10_000_000n, bad.reference);
    let activated = 0;
    for (let i = 0; i < 40 && activated === 0; i++) { activated += await billing.poll(); if (!activated) await new Promise((r) => setTimeout(r, 5000)); }
    expect(activated).toBe(1);
    for (let i = 0; i < 12 && !db.prepare("SELECT 1 FROM payments WHERE status='rejected'").get(); i++) { await billing.poll(); await new Promise((r) => setTimeout(r, 3000)); }
    expect((db.prepare('SELECT signature, status FROM payments ORDER BY status').all() as any[]).map((r) => `${r.status}:${r.signature === goodSig ? 'good' : r.signature === badSig ? 'bad' : '?'}`)).toEqual(['activated:good', 'rejected:bad']);
    expect(svc.user('1')!.paid_plan).toBe('starter');
  }, 300_000);
});
