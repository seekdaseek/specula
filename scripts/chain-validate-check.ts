// Live positive/negative control of RealChain.validate (@solana/pay validateTransfer, finalized) on MAINNET, read only:
// a real USDC payment that arrived at the treasury's USDC token account. Not a Solana Pay reference transaction, so no reference is checked here.
import fs from 'node:fs';
import { RealChain } from '../src/billing.js';
const K = fs.readFileSync('.env', 'utf8').split('\n').find((l) => l.startsWith('HELIUS_API_KEY='))!.slice(15).trim();
const url = `https://mainnet.helius-rpc.com/?api-key=${K}`;
const RECIP = process.env.RECIPIENT ?? (() => { throw new Error('set RECIPIENT to a public address that has received USDC'); })(), MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const rpc = async (m: string, p: unknown[]) => { for (let a = 0; a < 6; a++) { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) }); if (r.status === 429) { await new Promise((x) => setTimeout(x, 2000)); continue; } return ((await r.json()) as any).result; } throw new Error('rate limited'); };
const ata = (await rpc('getTokenAccountsByOwner', [RECIP, { mint: MINT }, { encoding: 'jsonParsed' }])).value[0].pubkey;
const chain = new RealChain(url);
const sigs = await rpc('getSignaturesForAddress', [ata, { limit: 300 }]);
let tried = 0;
for (const s of sigs) {
  if (s.err) continue;
  await new Promise((r) => setTimeout(r, 400));
  const d = await chain.recipientDeltas(s.signature, RECIP).catch(() => null); const usdc = d?.find((x) => x.mint === MINT)?.raw ?? 0n;
  if (usdc <= 0n) continue;
  const probe = await chain.validate(s.signature, { recipient: RECIP, amountUi: Number(usdc) / 1e6, amountRaw: usdc, mint: MINT }).then(() => 'ok', (e) => (e as Error).message);
  if (/version/i.test(probe)) continue;   // a version-1 transaction: @solana/pay cannot read it
  tried++;
  const ui = Number(usdc) / 1e6;
  const raw = await rpc('getTransaction', [s.signature, { encoding: 'json', maxSupportedTransactionVersion: 1 }]); const ref = raw.transaction.message.accountKeys[0];
  const fb = await chain.validate(s.signature, { recipient: RECIP, amountUi: Number(usdc) / 1e6, amountRaw: usdc, mint: MINT, reference: ref }).then(() => 'VALID', (e) => `REJECTED(${(e as Error).message})`);
  const fbBad = await chain.validate(s.signature, { recipient: RECIP, amountUi: Number(usdc) / 1e6, amountRaw: usdc, mint: MINT, reference: 'Vote111111111111111111111111111111111111111' }).then(() => 'VALID', (e) => `REJECTED(${(e as Error).message})`);
  console.log('  fallback with a reference present in the tx:', fb, '| absent reference:', fbBad);
  const res = await chain.validate(s.signature, { recipient: RECIP, amountUi: ui, amountRaw: usdc, mint: MINT }).then(() => 'VALID', (e) => `REJECTED(${(e as Error).message})`);
  const over = await chain.validate(s.signature, { recipient: RECIP, amountUi: ui + 1, amountRaw: usdc + 1_000_000n, mint: MINT }).then(() => 'VALID', (e) => `REJECTED(${(e as Error).message})`);
  const wrongMint = await chain.validate(s.signature, { recipient: RECIP, amountUi: ui, amountRaw: usdc, mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB' }).then(() => 'VALID', (e) => `REJECTED(${(e as Error).message})`);
  console.log(s.signature.slice(0, 8), `usdc ${ui}`, '| exact:', res, '| amount+1:', over, '| wrong mint:', wrongMint);
  if (tried >= 3) break;
}
if (!tried) console.log('no readable (non version-1) incoming USDC transfer in the last 300 signatures');
