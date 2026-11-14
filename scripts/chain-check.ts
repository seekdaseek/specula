// Live positive control for RealChain on MAINNET (read only): recipient token deltas of a real USDC transfer, versus an independent read of the same transaction.
import fs from 'node:fs';
import { RealChain } from '../src/billing.js';
const K = fs.readFileSync('.env', 'utf8').split('\n').find((l) => l.startsWith('HELIUS_API_KEY='))!.slice(15).trim();
const chain = new RealChain(`https://mainnet.helius-rpc.com/?api-key=${K}`);
const dir = 'fixtures/jupiter-lend';
for (const f of fs.readdirSync(dir)) {
  const tx = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8')); const sig = f.replace('.json', '').replace('FAILED-', '');
  if (tx.meta.err) continue;
  const post = (tx.meta.postTokenBalances ?? []) as any[]; const pre = (tx.meta.preTokenBalances ?? []) as any[];
  const owners = [...new Set(post.map((b) => b.owner))];
  for (const owner of owners.slice(0, 40)) {
    const want = new Map<string, bigint>();
    for (const b of post) if (b.owner === owner) want.set(b.mint, (want.get(b.mint) ?? 0n) + BigInt(b.uiTokenAmount.amount));
    for (const b of pre) if (b.owner === owner) want.set(b.mint, (want.get(b.mint) ?? 0n) - BigInt(b.uiTokenAmount.amount));
    const nz = [...want].filter(([, v]) => v !== 0n); if (!nz.length) continue;
    const got = await chain.recipientDeltas(sig, owner);
    const gm = new Map((got ?? []).map((d) => [d.mint, d.raw]));
    const ok = nz.every(([m, v]) => gm.get(m) === v);
    console.log(sig.slice(0, 8), owner.slice(0, 6), nz.map(([m, v]) => `${m.slice(0, 4)}:${v}`).join(','), ok ? 'MATCH' : 'MISMATCH', 'got', JSON.stringify([...gm].map(([m, v]) => `${m.slice(0, 4)}:${v}`)));
    process.exit(ok ? 0 : 1);
  }
}
console.log('no candidate transaction'); process.exit(2);
