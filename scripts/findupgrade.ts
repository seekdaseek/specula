import fs from 'node:fs';
import { Rpc } from '../src/ingest.js';
import { Engine } from '../src/engine.js';
import { findUpgrades } from '../src/upgrade.js';
import { openDb } from '../src/db.js';
import bs58 from 'bs58';
const rpc = new Rpc('https://api.mainnet-beta.solana.com');
for (const prog of process.argv.slice(2)) {
  const acc = await rpc.getAccountData(prog);
  if (!acc) { console.log(prog, 'no account'); continue; }
  const pd = bs58.encode(acc.data.subarray(4, 36));
  const sigs = await rpc.sigs(pd, { limit: 20 });
  console.log(prog.slice(0, 8), 'owner', acc.owner.slice(0, 8), 'tag', acc.data.readUInt32LE(0), 'programdata', pd, 'sigs', sigs.length);
  for (const s of sigs) {
    const tx = await rpc.tx(s.signature); if (!tx) continue;
    const u = findUpgrades(tx, pd);
    if (u.length) { console.log('  FOUND', s.signature, u.map((x) => x.action + (x.failed ? ':failed' : '')), new Date((tx.blockTime ?? 0) * 1000).toISOString()); fs.writeFileSync(`phase0/upgrade-${prog.slice(0, 6)}-${u[0]!.action}-${s.signature.slice(0, 8)}.json`, JSON.stringify({ programId: prog, programdata: pd, tx })); }
  }
}
