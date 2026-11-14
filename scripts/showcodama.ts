import fs from 'node:fs';
import { CodamaDecoder } from '../src/decode-codama.js';
import { toJson } from '../src/shape.js';
const root = JSON.parse(fs.readFileSync('ref/solana-microscope/idl/idl1.json', 'utf8'));
const d = new CodamaDecoder(root.program.publicKey, root);
const seen = new Map<string, number>();
for (const f of fs.readdirSync('fixtures/codama-subscriptions')) {
  const tx = JSON.parse(fs.readFileSync(`fixtures/codama-subscriptions/${f}`, 'utf8'));
  for (const r of d.decodeTx(tx)) { const k = `${r.kind}:${r.name}`; seen.set(k, (seen.get(k) ?? 0) + 1); if (seen.get(k) === 1) console.log(f.slice(0, 8), r.kind, r.name, r.ix_key, r.source ?? '', toJson(r.data).slice(0, 500)); }
}
console.log([...seen]);
