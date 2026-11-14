// Save recent real mainnet transactions of the Codama example program (De1eg..., idl/idl1.json) as fixtures.
import fs from 'node:fs';
import { Rpc } from '../src/ingest.js';
const PID = 'De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44';
const rpc = new Rpc('https://api.mainnet-beta.solana.com');
const dir = 'fixtures/codama-subscriptions'; fs.mkdirSync(dir, { recursive: true });
const sigs = await rpc.sigs(PID, { limit: Number(process.argv[2] ?? 40) });
let saved = 0;
for (const s of sigs) {
  if (s.err) continue;
  const tx = await rpc.tx(s.signature); if (!tx) continue;
  fs.writeFileSync(`${dir}/${s.signature}.json`, JSON.stringify(tx)); saved++;
  await new Promise((r) => setTimeout(r, 300));
}
console.log('saved', saved);
