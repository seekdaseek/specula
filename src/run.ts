import { openDb } from './db.js';
import { Engine } from './engine.js';
import { pollAll, Rpc, webhookServer } from './ingest.js';
import type { SpeculaConfig } from './config.js';

/** Start the single process: poller (+ optional webhook receiver) + health timer. Returns a stop function. */
export async function start(cfg: SpeculaConfig, log: (m: string) => void = console.log, overrides: { now?: () => number; env?: NodeJS.ProcessEnv } = {}) {
  const engine = new Engine(openDb(cfg.dbPath), { log, stallSeconds: cfg.stallSeconds, ...overrides });
  for (const [id, ch] of Object.entries(cfg.tenants)) engine.addTenant(id, ch);
  for (const p of cfg.programs) engine.addProgram(p);
  const rpc = new Rpc(cfg.rpcUrl);
  await engine.resolveProgramdata(rpc).catch((e) => log(`programdata lookup failed: ${(e as Error).message}`));
  let stopped = false;
  const stats = { polls: 0, errors: 0 };
  const pollLoop = (async () => {
    while (!stopped) {
      const res = await pollAll(engine, rpc, { sleepMs: 250 });
      stats.polls++;
      for (const r of res) if (r.error) { stats.errors++; log(`poll error ${r.addr.slice(0, 8)}: ${r.error}`); }
      for (let i = 0; i < cfg.pollIntervalSeconds * 10 && !stopped; i++) await new Promise((r) => setTimeout(r, 100));
    }
  })();
  const healthTimer = setInterval(() => { engine.checkHealth().catch((e) => log(`health check failed: ${(e as Error).message}`)); }, cfg.healthIntervalSeconds * 1000);
  const hook = cfg.webhook ? webhookServer(engine, { authToken: process.env[cfg.webhook.authTokenEnv] ?? (() => { throw new Error(`${cfg.webhook!.authTokenEnv} is not set`); })(), port: cfg.webhook.port }) : null;
  return { engine, stats, async stop() { stopped = true; clearInterval(healthTimer); hook?.close(); await pollLoop; } };
}
