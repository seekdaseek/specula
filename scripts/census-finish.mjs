// scripts/census-finish.mjs: trim the raw census (scripts/census.mjs) to the feed's N upgradeable programs, merge the depth reads (scripts/census-depth.mjs), write census.json and census.md.
//   node scripts/census-finish.mjs census/census-raw.json census 50 census/depth.json
// Nothing is added: every fact in a row was read from the chain; this only cuts the list (seed programs first, then by share of sampled transactions that invoked them) and writes the readable tables.
import fs from 'node:fs';
import path from 'node:path';

const [rawFile, outDir, nArg, depthFile] = process.argv.slice(2);
const N = Number(nArg || 50);
const raw = JSON.parse(fs.readFileSync(rawFile, 'utf8'));
const depth = depthFile && fs.existsSync(depthFile) ? JSON.parse(fs.readFileSync(depthFile, 'utf8')) : { rows: {} };
const ACTIVE = 100;   // transactions touching the program id in the last 7 days (RPC cap 1,000): >= 100 real active protocol, 1 to 99 low-activity, 0 dormant
const verdictOf = (d) => (!d ? null : d.tx_7d >= ACTIVE ? 'real active protocol' : d.tx_7d >= 1 ? 'low-activity' : 'dormant');
const rows = []; let up = 0;
for (const r of raw.rows) {
  if (r.upgradeable === true) { if (up >= N) break; up++; }
  const name = r.name ? r.name.replace(/ \(on-chain IDL name\)$/, '') : null;
  const d = depth.rows[r.program_id] ?? null;
  rows.push({ ...r, name, name_source: r.name_source ?? (r.id_source && !r.id_source.startsWith('block') ? 'docs or GitHub page (id_source)' : name ? 'on-chain IDL' : null), group: name ? 'named' : 'other watched', ...(d ? { depth: { ...d, verdict: verdictOf(d) } } : {}) });
}
const upg = rows.filter((r) => r.upgradeable === true);
const imm = rows.filter((r) => r.upgradeable === false || /immutable/.test(r.loader));
const named = upg.filter((r) => r.name), other = upg.filter((r) => !r.name);
const kinds = {}; for (const r of upg) kinds[r.authority_kind] = (kinds[r.authority_kind] || 0) + 1;
const single = upg.filter((r) => r.authority_kind === 'plain-key');
const sq = (r) => r.depth?.squads && r.depth.squads.threshold !== undefined && r.depth.squads.sane ? r.depth.squads : null;
const squadsAll = upg.filter(sq), squadsNamed = named.filter(sq);
const stats = (list) => ({ decoded: list.length, one_of_n: list.filter((r) => sq(r).threshold === 1).length, time_lock_0: list.filter((r) => sq(r).time_lock_seconds === 0).length, time_lock_known: list.filter((r) => sq(r).time_lock_seconds !== null).length, v3_no_time_lock_field: list.filter((r) => sq(r).time_lock_seconds === null).length, with_time_lock: list.filter((r) => (sq(r).time_lock_seconds ?? 0) > 0).length, median_threshold: list.map((r) => sq(r).threshold).sort((a, b) => a - b)[Math.floor(list.length / 2)] ?? null });
const summary = { read_at_utc: raw.read_at_utc, depth_read_at_utc: depth.read_at_utc ?? null, commitment: raw.commitment, slot_min: raw.slot_min, slot_max: raw.slot_max, block_sample: raw.block_sample, n_upgradeable_watched: upg.length, n_named: named.length, n_other_watched: other.length, n_immutable_listed: imm.length,
  single_key_upgradeable: single.length, authority_kinds_upgradeable: kinds, squads_all: stats(squadsAll), squads_named: stats(squadsNamed), activity_threshold_tx_7d: ACTIVE, rpc_calls_made: raw.rpc_calls_made + (depth.rpc_calls ?? 0) };
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'census.json'), JSON.stringify({ ...summary, rows }, null, 1) + '\n');

