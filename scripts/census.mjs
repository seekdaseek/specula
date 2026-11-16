// scripts/census.mjs: the Solana program upgrade-authority census (R39, 16 Nov 2026).
//   node --env-file=.env scripts/census.mjs census/seeds.json census/block-sample.json census [maxRows=80]
// Every FACT in a row is an RPC read: the program account (loader, programdata address), the ProgramData account (deploy slot, upgrade authority), the authority's own account (owner, on or off curve) and,
// for an off-curve authority, its newest transaction (is Squads invoked?). The only inputs that are not reads are the NAMES and the ids of the seed programs, each with the docs or GitHub URL an agent read it
// on (census/seeds.json); the rest of the rows are the most-invoked programs of a real block sample (census/block-sample.json, getBlock x40), named from their on-chain Anchor IDL when one exists.
// HELIUS_API_KEY comes from the environment and is never printed or written.
import fs from 'node:fs';
import path from 'node:path';
import anchor from '@coral-xyz/anchor';
import bs58 from 'bs58';
import { fetchOnchainIdl } from '../dist/idl-fetch.js';

const [seedsFile, sampleFile, outDir, maxRowsArg] = process.argv.slice(2);
if (!seedsFile || !sampleFile || !outDir) { console.error('usage: node --env-file=.env scripts/census.mjs seeds.json block-sample.json outdir [maxRows]'); process.exit(2); }
const KEY = process.env.HELIUS_API_KEY; if (!KEY) throw new Error('HELIUS_API_KEY is not set');
const URL_ = `https://mainnet.helius-rpc.com/?api-key=${KEY}`;
const PublicKey = anchor.web3.PublicKey;
const LOADER_UPG = 'BPFLoaderUpgradeab1e11111111111111111111111', LOADER_2 = 'BPFLoader2111111111111111111111111111111111', LOADER_1 = 'BPFLoader1111111111111111111111111111111111', LOADER_4 = 'LoaderV411111111111111111111111111111111111', NATIVE = 'NativeLoader1111111111111111111111111111111', SYSTEM = '11111111111111111111111111111111';
const SQUADS = { SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf: 'squads-v4', SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu: 'squads-v3' };
const GOVERNANCE = { GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw: 'realms-governance' };
let credits = 0; let minSlot = Infinity, maxSlot = 0;
let last = 0;
const rpc = async (method, params) => {        // the free Helius plan allows about 10 requests a second: one call every 170 ms, and a backoff on 429
  credits++;
  for (let a = 0; a < 6; a++) {
    const wait = Math.max(0, last + 170 - Date.now()); if (wait) await new Promise((x) => setTimeout(x, wait)); last = Date.now();
    const res = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const text = await res.text();
    if (res.status === 429 || /too many requests/i.test(text.slice(0, 40))) { await new Promise((x) => setTimeout(x, 1500 * (a + 1))); continue; }
    const r = JSON.parse(text);
    if (r.error) { if (a < 5 && /rate|timeout/i.test(JSON.stringify(r.error))) { await new Promise((x) => setTimeout(x, 1000 * (a + 1))); continue; } throw new Error(`${method}: ${JSON.stringify(r.error).slice(0, 140)}`); }
    return r.result;
  }
  throw new Error(`${method}: still rate limited after 6 tries`);
};
const accounts = async (ids, slice) => {          // -> Map(id -> { owner, executable, lamports, data: Buffer } | null), 100 per call
  const out = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const part = ids.slice(i, i + 100);
    const r = await rpc('getMultipleAccounts', [part, { encoding: 'base64', commitment: 'finalized', ...(slice ? { dataSlice: slice } : {}) }]);
    minSlot = Math.min(minSlot, r.context.slot); maxSlot = Math.max(maxSlot, r.context.slot);
    part.forEach((id, k) => { const v = r.value[k]; out.set(id, v ? { owner: v.owner, executable: v.executable, lamports: v.lamports, data: Buffer.from(v.data[0], 'base64') } : null); });
  }
  return out;
};

const seeds = JSON.parse(fs.readFileSync(seedsFile, 'utf8')).programs;
const sample = JSON.parse(fs.readFileSync(sampleFile, 'utf8'));
const usage = new Map(sample.top.map((t, i) => [t.id, { rank: i + 1, share_pct: t.share_pct }]));
const maxRows = Number(maxRowsArg || 80);

