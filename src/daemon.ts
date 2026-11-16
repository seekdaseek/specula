// specula service: one process = engine + Helius webhook receiver + 5-min reconciler + @speculaDaBot long-poll + ops timers.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'smol-toml';
import { openDb } from './db.js';
import { Engine, type ProgramSpec } from './engine.js';
import { pollAll, Rpc, webhookServer } from './ingest.js';
import { normalizeAlerts } from './rules.js';
import { parsePlans, type PlansConfig } from './plans.js';
import { Service } from './service.js';
import { Bot, Tg } from './bot.js';
import { HeliusWebhooks, WebhookSync } from './helius.js';
import { UpgradeFeed, feedRpc, type Census } from './feed.js';
import { Billing, RealChain } from './billing.js';
import { buildPages } from './landing.js';
import { backupDb, checkWebhookHealth, latestBackupAge } from './ops.js';
import type { TenantChannels } from './channels.js';

export interface ServiceConfig {
  dbPath: string; port: number; publicUrl: string; pollIntervalSeconds: number; stallSeconds: number; healthIntervalSeconds: number;
  backupDir: string; webhookMinIntervalSeconds: number; plans: PlansConfig; feed: { censusFile: string; intervalSeconds: number; minPostGapSeconds: number; publicChannelEnv: string } | null;
  tenants: Record<string, TenantChannels>; programs: ProgramSpec[];
}

export function loadServiceConfig(file: string, env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const base = path.dirname(path.resolve(file));
  const d = parse(fs.readFileSync(file, 'utf8')) as any;
  const tenants: Record<string, TenantChannels> = {};
  for (const [id, t] of Object.entries<any>(d.tenants ?? {})) {
    if (t.telegram) { const chat = t.telegram.chat_id ?? env[t.telegram.chat_id_env]; if (!chat) throw new Error(`tenant ${id}: telegram chat id not set`); tenants[id] = { telegram: { chat_id: String(chat) } }; }
  }
  const programs: ProgramSpec[] = (d.programs ?? []).map((p: any) => ({ tenantId: p.tenant, programId: p.program_id, idl: JSON.parse(fs.readFileSync(path.resolve(base, p.idl_path), 'utf8')), rules: normalizeAlerts(p.alerts ?? []), silenceHours: p.silence_hours, upgradeAlerts: p.upgrade_alerts }));
  for (const p of programs) if (!tenants[p.tenantId]) throw new Error(`program ${p.programId}: unknown tenant ${p.tenantId}`);
  return {
    dbPath: path.resolve(base, d.db_path ?? 'data/specula.db'), port: d.port, publicUrl: d.public_url, pollIntervalSeconds: d.poll_interval_seconds ?? 300,
    stallSeconds: d.stall_seconds ?? 900, healthIntervalSeconds: d.health_interval_seconds ?? 60, backupDir: path.resolve(base, d.backup_dir ?? 'backups'),
    webhookMinIntervalSeconds: d.helius?.webhook_min_interval_seconds ?? 300, plans: parsePlans(d), tenants, programs,
    feed: d.feed ? { censusFile: path.resolve(base, d.feed.census_file ?? 'census/census.json'), intervalSeconds: Number(d.feed.interval_seconds ?? 60), minPostGapSeconds: Number(d.feed.min_post_gap_seconds ?? 600), publicChannelEnv: String(d.feed.public_channel_env ?? 'SPECULA_PUBLIC_CHANNEL') } : null,
  };
}

const need = (env: NodeJS.ProcessEnv, k: string) => { const v = env[k]; if (!v) throw new Error(`${k} is not set`); return v; };

