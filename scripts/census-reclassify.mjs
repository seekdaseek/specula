// scripts/census-reclassify.mjs: re-run the authority classification (scripts/census-lib.mjs) over every upgradeable census row and list every row whose class changes.
//   node --env-file=.env scripts/census-reclassify.mjs census/census-raw.json census/depth.json census/reclassify-changes.json
import fs from 'node:fs';
import { classifyPda } from './census-lib.mjs';

const [rawFile, depthFile, outFile] = process.argv.slice(2);
const KEY = process.env.HELIUS_API_KEY; if (!KEY) throw new Error('HELIUS_API_KEY is not set');
let last = 0, calls = 0;
const rpc = async (method, params) => {
  calls++;
  for (let a = 0; a < 6; a++) {
    const wait = Math.max(0, last + 170 - Date.now()); if (wait) await new Promise((x) => setTimeout(x, wait)); last = Date.now();
    const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${KEY}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const text = await res.text(); if (res.status === 429 || /too many requests/i.test(text.slice(0, 40))) { await new Promise((x) => setTimeout(x, 1500 * (a + 1))); continue; }
    const r = JSON.parse(text); if (r.error) throw new Error(`${method}: ${JSON.stringify(r.error).slice(0, 100)}`); return r.result;
  }
  throw new Error(`${method}: rate limited`);
};
const raw = JSON.parse(fs.readFileSync(rawFile, 'utf8')); const depth = JSON.parse(fs.readFileSync(depthFile, 'utf8'));
const changes = []; let scanned = 0;
for (const r of raw.rows) {
  if (r.upgradeable !== true || !r.upgrade_authority) continue;
  if (r.authority_kind === 'plain-key' || r.authority_kind === 'program-owned' || /owned by/.test(r.authority_evidence ?? '')) continue;   // decided by the account itself, not by transactions
  scanned++;
  const c = await classifyPda(rpc, r.upgrade_authority);
  const oldKind = r.authority_kind, oldSq = depth.rows[r.program_id]?.squads ?? null;
  if (c.kind !== oldKind) changes.push({ program_id: r.program_id, name: r.name, authority: r.upgrade_authority, old_kind: oldKind, new_kind: c.kind, new_evidence: c.evidence, new_squads: c.squads ? { threshold: c.squads.threshold, members: c.squads.members, time_lock_seconds: c.squads.time_lock_seconds, multisig: c.squads.multisig } : null });
  r.authority_kind = c.kind; r.authority_evidence = c.evidence;
  const d = depth.rows[r.program_id] ?? (depth.rows[r.program_id] = {});
  if (c.squads) d.squads = c.squads; else if (/squads/.test(c.kind)) d.squads = { error: 'no Squads multisig account in the scanned transactions whose vault PDA equals the authority' }; else delete d.squads;
  if (!changes.at(-1) || changes.at(-1).program_id !== r.program_id) { /* class unchanged */ }
  const sqNow = c.squads ? `${c.squads.threshold}/${c.squads.members} tl ${c.squads.time_lock_seconds}` : '-'; const sqOld = oldSq && oldSq.threshold ? `${oldSq.threshold}/${oldSq.members} tl ${oldSq.time_lock_seconds}` : '-';
  process.stderr.write(`${(r.name || r.program_id.slice(0, 8)).slice(0, 26).padEnd(26)} ${String(oldKind).padEnd(16)} -> ${c.kind.padEnd(16)} squads ${sqOld} -> ${sqNow}\n`);
}
fs.writeFileSync(rawFile, JSON.stringify(raw, null, 1) + '\n'); depth.rpc_calls = (depth.rpc_calls ?? 0) + calls; depth.reclassified_at_utc = new Date().toISOString(); fs.writeFileSync(depthFile, JSON.stringify(depth, null, 1) + '\n');
fs.writeFileSync(outFile, JSON.stringify({ at_utc: depth.reclassified_at_utc, authorities_rescanned: scanned, rpc_calls: calls, changed_rows: changes }, null, 1) + '\n');
console.log(JSON.stringify({ scanned, changed: changes.length, rpc_calls: calls }));
