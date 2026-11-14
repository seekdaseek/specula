// Report for the Phase 1b live run, computed from the SQLite database (not from logs).
// usage: tsx scripts/live-report.ts <live.db> [windowStartIso] [windowEndIso]
import Database from 'better-sqlite3';
const db = new Database(process.argv[2]!, { readonly: true });
const rows = db.prepare('SELECT signature, source, seen_at, block_time, failed FROM observations').all() as { signature: string; source: string; seen_at: number; block_time: number | null; failed: number }[];
const t0 = process.argv[3] ? Date.parse(process.argv[3]) / 1000 : 0, t1 = process.argv[4] ? Date.parse(process.argv[4]) / 1000 : Infinity;
const by = new Map<string, { w?: (typeof rows)[0]; p?: (typeof rows)[0] }>();
for (const r of rows) { const e = by.get(r.signature) ?? {}; if (r.source === 'webhook') e.w = r; else e.p = r; by.set(r.signature, e); }
const inWin = (bt: number | null | undefined) => bt != null && bt >= t0 && bt <= t1;
const sigs = [...by.entries()].filter(([, e]) => inWin((e.w ?? e.p)!.block_time));
const both = sigs.filter(([, e]) => e.w && e.p), wOnly = sigs.filter(([, e]) => e.w && !e.p), pOnly = sigs.filter(([, e]) => !e.w && e.p);
const pct = (a: number[], q: number) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]!; };
const lat = (src: 'w' | 'p') => sigs.filter(([, e]) => e[src]).map(([, e]) => (e[src]!.seen_at / 1000 - e[src]!.block_time!));
const fmt = (a: number[]) => `n=${a.length} p50=${pct(a, 0.5).toFixed(1)}s p95=${pct(a, 0.95).toFixed(1)}s max=${Math.max(...a).toFixed(1)}s min=${Math.min(...a).toFixed(1)}s`;
const failed = (src: 'w' | 'p') => sigs.filter(([, e]) => e[src]?.failed).length;
console.log(JSON.stringify({
  window: { from: t0 ? new Date(t0 * 1000).toISOString() : null, to: Number.isFinite(t1) ? new Date(t1 * 1000).toISOString() : null },
  distinct_signatures: sigs.length, both: both.length, webhook_only: wOnly.length, poll_only: pOnly.length,
  webhook_latency_receive_minus_blocktime: fmt(lat('w')), poll_latency: fmt(lat('p')),
  failed_seen_by_webhook: failed('w'), failed_seen_by_poll: failed('p'), failed_in_both: both.filter(([, e]) => e.w!.failed).length,
  poll_only_failed: pOnly.filter(([, e]) => e.p!.failed).length, webhook_only_failed: wOnly.filter(([, e]) => e.w!.failed).length,
  poll_only_sample: pOnly.slice(0, 5).map(([s, e]) => ({ s: s.slice(0, 10), bt: e.p!.block_time, seen: new Date(e.p!.seen_at).toISOString(), failed: e.p!.failed })),
  webhook_only_sample: wOnly.slice(0, 5).map(([s, e]) => ({ s: s.slice(0, 10), bt: e.w!.block_time })),
}, null, 1));
