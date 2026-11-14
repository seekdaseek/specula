// fetch raw txs for fixtures: tsx scripts/getfix.ts <programId> <n> <outdir>
import fs from 'node:fs';
const [prog, n, out] = process.argv.slice(2);
const rpc = 'https://api.mainnet-beta.solana.com';
const call = async (method: string, params: unknown[]) => { for (let a = 0; a < 6; a++) { const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }); if (r.status === 429) { await new Promise(r => setTimeout(r, 2000)); continue; } return (await r.json() as any).result; } };
const sigs = await call('getSignaturesForAddress', [prog, { limit: +n! }]);
fs.mkdirSync(out!, { recursive: true });
for (const s of sigs) { const tx = await call('getTransaction', [s.signature, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]); if (tx) fs.writeFileSync(`${out}/${s.signature}.json`, JSON.stringify(tx)); await new Promise(r => setTimeout(r, 400)); }
console.log(fs.readdirSync(out!).length, 'saved');
