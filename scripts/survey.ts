import fs from 'node:fs';
import { AnchorDecoder } from '../src/decode.js';
const idl = JSON.parse(fs.readFileSync('ref/solana-microscope/examples/jupiter-lend/lending.json', 'utf8'));
const d = new AnchorDecoder('jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9', idl);
const dir = process.argv[2]!;
for (const f of fs.readdirSync(dir)) {
  const tx = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
  const recs = d.decodeTx(tx);
  console.log(f.slice(0, 10), tx.meta.err ? 'FAIL' : 'ok', recs.map((r) => `${r.kind === 'program_event' ? 'E' : 'I'}:${r.name}@${r.ix_key}${r.source ? '/' + r.source : ''}`).join(' '));
}