// 1. candidates: the seeds, then the most-invoked programs of the block sample (the native and token programs drop out below: they are not upgradeable-loader programs)
const cand = new Map();
for (const s of seeds) cand.set(s.id, { protocol: s.protocol, name: s.name, id_source: s.source });
for (const t of sample.top.slice(0, 160)) if (!cand.has(t.id)) cand.set(t.id, { protocol: null, name: null, id_source: `block sample: invoked by ${t.share_pct}% of ${sample.txs} sampled transactions` });
const ids = [...cand.keys()];

// 2. the program accounts
const prog = await accounts(ids, { offset: 0, length: 36 });
const rows = []; const pdIds = [];
for (const id of ids) {
  const c = cand.get(id); const a = prog.get(id);
  const row = { program_id: id, ...c, usage_rank: usage.get(id)?.rank ?? null, usage_share_pct: usage.get(id)?.share_pct ?? null };
  if (!a) row.loader = 'not-found';
  else if (a.owner === NATIVE || (!a.executable && a.owner === SYSTEM)) row.loader = a.owner === NATIVE ? 'native' : 'not-a-program';
  else if (!a.executable) row.loader = 'not-executable';
  else if (a.owner === LOADER_UPG && a.data.length >= 36 && a.data.readUInt32LE(0) === 2) { row.loader = 'upgradeable'; row.programdata = bs58.encode(a.data.subarray(4, 36)); pdIds.push(row.programdata); }
  else if (a.owner === LOADER_2) row.loader = 'bpf-loader-2 (immutable)';
  else if (a.owner === LOADER_1) row.loader = 'bpf-loader-deprecated (immutable)';
  else if (a.owner === LOADER_4) row.loader = 'loader-v4';
  else row.loader = `other: ${a.owner}`;
  rows.push(row);
}

// 3. the ProgramData accounts: deploy slot and upgrade authority (4 tag + 8 slot + 1 option flag + 32 authority = 45 bytes)
const pd = await accounts(pdIds, { offset: 0, length: 45 });
const authIds = new Set();
for (const row of rows) {
  if (row.loader !== 'upgradeable') continue;
  const a = pd.get(row.programdata);
  if (!a || a.data.length < 45 || a.data.readUInt32LE(0) !== 3) { row.upgradeable = null; row.note = 'programdata not readable as ProgramData'; continue; }
  row.deployed_slot = Number(a.data.readBigUInt64LE(4));
  const has = a.data[12] === 1;
  row.upgradeable = has;
  row.upgrade_authority = has ? bs58.encode(a.data.subarray(13, 45)) : null;
  if (has) authIds.add(row.upgrade_authority);
}

// 4. the authorities: owner, curve, and for a PDA the newest transaction
const auth = await accounts([...authIds]);
const kindOf = new Map();
for (const id of authIds) {
  const a = auth.get(id); const onCurve = PublicKey.isOnCurve(new PublicKey(id).toBytes());
  const k = { on_curve: onCurve, owner: a?.owner ?? null, account_exists: !!a };
  if (a && SQUADS[a.owner]) { k.kind = `${SQUADS[a.owner]}-multisig`; k.evidence = `the authority account is owned by the ${SQUADS[a.owner]} program`; }
  else if (a && GOVERNANCE[a.owner]) { k.kind = 'governance'; k.evidence = `the authority account is owned by ${GOVERNANCE[a.owner]}`; }
  else if (a && a.owner !== SYSTEM) { k.kind = 'program-owned'; k.evidence = `the authority account is owned by program ${a.owner}`; }
  else if (onCurve) { k.kind = 'plain-key'; k.evidence = a ? 'on the ed25519 curve, owned by the System program: an ordinary keypair wallet' : 'on the ed25519 curve, no account on chain: an ordinary keypair'; }
  else {
    // off the curve: a PDA, so a program controls it. Which one: the programs invoked in its newest transaction.
    const sigs = await rpc('getSignaturesForAddress', [id, { limit: 1, commitment: 'finalized' }]);
    if (!sigs.length) { k.kind = 'pda-unknown'; k.evidence = 'off the ed25519 curve (a PDA) and no transaction history to say which program controls it'; }
    else {
      const t = await rpc('getTransaction', [sigs[0].signature, { encoding: 'json', maxSupportedTransactionVersion: 1, commitment: 'finalized' }]);
      const m = t.transaction.message; const keys = [...(m.accountKeys || m.staticAccountKeys || []), ...(t.meta?.loadedAddresses?.writable ?? []), ...(t.meta?.loadedAddresses?.readonly ?? [])];
      const invoked = new Set([...(m.instructions || []).map((i) => keys[i.programIdIndex]), ...(t.meta?.innerInstructions || []).flatMap((x) => x.instructions.map((i) => keys[i.programIdIndex]))]);
      const sq = [...invoked].find((p) => SQUADS[p]); const gv = [...invoked].find((p) => GOVERNANCE[p]);
      if (sq) { k.kind = `${SQUADS[sq]}-vault`; k.evidence = `off the curve (a PDA); its newest transaction ${sigs[0].signature.slice(0, 12)}... invokes the ${SQUADS[sq]} program`; }
      else if (gv) { k.kind = 'governance'; k.evidence = `off the curve (a PDA); its newest transaction ${sigs[0].signature.slice(0, 12)}... invokes ${GOVERNANCE[gv]}`; }
      else { k.kind = 'pda-other'; k.evidence = `off the curve (a PDA); its newest transaction ${sigs[0].signature.slice(0, 12)}... invokes no Squads or Realms program`; }
    }
  }
  kindOf.set(id, k);
}
for (const row of rows) if (row.upgrade_authority) { const k = kindOf.get(row.upgrade_authority); row.authority_kind = k.kind; row.authority_owner = k.owner; row.authority_on_curve = k.on_curve; row.authority_evidence = k.evidence; }
  else if (row.upgradeable === false) { row.authority_kind = 'none'; row.authority_evidence = 'the ProgramData upgrade authority is None: the program is immutable'; }

