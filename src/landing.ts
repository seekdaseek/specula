// The landing page: one static HTML document rendered at startup from the config (prices, limits, trial), so it can never disagree with the bot.
import fs from 'node:fs';
import path from 'node:path';
import type { PlansConfig } from './plans.js';
import type { UpgradeFeed } from './feed.js';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
export const BOT_URL = 'https://t.me/speculaDaBot';
const TITLE = 'specula: Telegram alerts for your Solana program';
const DESC = 'Alerts for your Solana program on Telegram, decoded from your IDL: upgrade and authority changes, silence, any instruction or event. Microscope-compatible rules. 14-day free trial, pay in USDC.';

export type FeedLanding = ReturnType<UpgradeFeed['landingData']>;
const short = (a: string | null | undefined) => (a ? `${a.slice(0, 4)}...${a.slice(-4)}` : 'none');
const KIND: Record<string, string> = { 'plain-key': 'single key', 'squads-v4-vault': 'Squads v4 multisig', 'squads-v3-vault': 'Squads v3 multisig', 'squads-v4-multisig': 'Squads v4 multisig', 'squads-v3-multisig': 'Squads v3 multisig', governance: 'governance', 'pda-other': 'program-controlled PDA', 'pda-unknown': 'PDA (controller unknown)', 'program-owned': 'program-owned', none: 'none: immutable' };

/** The census section and the last 10 upgrades (R39): rendered from the census file and the feed's own tables on every request, so the page never disagrees with the feed. */
export function renderFeedSection(f: FeedLanding): string {
  const up = f.rows.filter((r) => r.upgradeable === true), single = up.filter((r) => r.authority_kind === 'plain-key');
  const tl = (s: number | null | undefined) => (s === undefined || s === null ? (s === null ? 'n/a (v3)' : '') : s === 0 ? 'none' : s % 3600 === 0 ? `${s / 3600} h` : `${s} s`);
  const tr = f.rows.map((r) => `<tr><th scope="row">${esc(r.name ?? `other watched program ${short(r.program_id)}`)}</th><td><code title="${esc(r.authority ?? '')}">${esc(short(r.authority))}</code></td><td>${esc(KIND[r.authority_kind ?? ''] ?? (r.authority_kind ?? (r.upgradeable === false ? 'immutable' : 'unknown')))}</td><td>${r.threshold !== null ? `${r.threshold} of ${r.members}` : ''}</td><td>${tl(r.time_lock_seconds)}</td><td>${r.deployed_slot ?? ''}</td></tr>`).join('');
  const ev = f.upgrades.map((u) => `<li>${esc(u.name ?? short(u.program_id))}: ${u.action === 'upgrade' ? 'upgraded' : 'authority changed'}, ${u.block_time ? new Date(u.block_time * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'time unknown'} <a href="https://explorer.solana.com/tx/${esc(u.signature)}" rel="noopener">tx</a></li>`).join('');
  const when = f.census ? `Read from mainnet RPC on ${esc(f.census.read_at_utc)}${f.census.slot_max ? ` (slot ${f.census.slot_max})` : ''}.` : '';
  return `<h2>Who can upgrade the programs we watch</h2>
<p><b>${single.length} of ${up.length}</b> upgradeable programs in this census are controlled by a single key (${up.filter((r) => r.name).length} named programs and ${up.filter((r) => !r.name).length} other watched programs, chosen by how many sampled transactions used them, not by importance); the rest sit behind a multisig, a governance account or a program-controlled address. ${when} The authority column is the live upgrade authority (refreshed every minute); the type was read from the chain when the census was made.</p>
<table><thead><tr><th>Program</th><th>Upgrade authority</th><th>Type</th><th>Signers needed</th><th>Time lock</th><th>Last deploy (slot)</th></tr></thead><tbody>${tr}</tbody></table>
<h2>Last 10 upgrades</h2>
${ev ? `<ul>${ev}</ul>` : '<p class="sub">No upgrade or authority change has been seen on these programs since the feed went live.</p>'}
<p class="sub">Every upgrade and authority change of these programs is also posted to the public feed channel. Data as JSON: <a href="/census.json">/census.json</a>, <a href="/upgrades.json">/upgrades.json</a>.</p>`;
}

