import fs from 'node:fs';
import { AnchorDecoder } from '../src/decode.js';
const idl = JSON.parse(fs.readFileSync('ref/solana-microscope/examples/jupiter-lend/lending.json', 'utf8'));
const d = new AnchorDecoder('jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9', idl);
const f = fs.readdirSync(process.argv[2]!).find((x) => x.startsWith(process.argv[3]!))!;
console.log(JSON.stringify(d.decodeTx(JSON.parse(fs.readFileSync(`${process.argv[2]}/${f}`, 'utf8'))), null, 1).slice(0, 3500));
