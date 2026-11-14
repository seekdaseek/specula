import fs from 'node:fs';
import { AnchorDecoder } from '../src/decode.js';
import { convertLegacyIdl } from '../src/idl-legacy.js';
const [prog, idlf, dir] = process.argv.slice(2);
const d = new AnchorDecoder(prog!, convertLegacyIdl(JSON.parse(fs.readFileSync(idlf!, 'utf8')), prog));
const c: Record<string, number> = {}; let unk = 0, total = 0;
for (const f of fs.readdirSync(dir!)) { const tx = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8')); const rs = d.decodeTx(tx); for (const r of rs) c[`${r.kind[8]}:${r.name}`] = (c[`${r.kind[8]}:${r.name}`] ?? 0) + 1; total++; if (!rs.length) unk++; }
console.log(total, 'txs; no decode:', unk, JSON.stringify(c));
