import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'smol-toml';
import { normalizeAlerts } from './rules.js';
import type { ProgramSpec } from './engine.js';
import type { TenantChannels } from './channels.js';

export interface SpeculaConfig {
  dbPath: string;
  rpcUrl: string;
  pollIntervalSeconds: number;
  healthIntervalSeconds: number;
  stallSeconds: number;
  webhook?: { port: number; authTokenEnv: string };
  tenants: Record<string, TenantChannels>;
  programs: ProgramSpec[];
}

export function loadConfig(file: string): SpeculaConfig {
  const base = path.dirname(path.resolve(file));
  const d = parse(fs.readFileSync(file, 'utf8')) as any;
  if (!d.rpc_url) throw new Error('rpc_url is required');
  const tenants: Record<string, TenantChannels> = {};
  for (const [id, t] of Object.entries<any>(d.tenants ?? {})) tenants[id] = { ...(t.telegram ? { telegram: t.telegram } : {}), ...(t.discord ? { discord: t.discord } : {}), ...(t.webhook ? { webhook: t.webhook } : {}) };
  const programs: ProgramSpec[] = (d.programs ?? []).map((p: any) => {
    if (!tenants[p.tenant]) throw new Error(`program ${p.program_id}: unknown tenant ${p.tenant}`);
    const idlKind = p.idl_kind ?? 'anchor';
    const idlFile = path.resolve(base, p.idl_path);
    return { tenantId: p.tenant, programId: p.program_id, idl: JSON.parse(fs.readFileSync(idlFile, 'utf8')), idlKind, rules: normalizeAlerts(p.alerts ?? []), silenceHours: p.silence_hours, upgradeAlerts: p.upgrade_alerts, explorerUrl: p.explorer_transaction_url } as ProgramSpec;
  });
  return {
    dbPath: path.resolve(base, d.db_path ?? 'specula.db'), rpcUrl: d.rpc_url,
    pollIntervalSeconds: d.poll_interval_seconds ?? 15, healthIntervalSeconds: d.health_interval_seconds ?? 60, stallSeconds: d.stall_seconds ?? 300,
    ...(d.webhook ? { webhook: { port: d.webhook.port, authTokenEnv: d.webhook.auth_token_env ?? 'SPECULA_WEBHOOK_TOKEN' } } : {}),
    tenants, programs,
  };
}
