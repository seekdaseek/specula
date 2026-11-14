// Pick 3 representative raw webhook payloads from the live run (failed tx if any, one with a decoded event, one Squads),
// write them as received to fixtures/helius/, plus the getTransaction response for the same signature (for the parity test).
import fs from 'node:fs';
import { AnchorDecoder } from '../src/decode.js';
import { Rpc } from '../src/ingest.js';
const JL = 'jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9', SQ4 = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';
const idl = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));
const jl = new AnchorDecoder(JL, idl('fixtures/idl/jupiter-lend-lending.json'));
const bodies = fs.readFileSync('live/raw-bodies.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).body as string);
const items = bodies.flatMap((b) => (JSON.parse(b) as any[]).map((x) => ({ x, b })));
const sigOf = (x: any) => x.transaction.signatures[0] as string;
const failed = items.find(({ x }) => x.meta?.err);
const withEvent = items.find(({ x }) => !x.meta?.err && x.transaction.message.accountKeys.includes(JL) && jl.decodeTx(x).some((r) => r.kind === 'program_event'));
const sq = items.find(({ x }) => x.transaction.message.accountKeys.includes(SQ4) && !x.meta?.err);
const chosen = [failed, withEvent, sq].filter(Boolean) as typeof items;
const rest = items.filter((i) => !chosen.includes(i));
while (chosen.length < 3 && rest.length) chosen.push(rest.shift()!);
fs.mkdirSync('fixtures/helius', { recursive: true });
const rpc = new Rpc(`https://api.mainnet-beta.solana.com`);
const names = ['failed', 'event', 'squads'];
for (const [i, c] of chosen.entries()) {
  const tag = c === failed ? 'failed' : c === withEvent ? 'event' : c === sq ? 'squads' : `other${i}`;
  fs.writeFileSync(`fixtures/helius/webhook-${tag}.json`, c.b);
  const tx = await rpc.tx(sigOf(c.x));
  if (tx) fs.writeFileSync(`fixtures/helius/poll-${tag}.json`, JSON.stringify(tx));
  console.log(tag, sigOf(c.x).slice(0, 12), 'poll copy', !!tx);
}
console.log({ failedFound: !!failed, eventFound: !!withEvent, squadsFound: !!sq, names });
