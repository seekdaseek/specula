// scripts/census-finish.mjs: trim the raw census (scripts/census.mjs) to the feed's N upgradeable programs and write census.json and census.md.
//   node scripts/census-finish.mjs census/census-raw.json census 50
// Nothing is added: every fact in a row was read from the chain by census.mjs; this only cuts the list (seed programs first, then by usage) and writes the readable table.
import fs from 'node:fs';
import path from 'node:path';

const [rawFile, outDir, nArg] = process.argv.slice(2);
const N = Number(nArg || 50);
const raw = JSON.parse(fs.readFileSync(rawFile, 'utf8'));
const rows = []; let up = 0;
for (const r of raw.rows) {
  if (r.upgradeable === true) { if (up >= N) break; up++; }
  const name = r.name ? r.name.replace(/ \(on-chain IDL name\)$/, '') : null;
  rows.push({ ...r, name, name_source: r.name_source ?? (r.id_source && !r.id_source.startsWith('block') ? 'docs or GitHub page (id_source)' : name ? 'on-chain IDL' : null) });
}
const upg = rows.filter((r) => r.upgradeable === true);
const imm = rows.filter((r) => r.upgradeable === false || /immutable/.test(r.loader));
const kinds = {}; for (const r of upg) kinds[r.authority_kind] = (kinds[r.authority_kind] || 0) + 1;
const multisig = upg.filter((r) => /squads/.test(r.authority_kind)).length;
const summary = { read_at_utc: raw.read_at_utc, commitment: raw.commitment, slot_min: raw.slot_min, slot_max: raw.slot_max, block_sample: raw.block_sample, n_upgradeable_watched: upg.length, n_immutable_listed: imm.length,
  single_key_upgradeable: kinds['plain-key'] || 0, authority_kinds_upgradeable: kinds, rpc_calls_made: raw.rpc_calls_made };
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'census.json'), JSON.stringify({ ...summary, rows }, null, 1) + '\n');

const short = (a) => (a ? `${a.slice(0, 4)}...${a.slice(-4)}` : 'none');
const label = (r) => r.name ?? `unlabelled ${short(r.program_id)}`;
const kindText = { 'plain-key': 'single key', 'squads-v4-vault': 'Squads v4 vault (PDA)', 'squads-v3-vault': 'Squads v3 vault (PDA)', 'squads-v4-multisig': 'Squads v4 multisig', 'squads-v3-multisig': 'Squads v3 multisig', governance: 'governance', 'pda-other': 'PDA, controller not Squads or Realms', 'pda-unknown': 'PDA, no history', 'program-owned': 'program-owned account', none: 'immutable' };
const md = [];
md.push('# Solana program upgrade-authority census', '');
md.push(`Read from mainnet RPC (finalized) on **${raw.read_at_utc}**, slots ${raw.slot_min} to ${raw.slot_max}. ${raw.rpc_calls_made} RPC calls. Every authority, programdata address and deploy slot below is a chain read (scripts/census.mjs); nothing comes from memory.`);
md.push(`Programs: the 25 named programs whose ids a fetch agent read on the protocol's own docs or GitHub page on 16 Nov 2026 (census/seeds.json, source per row), then the most-invoked programs of a real block sample (${raw.block_sample.blocks} finalized blocks, ${raw.block_sample.txs} transactions, ${raw.block_sample.from} to ${raw.block_sample.to}), named from their on-chain Anchor IDL when one exists. A name shown as "unlabelled" means no source for the name was found; the id is still read from the chain.`, '');
md.push(`## Headline`, '');
md.push(`- **${kinds['plain-key'] || 0} of ${upg.length} upgradeable programs are controlled by a single key** (an ordinary wallet that can replace the program's code alone).`);
md.push(`- ${multisig} sit behind a Squads multisig vault, ${kinds['pda-other'] || 0} behind a program-controlled address that is not Squads or Realms, ${kinds['governance'] || 0} behind governance, ${kinds['program-owned'] || 0} behind a program-owned account.`);
md.push(`- ${imm.length} programs in the list are immutable (upgrade authority None): ${imm.map(label).join(', ')}.`, '');
md.push('Reading a type: "single key" = the authority is on the ed25519 curve and owned by the System program. "Squads vault" = the authority is a PDA (off the curve) and its newest transaction invokes the Squads program (that is how a Squads v3/v4 vault looks on chain: a PDA, not an account the Squads program owns). "PDA, controller not Squads or Realms" = off the curve, newest transaction invokes neither: another program controls it (the census does not say which). The type was read once; the live authority is on the specula landing page.', '');
md.push('## Table', '');
md.push('| # | Program | Program id | Upgrade authority | Type | Last deploy (slot) | Name source | ProgramData tx/day |', '|---|---|---|---|---|---|---|---|');
rows.forEach((r, i) => md.push(`| ${i + 1} | ${label(r)} | \`${r.program_id}\` | ${r.upgrade_authority ? `\`${r.upgrade_authority}\`` : 'none'} | ${kindText[r.authority_kind] ?? r.authority_kind ?? r.loader} | ${r.deployed_slot ?? ''} | ${r.name_source ?? 'none found'} | ${r.programdata_tx_per_day ?? ''} |`));
md.push('', '## What it costs to watch these (Helius free plan, measured 16 Nov 2026 06:32 UTC)', '');
md.push('- Plan: free, 1,000,000 credits for 9 Nov to 9 Dec. Used 467,726, remaining 532,274. Burn 64,314 a day (webhooks 59,572 for the one watched program KLend, RPC 4,743). At that burn the credits run out on **24 Nov**, 15 days before the cycle ends.');
md.push('- 30% of the remaining credits = 159,682 = 7,026 a day for the rest of the cycle.');
md.push('- Measured per call (usage endpoint before and after): getMultipleAccounts of 60 addresses = 1 credit; getSignaturesForAddress = 1; getTransaction = 1; one webhook event = 1.');
md.push(`- Watching a ProgramData address with a webhook plus a 5-minute reconcile would cost about ${Math.round(upg.reduce((a, r) => a + (r.programdata_tx_per_day || 0), 0) / upg.length + 288)} credits per address per day on average (events: mean ${(upg.reduce((a, r) => a + (r.programdata_tx_per_day || 0), 0) / upg.length).toFixed(1)}, max ${Math.max(...upg.map((r) => r.programdata_tx_per_day || 0))} a day, plus 288 polls): about 22 programs would fit the 30%.`);
md.push(`- Reading the ${upg.length} ProgramData accounts as state in ONE getMultipleAccounts call every 60 s costs 1,440 credits a day for all of them (28.8 per program per day), 32,731 credits to the end of the cycle = 20% of the 30% budget. That is what the feed does.`);
fs.writeFileSync(path.join(outDir, 'census.md'), md.join('\n') + '\n');
console.log(JSON.stringify(summary));