export async function startDaemon(cfg: ServiceConfig, env: NodeJS.ProcessEnv = process.env, log: (m: string) => void = (m) => console.log(`${new Date().toISOString()} ${m}`)) {
  const heliusKey = need(env, 'HELIUS_API_KEY'), token = need(env, 'TELEGRAM_BOT_TOKEN'), owner = need(env, 'OWNER_CHAT_ID'), hookToken = need(env, 'WEBHOOK_TOKEN');
  const startedAt = Date.now();
  const db = openDb(cfg.dbPath);
  const holder: { svc?: Service } = {};
  const engine = new Engine(db, {
    log, stallSeconds: cfg.stallSeconds, env,
    ownerChannels: { telegram: { chat_id: owner } },
    canAlert: (t, p) => holder.svc!.canAlert(t, p), onTx: (t, p, s) => holder.svc!.onTx(t, p, s),
  });
  const svc = holder.svc = new Service(db, engine, cfg.plans);
  for (const [id, ch] of Object.entries(cfg.tenants)) engine.addTenant(id, ch);
  svc.restoreTenants(); engine.restore();
  for (const p of cfg.programs) { engine.removeProgram(p.tenantId, p.programId); engine.addProgram(p); }   // config file is the authority for operator tenants
  const rpc = new Rpc(`https://mainnet.helius-rpc.com/?api-key=${heliusKey}`);
  await engine.resolveProgramdata(rpc).catch((e) => log(`programdata lookup failed: ${(e as Error).message}`));

  let stopped = false; let lastHook = 0; const stats = { polls: 0, errors: 0, deliveries: 0 };
  // Phase 3b upgrade-feed test: a second, separately authenticated endpoint that only records deliveries (enabled when FEED_TOKEN is set).
  db.exec('CREATE TABLE IF NOT EXISTS feed_deliveries (id INTEGER PRIMARY KEY AUTOINCREMENT, received_at INTEGER NOT NULL, signature TEXT, type TEXT, slot INTEGER, body_len INTEGER NOT NULL, raw TEXT)');
  const feedToken = env.FEED_TOKEN;
  const feed = feedToken ? { path: '/webhook/helius-feed', authToken: feedToken, onBody: (body: string) => {
    const arr = JSON.parse(body); const now = Date.now();
    for (const x of Array.isArray(arr) ? arr : [arr]) db.prepare('INSERT INTO feed_deliveries (received_at, signature, type, slot, body_len, raw) VALUES (?,?,?,?,?,?)').run(now, x?.signature ?? null, x?.type ?? null, x?.slot ?? null, body.length, JSON.stringify(x).slice(0, 60000));
  } } : undefined;
  // R39: the upgrade feed (public channel + free tier): one batched ProgramData poll, no webhook, no program-id polling. Posts wait while the channel id env is unset.
  let tgRef: Tg | undefined;
  const upgradeFeed = cfg.feed ? new UpgradeFeed(db, feedRpc(rpc), { log, env, publicChannelEnv: cfg.feed.publicChannelEnv, minPostGapMs: cfg.feed.minPostGapSeconds * 1000, sendUser: (chat, text) => tgRef!.sendMessage(chat, text) }) : undefined;
  if (upgradeFeed && cfg.feed) { try { log(`feed: ${upgradeFeed.loadCensus(JSON.parse(fs.readFileSync(cfg.feed.censusFile, 'utf8')) as Census)} census programs watched`); } catch (e) { log(`feed: census not loaded: ${(e as Error).message}`); } }
  const hook = webhookServer(engine, {
    ...(feed ? { feed } : {}),
    pages: buildPages(cfg.plans, path.join(path.dirname(cfg.dbPath), '..', 'public'), upgradeFeed ? () => upgradeFeed.landingData() : undefined), authToken: hookToken, port: cfg.port, host: '127.0.0.1', path: '/webhook/helius',
    onRaw: () => { lastHook = Date.now(); stats.deliveries++; },
    onError: (e) => { stats.errors++; log(`webhook processTx failed: ${(e as Error).message}`); },
    health: () => ({ uptime_s: Math.round((Date.now() - startedAt) / 1000), last_webhook_s_ago: lastHook ? Math.round((Date.now() - lastHook) / 1000) : null }),
  });

  const sync = new WebhookSync(db, new HeliusWebhooks(heliusKey), { url: `${cfg.publicUrl}/webhook/helius`, auth: hookToken, desired: () => engine.programs().filter((e) => !svc.quotaReached(e.tenantId, e.programId)).map((e) => e.programId), minIntervalMs: cfg.webhookMinIntervalSeconds * 1000, log });
  const tg = new Tg(token); tgRef = tg;
  const bc = cfg.plans.billing;
  const billing = bc.recipient ? new Billing({ svc, cfg: bc, ownerChatId: owner, log, send: (chat, text) => tg.sendMessage(chat, text), chain: new RealChain(bc.rpcUrl ?? (bc.cluster === 'devnet' ? 'https://api.devnet.solana.com' : `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`), fetch, log) }) : undefined;
  const bot = new Bot(svc, { rpc, tg, billing, ownerChatId: owner, log, ...(upgradeFeed ? { feed: upgradeFeed } : {}), onProgramsChanged: () => { engine.resolveProgramdata(rpc).catch(() => {}); } });

  const pollLoop = (async () => {
    while (!stopped) {
      try { const res = await pollAll(engine, rpc, { sleepMs: 250, skip: svc.quotaReached }); stats.polls++; for (const r of res) if (r.error) { stats.errors++; log(`poll error ${r.addr.slice(0, 8)}: ${r.error}`); } }
      catch (e) { stats.errors++; log(`poll loop error: ${(e as Error).message}`); }
      for (let i = 0; i < cfg.pollIntervalSeconds * 10 && !stopped; i++) await new Promise((r) => setTimeout(r, 100));
    }
  })();
  let feedBusy = false;
  const feedTick = async () => {
    if (!upgradeFeed || feedBusy) return; feedBusy = true;
    try { const r = await upgradeFeed.tick(); if (r.changed || r.posted) log(`feed: ${r.checked} programdata read, ${r.changed} changed, ${r.resolved} resolved, ${r.posted} posted`); }
    catch (e) { stats.errors++; log(`feed tick failed: ${(e as Error).message}`); } finally { feedBusy = false; }
  };
  const feedTimer = upgradeFeed && cfg.feed ? setInterval(() => { feedTick().catch(() => {}); }, cfg.feed.intervalSeconds * 1000) : undefined;
  feedTick().catch(() => {});
  const healthTick = async () => {
    await engine.checkHealth().catch((e) => log(`health check failed: ${(e as Error).message}`));
    await checkWebhookHealth(db, Date.now(), { telegram: { chat_id: owner } }, env, { programs: engine.programs().length, startedAt }).catch((e) => log(`webhook health failed: ${(e as Error).message}`));
    await sync.tick().then((r) => { if (r === 'created' || r === 'edited') log(`webhook ${r}`); }).catch((e) => log(`webhook sync failed: ${(e as Error).message}`));
    if (latestBackupAge(cfg.backupDir, Date.now()) > 24 * 3_600_000) { try { log(`backup ${path.basename(backupDb(cfg.dbPath, cfg.backupDir, Date.now()))}`); } catch (e) { log(`backup failed: ${(e as Error).message}`); } }
  };
  const billTimer = billing ? setInterval(() => { billing.poll().catch((e) => log(`billing poll failed: ${(e as Error).message}`)); }, 15_000) : undefined;
  const timer = setInterval(() => { healthTick().catch(() => {}); }, cfg.healthIntervalSeconds * 1000);
  healthTick().catch(() => {});
  const sig = { get stopped() { return stopped; } };
  const botLoop = bot.run(sig as { stopped: boolean });
  log(`specula up on 127.0.0.1:${cfg.port}, ${engine.programs().length} programs`);
  return { engine, svc, stats, async stop() { stopped = true; clearInterval(timer); if (feedTimer) clearInterval(feedTimer); if (billTimer) clearInterval(billTimer); hook.close(); await Promise.race([pollLoop, new Promise((r) => setTimeout(r, 3000))]); void botLoop; } };
}
