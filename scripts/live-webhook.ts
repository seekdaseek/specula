// Phase 1b: live Helius raw webhook (design A) + 5-minute polling reconciler, same process, Mac only.
// Reads HELIUS_API_KEY from .env (never printed). Usage: tsx scripts/live-webhook.ts <minutes> <tunnelUrl>
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { openDb } from '../src/db.js';
import { Engine } from '../src/engine.js';
import { pollAll, Rpc, webhookServer } from '../src/ingest.js';
import { parseAlertsToml } from '../src/rules.js';

const minutes = Number(process.argv[2] ?? 60), tunnel = process.argv[3]!;
const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1)])) as Record<string, string>;
// .env has a duplicate HELIUS_API_KEY line; take the first value that has UUID shape
const key = fs.readFileSync('.env', 'utf8').split('\n').filter((l) => l.startsWith('HELIUS_API_KEY=')).map((l) => l.slice(15).trim()).find((v) => /^[0-9a-f-]{36}$/.test(v));
if (!key) throw new Error('no valid HELIUS_API_KEY');
const JL = 'jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9', SQ4 = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';
const idl = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));
const out = 'live'; fs.mkdirSync(out, { recursive: true }); fs.mkdirSync('fixtures/helius', { recursive: true });
const dbPath = `${out}/live-${Date.now()}.db`;
const log = (m: string) => fs.appendFileSync(`${out}/live.log`, `${new Date().toISOString()} ${m}\n`);
const token = randomBytes(24).toString('hex');
const engine = new Engine(openDb(dbPath), { log });
engine.addTenant('live', {});
engine.addProgram({ tenantId: 'live', programId: JL, idl: idl('fixtures/idl/jupiter-lend-lending.json'), silenceHours: 1, rules: parseAlertsToml('[[alerts]]\nkind = "instruction"\nname = "update_rate"\nseverity = "info"\nchannels = []\n') });
engine.addProgram({ tenantId: 'live', programId: SQ4, idl: idl('ref/solana-microscope/idl/squads/v4.json'), silenceHours: 1, rules: [] });
const rpc = new Rpc(`https://mainnet.helius-rpc.com/?api-key=${key}`);
await engine.resolveProgramdata(rpc).catch((e) => log(`programdata: ${(e as Error).message}`));

let saved = 0, deliveries = 0, rejected = 0;
const rawLog = fs.createWriteStream(`${out}/raw-bodies.jsonl`);
const PORT = 8799;
const srv = webhookServer(engine, { authToken: token, port: PORT, path: '/hook', onRaw: (b) => { deliveries++; rawLog.write(JSON.stringify({ at: Date.now(), body: b }) + '\n'); if (saved < 3) { fs.writeFileSync(`live/raw-${++saved}.json`, b); } } });

const api = (p: string, init?: RequestInit) => fetch(`https://api-mainnet.helius-rpc.com/v0/webhooks${p}?api-key=${key}`, init);
const created: any = await (await api('', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ webhookURL: `${tunnel}/hook`, transactionTypes: ['ANY'], accountAddresses: [JL, SQ4], webhookType: 'raw', authHeader: token }) })).json();
if (!created.webhookID) { log(`create failed: ${JSON.stringify(created).replace(key, '***')}`); process.exit(2); }
fs.writeFileSync(`${out}/webhook-id.txt`, created.webhookID);
log(`webhook ${created.webhookID} created type=${created.webhookType} url=${tunnel}/hook`);

const poll = async () => { const r = await pollAll(engine, rpc, { sleepMs: 200 }); log(`poll ${JSON.stringify(r.map((x) => ({ a: x.addr.slice(0, 6), f: x.fetched, p: x.processed, e: x.error })))}`); };
await poll();
const t0 = Date.now();
const timer = setInterval(() => poll().catch((e) => log(`poll err ${(e as Error).message}`)), 5 * 60_000);
const prog = setInterval(() => log(`progress deliveries=${deliveries} obs=${JSON.stringify(engine.db.prepare('SELECT source, COUNT(*) n FROM observations GROUP BY source').all())}`), 120_000);
await new Promise((r) => setTimeout(r, minutes * 60_000));
clearInterval(timer); clearInterval(prog);
await poll();
log(`window over after ${((Date.now() - t0) / 60000).toFixed(1)} min; deliveries=${deliveries}`);
// leave webhook deletion to the explicit step, but stop receiving
srv.close(); rawLog.end();
log('done'); process.exit(0);
