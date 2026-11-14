// 30-minute mainnet dry run on the Mac: poll mode, alerts to a local webhook receiver.
import fs from 'node:fs';
import http from 'node:http';
import { start } from '../src/run.js';
import { parseAlertsToml } from '../src/rules.js';
import type { SpeculaConfig } from '../src/config.js';

const minutes = Number(process.argv[2] ?? 30);
const out = 'dryrun';
fs.mkdirSync(out, { recursive: true });
const dbPath = `${out}/dryrun-${Date.now()}.db`;
const alerts: any[] = [];
const srv = http.createServer((req, res) => { const c: Buffer[] = []; req.on('data', (d) => c.push(d)); req.on('end', () => { const body = Buffer.concat(c).toString(); alerts.push({ at: new Date().toISOString(), sig: req.headers['x-specula-signature'], ...JSON.parse(body) }); res.writeHead(200).end('{}'); }); }).listen(0, '127.0.0.1');
await new Promise((r) => srv.on('listening', r));
const url = `http://127.0.0.1:${(srv.address() as any).port}/alerts`;
const idl = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));
const JL = 'jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9', SQ4 = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf', SQ3 = 'SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu';
const cfg: SpeculaConfig = {
  dbPath, rpcUrl: 'https://api.mainnet-beta.solana.com', pollIntervalSeconds: 15, healthIntervalSeconds: 60, stallSeconds: 180,
  tenants: { dry: { webhook: { url, secret: 'dryrun-secret' } } },
  programs: [
    { tenantId: 'dry', programId: JL, idl: idl('fixtures/idl/jupiter-lend-lending.json'), silenceHours: 1, rules: parseAlertsToml(`
[[alerts]]
kind = "event"
name = "log_deposit"
conditions = [{ field = "data.assets", operator = "gt", value = 1000000 }, { field = "failed", operator = "eq", value = false }]
severity = "info"
channels = ["webhook"]
[[alerts]]
kind = "instruction"
name = "update_rate"
severity = "info"
channels = ["webhook"]
`) },
    { tenantId: 'dry', programId: SQ4, idl: idl('ref/solana-microscope/idl/squads/v4.json'), silenceHours: 1, rules: parseAlertsToml(`
[[alerts]]
kind = "instruction"
name = "proposal_approve"
severity = "warning"
channels = ["webhook"]
`) },
    { tenantId: 'dry', programId: SQ3, idl: idl('ref/solana-microscope/idl/squads/v3.json'), silenceHours: 0.25, rules: [] },
  ],
};
const log = (m: string) => fs.appendFileSync(`${out}/dryrun.log`, `${new Date().toISOString()} ${m}\n`);
log(`start ${minutes} min, db ${dbPath}`);
const s = await start(cfg, log);
const t0 = Date.now();
const snap = () => Object.fromEntries(['program_instruction', 'program_event'].map((k) => [k, s.engine.db.prepare('SELECT program_id p, COUNT(*) n, SUM(failed) f FROM records WHERE kind=? GROUP BY program_id').all(k)]));
const tick = setInterval(() => log(`progress polls=${s.stats.polls} errors=${s.stats.errors} alerts=${alerts.length} ${JSON.stringify(snap())}`), 120_000);
await new Promise((r) => setTimeout(r, minutes * 60_000));
clearInterval(tick); await s.stop();
const summary = {
  minutes: (Date.now() - t0) / 60000, polls: s.stats.polls, pollErrors: s.stats.errors,
  recordsPerProgram: s.engine.db.prepare("SELECT program_id, kind, COUNT(*) n, SUM(failed) failed FROM records GROUP BY program_id, kind ORDER BY program_id, kind").all(),
  distinctTxPerProgram: s.engine.db.prepare('SELECT program_id, COUNT(DISTINCT signature) tx FROM records GROUP BY program_id').all(),
  checkpoints: s.engine.db.prepare('SELECT program_id, last_slot, updated_at FROM checkpoints').all(),
  alertsReceived: alerts.length, alerts: alerts.map((a) => ({ at: a.at, kind: a.kind, severity: a.severity, title: a.title, signature: a.signature, hmacHeader: String(a.sig).slice(0, 14) + '…' })),
};
fs.writeFileSync(`${out}/summary.json`, JSON.stringify(summary, null, 2));
log('done'); srv.close(); process.exit(0);