const short = (a) => (a ? `${a.slice(0, 4)}...${a.slice(-4)}` : 'none');
const label = (r) => r.name ?? `other watched program ${short(r.program_id)}`;
const kindText = { 'plain-key': 'single key', 'squads-v4-vault': 'Squads v4 vault (PDA)', 'squads-v3-vault': 'Squads v3 vault (PDA)', 'squads-v4-multisig': 'Squads v4 multisig', 'squads-v3-multisig': 'Squads v3 multisig', governance: 'governance', 'pda-other': 'PDA, controller not Squads or Realms', 'pda-unknown': 'PDA, no history', 'program-owned': 'program-owned account', none: 'immutable' };
const tl = (s) => (s === null || s === undefined ? 'n/a (v3)' : s === 0 ? 'none' : s % 3600 === 0 ? `${s / 3600} h` : `${s} s`);
const date = (iso) => (iso ? iso.slice(0, 10) : '?');
const md = [];
md.push('# Solana program upgrade-authority census', '');
md.push(`Read from mainnet RPC (finalized) on **${raw.read_at_utc}**, slots ${raw.slot_min} to ${raw.slot_max}; activity and Squads depth read ${depth.read_at_utc ?? 'n/a'}. ${summary.rpc_calls_made} RPC calls. Every authority, programdata address, deploy slot, activity count and multisig field below is a chain read (scripts/census.mjs, scripts/census-depth.mjs); nothing comes from memory.`);
md.push('', `## How the ${upg.length} programs were chosen`, '');
const nSeed = named.filter((r) => r.id_source && !r.id_source.startsWith('block')).length, nIdl = named.filter((r) => r.name_source === 'on-chain IDL').length, nOsec = named.filter((r) => /OtterSec/.test(r.name_source ?? '')).length, nSec = named.filter((r) => /security\.txt/.test(r.name_source ?? '')).length;
md.push(`- **${named.length} named programs.** ${nSeed} are programs whose ids a fetch agent read on the protocol's own docs or GitHub page on 16 Nov 2026 (census/seeds.json, source per row); ${nOsec} is named from the OtterSec verified-build registry (Token-2022); ${nIdl} from their own on-chain Anchor IDL; ${nSec} from the security.txt inside the program's ELF (the project's own declaration of its name).`);
md.push(`- **${other.length} other watched programs.** They were not picked for being important. They are the upgradeable programs, after the named ones, that appeared in the most transactions of ONE sample: ${raw.block_sample.blocks} finalized blocks (${raw.block_sample.txs} transactions, ${raw.block_sample.from} to ${raw.block_sample.to}), counting a program once per transaction that invokes it at any depth, taken in that order until the list reached ${upg.length} upgradeable programs. A different hour would give a different tail. Native and token programs (System, Compute Budget, Token, ATA, Memo and the like) are not upgradeable and drop out.`);
md.push(`- No name for these ${other.length} was found by any source I could read (on-chain IDL, the program's security.txt, OtterSec verify registry, SolanaFM, Solscan, web search); they are shown by id and are NOT claimed to be major or important. Each was checked for activity (below).`, '');
md.push('## Headline', '');
md.push(`- **${single.length} of ${upg.length} upgradeable programs are controlled by a single key** (an ordinary wallet that can replace the program's code alone); ${single.filter((r) => r.name).length} of them are named, ${single.filter((r) => !r.name).length} are other watched programs.`);
md.push(`- ${kinds['squads-v4-vault'] || 0} sit behind a Squads v4 vault and ${kinds['squads-v3-vault'] || 0} behind a Squads v3 vault; ${kinds['pda-other'] || 0} behind a program-controlled address that is not Squads or Realms, ${kinds['governance'] || 0} behind governance, ${kinds['program-owned'] || 0} behind a program-owned account.`);
md.push(`- **Squads depth** (the multisig behind each vault, read from the chain and accepted only when its vault PDA re-derives to the authority): ${summary.squads_all.decoded} decoded. Among the ${summary.squads_named.decoded} named programs behind Squads: **${summary.squads_named.one_of_n} are 1-of-N**, **${summary.squads_named.time_lock_0} have time_lock 0** (of ${summary.squads_named.time_lock_known} Squads v4 multisigs; v3 has no time lock field: ${summary.squads_named.v3_no_time_lock_field} v3). Across all ${summary.squads_all.decoded}: ${summary.squads_all.one_of_n} are 1-of-N, ${summary.squads_all.time_lock_0} of ${summary.squads_all.time_lock_known} v4 multisigs have time_lock 0, median threshold ${summary.squads_all.median_threshold}.`);
md.push(`- ${imm.length} programs in the list are immutable (upgrade authority None): ${imm.map(label).join(', ')}.`, '');
md.push('Reading a type: "single key" = the authority is on the ed25519 curve and owned by the System program. "Squads vault" = the authority is a PDA (off the curve) whose newest transaction invokes Squads, and (depth) a Squads multisig account exists whose vault PDA equals the authority. "PDA, controller not Squads or Realms" = off the curve, newest transaction invokes neither. Threshold = signatures needed; members = signers on the multisig; time lock = delay between approval and execution (v4 only); config authority = who can change the multisig without a vote (v4: "none (autonomous)" means the multisig governs itself).', '');
md.push(`Activity verdict, from the program id's signatures (RPC cap 1,000): **real active protocol** = at least ${ACTIVE} transactions in the last 7 days; **low-activity** = 1 to ${ACTIVE - 1}; **dormant** = none in 7 days.`, '');
md.push(`## The ${single.length} single-key programs`, '', '| Program | Program id | Authority | Last deploy | First programdata tx (age) | Tx in 7 days | Authority signed in 30 days | security.txt | Verdict |', '|---|---|---|---|---|---|---|---|---|');
for (const r of single) { const d = r.depth ?? {}; const st = d.security_txt ? Object.entries(d.security_txt).filter(([k]) => /name|project_url|source_code/.test(k)).map(([k, v]) => `${k}=${v}`).join('; ') || 'present, no name' : 'none in the ELF';
  md.push(`| ${label(r)} | \`${r.program_id}\` | \`${r.upgrade_authority}\` | ${date(d.last_deploy_utc)} | ${date(d.first_programdata_tx_utc)} (${d.age_days ?? '?'} d${d.age_is_lower_bound ? '+' : ''}) | ${d.tx_7d ?? '?'}${d.tx_7d_capped ? '+ (cap)' : ''} | ${d.authority_signed_30d === null || d.authority_signed_30d === undefined ? '?' : d.authority_signed_30d ? `yes (last ${date(d.authority_last_signed_utc)})` : 'no'} | ${st} | ${d.verdict ?? '?'} |`); }
