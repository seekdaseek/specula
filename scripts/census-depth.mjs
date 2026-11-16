// scripts/census-depth.mjs: activity, security.txt and Squads depth for the census (R41, 16 Nov 2026).
//   node --env-file=.env scripts/census-depth.mjs census/census-raw.json census/depth.json
// Every value is an RPC read. Squads: the multisig is found in the authority's newest transaction and ACCEPTED only when the authority is its vault PDA (re-derived here), so a wrong guess cannot slip in.
import fs from 'node:fs';
import crypto from 'node:crypto';
import anchor from '@coral-xyz/anchor';
import bs58 from 'bs58';
import { classifyPda } from './census-lib.mjs';

const [rawFile, outFile] = process.argv.slice(2);
const KEY = process.env.HELIUS_API_KEY; if (!KEY) throw new Error('HELIUS_API_KEY is not set');
const URL_ = `https://mainnet.helius-rpc.com/?api-key=${KEY}`;
const PublicKey = anchor.web3.PublicKey;
const SQ4 = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf', SQ3 = 'SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu';
let calls = 0, last = 0;
const rpc = async (method, params) => {
  calls++;
  for (let a = 0; a < 6; a++) {
    const wait = Math.max(0, last + 170 - Date.now()); if (wait) await new Promise((x) => setTimeout(x, wait)); last = Date.now();
    const res = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const text = await res.text();
    if (res.status === 429 || /too many requests/i.test(text.slice(0, 40))) { await new Promise((x) => setTimeout(x, 1500 * (a + 1))); continue; }
    const r = JSON.parse(text);
    if (r.error) { if (a < 5 && /rate|timeout/i.test(JSON.stringify(r.error))) { await new Promise((x) => setTimeout(x, 1000 * (a + 1))); continue; } throw new Error(`${method}: ${JSON.stringify(r.error).slice(0, 120)}`); }
    return r.result;
  }
  throw new Error(`${method}: rate limited`);
};
const iso = (t) => (t ? new Date(t * 1000).toISOString() : null);
const now = Math.floor(Date.now() / 1000);
const disc = (name) => crypto.createHash('sha256').update(`account:${name}`).digest().subarray(0, 8);
const D4 = disc('Multisig'), D3 = disc('Ms');
const pda = (seeds, prog) => PublicKey.findProgramAddressSync(seeds, new PublicKey(prog))[0].toBase58();
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };

const raw = JSON.parse(fs.readFileSync(rawFile, 'utf8'));
let up = 0; const rows = [];
for (const r of raw.rows) { if (r.upgradeable === true) { if (up >= 50) break; up++; } rows.push(r); }
const upg = rows.filter((r) => r.upgradeable === true);
const out = { read_at_utc: new Date().toISOString(), rows: {} };

const securityTxt = (buf) => {
  const b = buf.toString('latin1'); const i = b.indexOf('=======BEGIN SECURITY.TXT V1======='); if (i < 0) return null;
  const j = b.indexOf('=======END SECURITY.TXT V1=======', i); if (j < 0) return null;
  const parts = b.slice(i + 36, j).split('\0').filter((x, k, a) => k < a.length); const o = {};
  for (let k = 0; k + 1 < parts.length; k += 2) if (parts[k]) o[parts[k]] = parts[k + 1].slice(0, 200);
  return o;
};

for (const r of upg) {
  const o = {};
  try { const t = await rpc('getBlockTime', [r.deployed_slot]); o.last_deploy_utc = iso(t); } catch { o.last_deploy_utc = null; }
  // program account age: the oldest signature on the ProgramData address (the first deploy), up to 30 pages of 1000
  let before; let oldest = null, pages = 0, capped = false;
  for (; pages < 30; pages++) {
    const s = await rpc('getSignaturesForAddress', [r.programdata, { limit: 1000, ...(before ? { before } : {}) }]);
    if (!s.length) break; const t = s.map((x) => x.blockTime).filter(Boolean); if (t.length) oldest = Math.min(oldest ?? Infinity, ...t);
    before = s[s.length - 1].signature; if (s.length < 1000) break; if (pages === 29) capped = true;
  }
  o.first_programdata_tx_utc = iso(oldest); o.age_days = oldest ? Math.round((now - oldest) / 86400) : null; o.age_is_lower_bound = capped;
  // transactions touching the program id in the last 7 days (cap 1000)
  const ps = await rpc('getSignaturesForAddress', [r.program_id, { limit: 1000 }]);
  const cutoff = now - 7 * 86400; const in7 = ps.filter((x) => x.blockTime && x.blockTime >= cutoff).length;
  o.tx_7d = in7; o.tx_7d_capped = ps.length === 1000 && ps[999].blockTime >= cutoff;
  // has the authority key signed anything in 30 days? newest 10 signatures, up to 3 checked as signer
  o.authority_signed_30d = null; o.authority_last_signed_utc = null;
  if (r.upgrade_authority && r.authority_kind === 'plain-key') {
    const as = await rpc('getSignaturesForAddress', [r.upgrade_authority, { limit: 10 }]); o.authority_tx_seen = as.length;
    let signed = false, lastT = null;
    for (const s of as.slice(0, 3)) {
      const t = await rpc('getTransaction', [s.signature, { encoding: 'json', maxSupportedTransactionVersion: 1 }]); if (!t) continue;
      const keys = t.transaction.message.accountKeys || t.transaction.message.staticAccountKeys || []; const n = t.transaction.message.header.numRequiredSignatures;
      if (keys.slice(0, n).includes(r.upgrade_authority)) { signed = true; lastT = t.blockTime; break; }
    }
    o.authority_last_signed_utc = iso(lastT); o.authority_signed_30d = !!(signed && lastT && lastT >= now - 30 * 86400);
  }
  // security.txt and size: the ProgramData account
  if (!r.name) {
    const a = await rpc('getAccountInfo', [r.programdata, { encoding: 'base64' }]);
    if (a.value) { const buf = Buffer.from(a.value.data[0], 'base64'); o.programdata_bytes = buf.length; o.security_txt = securityTxt(buf); }
  }
  // Squads depth: scripts/census-lib.mjs (R42: recent transactions, accepted only when a multisig's vault PDA re-derives to the authority)
  if (/squads-v[34]-vault/.test(r.authority_kind ?? '')) { const c = await classifyPda(rpc, r.upgrade_authority); o.squads = c.squads ?? { error: 'no Squads multisig account in the scanned transactions whose vault PDA equals the authority' }; }
  out.rows[r.program_id] = o;
  process.stderr.write(`${(r.name || r.program_id.slice(0, 8)).slice(0, 26).padEnd(26)} tx7d ${o.tx_7d}${o.tx_7d_capped ? '+' : ''} age ${o.age_days}d${o.squads ? ` squads ${o.squads.threshold ?? '?'}/${o.squads.members ?? '?'} tl ${o.squads.time_lock_seconds}` : ''}\n`);
}
out.rpc_calls = calls;
fs.writeFileSync(outFile, JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ rows: Object.keys(out.rows).length, rpc_calls: calls }));
