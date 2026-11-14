// Phase 3 E: measure BPF Upgradeable Loader traffic for 2 hours (read only, existing Helius key, serial ~3 rps).
// usage: tsx scripts/upgrade-feed-measure.ts <minutes> ; writes live/uf.db. Never prints the key.
import fs from 'node:fs';
import Database from 'better-sqlite3';
import bs58 from 'bs58';
import { Rpc } from '../src/ingest.js';
const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const minutes = Number(process.argv[2] ?? 120), cycleMs = 5 * 60_000, SAMPLE = 400, GAP = 350;
const K = fs.readFileSync('.env', 'utf8').split('\n').find((l) => l.startsWith('HELIUS_API_KEY='))!.slice(15).trim();
// Helius rejects getSignaturesForAddress on the loader ("Address is not supported", measured 14 Nov 2026): list signatures on the public RPC, fetch transactions on Helius.
const rpcSigs = new Rpc('https://api.mainnet-beta.solana.com');
const rpc = new Rpc(`https://mainnet.helius-rpc.com/?api-key=${K}`);
const db = new Database('live/uf.db');
db.exec(`CREATE TABLE IF NOT EXISTS sigs (signature TEXT PRIMARY KEY, block_time INTEGER, failed INTEGER, cycle INTEGER, sampled INTEGER DEFAULT 0, tags TEXT);
CREATE TABLE IF NOT EXISTS cycles (cycle INTEGER PRIMARY KEY, at INTEGER, new_sigs INTEGER, classified INTEGER, calls_sigs INTEGER, calls_tx INTEGER);`);
const NAMES: Record<number, string> = { 0: 'InitializeBuffer', 1: 'Write', 2: 'DeployWithMaxDataLen', 3: 'Upgrade', 4: 'SetAuthority', 5: 'Close', 6: 'ExtendProgram', 7: 'SetAuthorityChecked', 8: 'ExtendProgramChecked' };
const tagsOf = (tx: any): string[] => {
  const keys = [...tx.transaction.message.accountKeys, ...(tx.meta?.loadedAddresses?.writable ?? []), ...(tx.meta?.loadedAddresses?.readonly ?? [])];
  const all = [...tx.transaction.message.instructions, ...(tx.meta?.innerInstructions ?? []).flatMap((g: any) => g.instructions)];
  const out = new Set<string>();
  for (const ix of all) if (keys[ix.programIdIndex] === LOADER) { const d = Buffer.from(bs58.decode(ix.data)); out.add(NAMES[d.length >= 4 ? d.readUInt32LE(0) : -1] ?? 'unknown'); }
  return [...out];
};
const t0 = Date.now(); let cycle = 0; let last: string | undefined = (db.prepare('SELECT signature FROM sigs ORDER BY block_time DESC LIMIT 1').get() as any)?.signature;
while (Date.now() - t0 < minutes * 60_000) {
  const started = Date.now(); cycle++;
  const fresh: { signature: string; blockTime: number | null; err: unknown }[] = []; let before: string | undefined; let callsS = 0;
  for (let p = 0; p < 40; p++) {
    const batch = await rpcSigs.sigs(LOADER, { before, until: last, limit: 1000 }); callsS++;
    fresh.push(...batch); if (batch.length < 1000 || !last && p >= 0) { if (!last) break; if (batch.length < 1000) break; }
    before = batch[batch.length - 1]!.signature;
  }
  if (fresh.length) last = fresh[0]!.signature;
  const ins = db.prepare('INSERT OR IGNORE INTO sigs (signature, block_time, failed, cycle) VALUES (?,?,?,?)');
  db.transaction(() => { for (const s of fresh) ins.run(s.signature, s.blockTime, s.err ? 1 : 0, cycle); })();
  // classify: all if few, else a random sample (credits and the shared key's burst limit)
  const pick = fresh.length <= SAMPLE ? fresh : [...fresh].sort(() => Math.random() - 0.5).slice(0, SAMPLE);
  let callsT = 0, done = 0;
  for (const s of pick) {
    try { const tx = await rpc.tx(s.signature); callsT++; if (tx) { db.prepare('UPDATE sigs SET sampled=1, tags=? WHERE signature=?').run(tagsOf(tx).sort().join(','), s.signature); done++; } } catch { /* skip */ }
    await new Promise((r) => setTimeout(r, GAP));
  }
  db.prepare('INSERT OR REPLACE INTO cycles VALUES (?,?,?,?,?,?)').run(cycle, Date.now(), fresh.length, done, callsS, callsT);
  fs.appendFileSync('live/uf.log', `${new Date().toISOString()} cycle ${cycle} new=${fresh.length} classified=${done} callsSigs=${callsS} callsTx=${callsT}\n`);
  const wait = cycleMs - (Date.now() - started); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
fs.appendFileSync('live/uf.log', `${new Date().toISOString()} done\n`);
