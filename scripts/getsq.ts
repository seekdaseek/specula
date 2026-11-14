import fs from 'node:fs';
import { Rpc } from '../src/ingest.js';
const rpc = new Rpc('https://api.mainnet-beta.solana.com');
const [prog, n, out] = process.argv.slice(2);
fs.mkdirSync(out!, { recursive: true });
const sigs = await rpc.sigs(prog!, { limit: +n! });
for (const s of sigs) { const tx = await rpc.tx(s.signature); if (tx) fs.writeFileSync(`${out}/${s.signature}.json`, JSON.stringify(tx)); await new Promise((r) => setTimeout(r, 350)); }
console.log(fs.readdirSync(out!).length);
