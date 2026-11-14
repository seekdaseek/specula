// Diff Microscope's generated decoder output (tools/ms-harness) against specula's, on the saved fixtures.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { AnchorDecoder } from '../src/decode.js';
import { toJson } from '../src/shape.js';

const dir = process.argv[2] ?? 'fixtures/jupiter-lend';
const idl = process.argv[3] ?? 'fixtures/idl/jupiter-lend-lending.json';
const bin = 'ref/ms-target/release/ms-harness';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => `${dir}/${f}`);
const big = (s: string) => s.replace(/(?<![\w."])(-?\d{16,})(?![\w."])/g, '"$1"'); // keep >2^53 integers exact as comparable text
const canon = (v: any): any => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
const parse = (t: string) => canon(JSON.parse(big(t)));

const theirs: any[] = execFileSync(bin, files, { maxBuffer: 1 << 26 }).toString().trim().split('\n').filter(Boolean).map((l) => JSON.parse(big(l)));
const dec = new AnchorDecoder('jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9', JSON.parse(fs.readFileSync(idl, 'utf8')));
const ours: any[] = [];
for (const f of files) for (const r of dec.decodeTx(JSON.parse(fs.readFileSync(f, 'utf8')))) {
  const d: any = parse(toJson(r.data));
  if (r.kind === 'program_instruction') ours.push({ signature: r.signature, kind: r.kind, name: r.name, path: r.instruction_path, failed: r.failed, program_id: d.program_id, args: d.data, accounts: d.accounts });
  else ours.push({ signature: r.signature, kind: r.kind, name: r.name, source: r.source, failed: r.failed, data: d });
}
const norm = (t: any) => t.kind === 'program_instruction'
  ? { signature: t.signature, kind: t.kind, name: t.name, path: t.path, failed: t.failed, program_id: t.data.program_id, args: canon(t.data.data), accounts: canon(Object.fromEntries(Object.entries(t.data.accounts).filter(([k]) => k !== 'remaining'))) }
  : { signature: t.signature, kind: t.kind, name: t.name, source: t.source, failed: t.failed, data: canon(t.data) };
// accounts: ours carry names -> pubkey (including remaining_N); compare only the named accounts Microscope serializes
const ourN = ours.map((o) => o.kind === 'program_instruction' ? { ...o, accounts: canon(Object.fromEntries(Object.entries(o.accounts).filter(([k]) => !k.startsWith('remaining')))) } : o);
const key = (o: any) => `${o.signature}|${o.kind}|${o.name}|${o.path ?? o.source}`;
const A = new Map(theirs.map(norm).map((t) => [key(t), JSON.stringify(t)] as const));
const B = new Map(ourN.map((o) => [key(o), JSON.stringify(canon(o))] as const));
// the same event can arrive via log and via cpi; compare by multiset of (sig, kind, name, data) for events
const evKey = (o: any) => `${o.signature}|${o.name}|${JSON.stringify(o.data)}`;
const instrT = theirs.map(norm).filter((t) => t.kind === 'program_instruction'), instrO = ourN.filter((o) => o.kind === 'program_instruction');
const evT = theirs.map(norm).filter((t) => t.kind === 'program_event').map(evKey).sort(), evO = ourN.filter((o) => o.kind === 'program_event').map(evKey).sort();
let diffs = 0;
const mapT = new Map(instrT.map((t) => [key(t), JSON.stringify(canon(t))])), mapO = new Map(instrO.map((t) => [key(t), JSON.stringify(canon(t))]));
for (const [k, v] of mapT) if (mapO.get(k) !== v) { diffs++; console.log('INSTR DIFF', k, '\n  ms  ', v.slice(0, 400), '\n  ours', (mapO.get(k) ?? 'MISSING').slice(0, 400)); }
for (const k of mapO.keys()) if (!mapT.has(k)) { diffs++; console.log('INSTR only in ours', k); }
if (JSON.stringify(evT) !== JSON.stringify(evO)) { diffs++; console.log('EVENT DIFF\n ms  ', evT, '\n ours', evO); }
console.log(`microscope: ${instrT.length} instructions, ${evT.length} events | specula: ${instrO.length} instructions, ${evO.length} events | differences: ${diffs}`);