export function renderLanding(cfg: PlansConfig, base = 'https://specula.ochinimus.app', feed?: FeedLanding): string {
  const plans = Object.values(cfg.plans).filter((p) => !p.hidden).sort((a, b) => a.priceUsd - b.priceUsd);
  const rows = plans.map((p) => `<tr><th scope="row">${esc(p.name)}</th><td>$${p.priceUsd}</td><td>${p.txPerMonth.toLocaleString('en-US')}</td><td>${p.maxPrograms}</td><td>${(p.txPerMonth * p.maxPrograms).toLocaleString('en-US')}</td></tr>`).join('');
  const trial = cfg.trial; const tp = cfg.plans[trial.plan]!;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(TITLE)}</title>
<meta name="description" content="${esc(DESC)}">
<link rel="canonical" href="${base}/"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><meta name="theme-color" content="#0d1117">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(TITLE)}"><meta property="og:description" content="${esc(DESC)}"><meta property="og:url" content="${base}/"><meta property="og:image" content="${base}/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(TITLE)}"><meta name="twitter:description" content="${esc(DESC)}"><meta name="twitter:image" content="${base}/og.png">
<style>
:root{--bg:#fff;--fg:#1f2328;--mut:#59636e;--line:#d1d9e0;--acc:#0b6e64;--btn:#0b6e64;--btnfg:#fff;--card:#f6f8fa}
@media(prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--line:#30363d;--acc:#5eead4;--btn:#5eead4;--btnfg:#04201c;--card:#151b23}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:42rem;margin:0 auto;padding:2.5rem 1rem 4rem}h1{font-size:1.9rem;line-height:1.2;margin:0 0 .75rem}h2{font-size:1.2rem;margin:2.2rem 0 .6rem}
.lead{font-size:1.1rem;color:var(--mut)}ul{padding-left:1.2rem}li{margin:.35rem 0}
.btn{display:inline-block;background:var(--btn);color:var(--btnfg);font-weight:700;text-decoration:none;padding:.85rem 1.4rem;border-radius:.6rem;margin:1rem 0 .25rem}
.sub{color:var(--mut);font-size:.9rem;margin:.2rem 0}a{color:var(--acc)}.btn{color:var(--btnfg)}
table{width:100%;border-collapse:collapse;font-size:.95rem;background:var(--card);border:1px solid var(--line)}th,td{text-align:left;padding:.55rem .7rem;border-bottom:1px solid var(--line)}thead th{color:var(--mut);font-weight:600;font-size:.85rem}tr:last-child th,tr:last-child td{border-bottom:0}
code{background:var(--card);border:1px solid var(--line);border-radius:.3rem;padding:.05rem .3rem;font-size:.9em}
footer{margin-top:3rem;padding-top:1rem;border-top:1px solid var(--line);color:var(--mut);font-size:.85rem}
</style></head><body><main>
<h1>Alerts for your Solana program, on Telegram.</h1>
<p class="lead">Give specula a program address. It reads the program's IDL, watches the chain, and messages you when something happens. Nothing to install or host.</p>
<a class="btn" href="${BOT_URL}">Start in Telegram</a>
<p class="sub">${cfg.free ? `Free: ${cfg.free.maxPrograms} program, upgrade and authority-change alerts, no expiry, no card.` : `${trial.days}-day free trial, ${trial.maxPrograms} program, no card.`} Pay in USDC on Solana inside the bot for more.</p>

<h2>What you get</h2>
<ul>
<li><b>Upgrade and authority-change alerts</b>, on by default. If your program is upgraded or its upgrade authority changes, you hear about it.</li>
<li><b>Silence alerts</b>, on by default. No activity for 24 hours and you are told.</li>
<li><b>Any instruction or event.</b> Pick names from your IDL with one tap, or add conditions such as <code>data.assets &gt; 1000000</code>. Failed transactions are covered too.</li>
<li><b>Microscope-compatible rules.</b> Paste a Microscope <code>[[alerts]]</code> block under <code>/rules</code> and it works.</li>
<li><b>Anchor and Codama IDLs.</b> specula fetches the on-chain Anchor IDL, or you send the IDL file in the chat.</li>
</ul>

<h2>How it works</h2>
<ul><li>Open the bot and send <code>/watch PROGRAM_ID</code>.</li><li>Tap the instructions and events you care about.</li><li>Alerts arrive in the same chat. <code>/status</code> shows usage and <code>/support</code> reaches the operator.</li></ul>

<h2>Measured, not promised</h2>
<ul>
<li>Checked against the Solana Foundation's Microscope decoder on 7 real Jupiter Lend mainnet transactions (8 instructions, 12 events): <b>0 differences</b>.</li>
<li>Live Helius webhook test, 1 hour, 2 programs, 270 transactions: delivery <b>p50 1.2 s, p95 1.8 s</b> after block time, none missed after the first minute.</li>
<li><b>Failed transactions are delivered too</b>: 7 of 7 in that test.</li>
</ul>
<p class="sub">These come from our own test runs on 14 Nov 2026, not from a third-party audit. Limits: one hour on two programs; Codama IDLs need numeric u8 instruction discriminators; multisig alerts are not in v0.</p>

<h2>Pricing</h2>
<table><thead><tr><th>Plan</th><th>per ${cfg.billing.periodDays} days</th><th>tx per program / month</th><th>programs</th><th>tx / month, all programs</th></tr></thead><tbody>${rows}</tbody></table>
<p class="sub">${cfg.free ? `Free, no expiry: ${cfg.free.maxPrograms} program with upgrade and authority-change alerts only (no rules, no IDL needed).` : `Free trial: ${trial.days} days on ${esc(tp.name)} limits (${tp.txPerMonth.toLocaleString('en-US')} tx per month), ${trial.maxPrograms} program.`} Pay with <code>/upgrade</code> in the bot: a Solana Pay link in USDC, activated automatically once the payment is final. At the limit, alerts for that program pause and it is taken off the watch list until the next month or a higher plan.</p>

${feed ? renderFeedSection(feed) : ''}

<a class="btn" href="${BOT_URL}">Start in Telegram</a>

<footer>
<p>specula is a lighter, multi-tenant take on the Solana Foundation's <a href="https://github.com/solana-foundation/solana-microscope">Microscope</a> (MIT licence). We matched its alert-rule schema and decoded JSON shapes; no Microscope code is copied. specula is MIT licensed. Not affiliated with the Solana Foundation, Jupiter or Squads.</p>
<p>Support: send <code>/support</code> in the bot.</p>
</footer>
</main></body></html>
`;
}

export interface Page { type: string; body: string | Buffer; cache?: string }
export function buildPages(cfg: PlansConfig, publicDir: string, feed?: () => FeedLanding): Record<string, Page | (() => Page)> {
  const pages: Record<string, Page | (() => Page)> = feed
    ? { '/': () => ({ type: 'text/html; charset=utf-8', body: renderLanding(cfg, undefined, feed()), cache: 'public, max-age=60' }),
        '/census.json': () => ({ type: 'application/json; charset=utf-8', body: JSON.stringify({ census_read_at_utc: feed().census?.read_at_utc ?? null, programs: feed().rows }, null, 1), cache: 'public, max-age=60' }),
        '/upgrades.json': () => ({ type: 'application/json; charset=utf-8', body: JSON.stringify({ last_10: feed().upgrades }, null, 1), cache: 'public, max-age=30' }) }
    : { '/': { type: 'text/html; charset=utf-8', body: renderLanding(cfg), cache: 'public, max-age=300' } };
  for (const [url, file, type] of [['/favicon.svg', 'favicon.svg', 'image/svg+xml'], ['/og.png', 'og.png', 'image/png']] as const) {
    try { pages[url] = { type, body: fs.readFileSync(path.join(publicDir, file)), cache: 'public, max-age=86400' }; } catch { /* asset missing: that path stays 404 */ }
  }
  return pages;
}