md.push('', '## Table (all watched programs)', '');
md.push('| # | Group | Program | Program id | Upgrade authority | Type | Threshold | Time lock | Config authority | Last deploy (slot) | Name source |', '|---|---|---|---|---|---|---|---|---|---|---|');
rows.forEach((r, i) => { const s = sq(r); md.push(`| ${i + 1} | ${r.group} | ${label(r)} | \`${r.program_id}\` | ${r.upgrade_authority ? `\`${r.upgrade_authority}\`` : 'none'} | ${kindText[r.authority_kind] ?? r.authority_kind ?? r.loader} | ${s ? `${s.threshold} of ${s.members}` : ''} | ${s ? tl(s.time_lock_seconds) : ''} | ${s ? (s.config_authority.length > 20 ? `\`${s.config_authority}\`` : s.config_authority) : ''} | ${r.deployed_slot ?? ''} | ${r.name_source ?? 'none found'} |`); });
md.push('', '## Labelling attempt, 16 Nov 2026', '');
md.push(`Sources tried for the programs without a name: on-chain Anchor IDL (3 had one), the OtterSec verify registry (1 verified: Token-2022), the program's security.txt in its ELF (${other.filter((r) => r.depth?.security_txt).length} of ${other.length} had one; see the single-key table for any name it carries), SolanaFM (API 502), Solscan (403), Solana Explorer (429), a web search per id (blocked by a bot challenge). **${other.length} programs stay without a name.**`, '');
md.push('## Verdicts for the other watched programs', '', '| Program id | Authority type | Tx in 7 days | First programdata tx (age) | Verdict |', '|---|---|---|---|---|');
for (const r of other) { const d = r.depth ?? {}; md.push(`| \`${r.program_id}\` | ${kindText[r.authority_kind] ?? r.authority_kind} | ${d.tx_7d ?? '?'}${d.tx_7d_capped ? '+ (cap)' : ''} | ${date(d.first_programdata_tx_utc)} (${d.age_days ?? '?'} d${d.age_is_lower_bound ? '+' : ''}) | ${d.verdict ?? '?'} |`); }
fs.writeFileSync(path.join(outDir, 'census.md'), md.join('\n') + '\n');
console.log(JSON.stringify(summary));