// 5. how busy is the ProgramData address (the cost of watching it): its transaction history, newest 1000
const now = Math.floor(Date.now() / 1000);
for (const row of rows) {
  if (row.loader !== 'upgradeable') continue;
  const s = await rpc('getSignaturesForAddress', [row.programdata, { limit: 1000, commitment: 'finalized' }]);
  const times = s.map((x) => x.blockTime).filter(Boolean);
  row.programdata_tx_sampled = s.length; row.programdata_history_complete = s.length < 1000;
  if (times.length) { const oldest = Math.min(...times); row.programdata_first_seen_utc = new Date(oldest * 1000).toISOString(); row.programdata_tx_per_day = Number((s.length / Math.max((now - oldest) / 86400, 1 / 24)).toFixed(3)); row.programdata_last_tx_utc = new Date(Math.max(...times) * 1000).toISOString(); }
  else { row.programdata_tx_per_day = 0; }
}

// 6. names: from the on-chain Anchor IDL when the seed list has none
const rpcLike = { getAccountData: async (a) => { const r = await rpc('getAccountInfo', [a, { encoding: 'base64', commitment: 'finalized' }]); return r.value ? { owner: r.value.owner, data: Buffer.from(r.value.data[0], 'base64') } : null; } };
for (const row of rows) {
  if (row.name || row.loader !== 'upgradeable') continue;
  try { const idl = await fetchOnchainIdl(rpcLike, row.program_id); const n = idl?.metadata?.name ?? idl?.name ?? idl?.program?.name; if (n) { row.name = `${n} (on-chain IDL name)`; row.name_source = 'on-chain IDL'; } } catch { /* no IDL */ }
  if (!row.name) row.name = null;
}

// 7. keep: upgradeable and immutable programs (the census), seeds first then by usage; drop native/token/not-a-program
const keep = rows.filter((r) => r.loader === 'upgradeable' || /immutable|loader-v4/.test(r.loader)).sort((a, b) => (b.id_source.startsWith('block') ? 0 : 1) - (a.id_source.startsWith('block') ? 0 : 1) || (a.usage_rank ?? 9999) - (b.usage_rank ?? 9999));
const census = keep.slice(0, maxRows);
const dropped = rows.filter((r) => !keep.includes(r)).map((r) => ({ program_id: r.program_id, loader: r.loader, usage_share_pct: r.usage_share_pct }));
const meta = { read_at_utc: new Date().toISOString(), commitment: 'finalized', slot_min: minSlot, slot_max: maxSlot, rpc_calls_made: credits, block_sample: { sampled_at: sample.sampled_at, blocks: sample.blocks, txs: sample.txs, from: sample.block_time_from, to: sample.block_time_to } };
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'census.json'), JSON.stringify({ ...meta, rows: census, dropped_non_upgradeable_loader_or_native: dropped }, null, 1) + '\n');
console.log(JSON.stringify({ ...meta, candidates: ids.length, census_rows: census.length, upgradeable: census.filter((r) => r.upgradeable === true).length, immutable: census.filter((r) => r.upgradeable === false || /immutable/.test(r.loader)).length, dropped: dropped.length }));
