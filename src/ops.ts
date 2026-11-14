import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from './db.js';
import { claimAlert } from './db.js';
import { deliver, type Alert, type TenantChannels } from './channels.js';

/** Daily backup with `sqlite3 <db> ".backup <file>"` (consistent under WAL, unlike a file copy). Keeps the newest `keep` files. */
export function backupDb(dbPath: string, dir: string, now: number, keep = 7): string {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date(now).toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const out = path.join(dir, `specula-${stamp}.db`);
  execFileSync('sqlite3', [dbPath, `.backup '${out.replace(/'/g, "''")}'`]);
  const files = fs.readdirSync(dir).filter((f) => /^specula-\d{12}\.db$/.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.rmSync(path.join(dir, f));
  return out;
}
export const latestBackupAge = (dir: string, now: number): number => {
  try { const f = fs.readdirSync(dir).filter((x) => /^specula-\d{12}\.db$/.test(x)).sort().pop(); return f ? now - fs.statSync(path.join(dir, f)).mtimeMs : Infinity; } catch { return Infinity; }
};

/**
 * Webhook-silence alerts, to the OWNER only.
 *  - missed: >= missMin transactions seen only by the reconciler in the last window (the webhook did not deliver them).
 *  - dead: programs are watched but the webhook delivered nothing for deadHours.
 */
export async function checkWebhookHealth(db: DB, now: number, owner: TenantChannels, env: NodeJS.ProcessEnv, o: { programs: number; windowMin?: number; missMin?: number; deadHours?: number; fetchImpl?: typeof fetch; startedAt: number }): Promise<string[]> {
  const sent: string[] = [];
  const windowMs = (o.windowMin ?? 30) * 60_000;
  const poll = (db.prepare("SELECT COUNT(*) n FROM observations WHERE source='poll' AND seen_at > ?").get(now - windowMs) as { n: number }).n;
  const post = async (kind: string, key: string, title: string, text: string) => {
    if (!claimAlert(db, key, 'owner', 'service', kind, title, now)) return;
    const alert: Alert = { severity: 'critical', kind, title, text, tenant_id: 'owner', program_id: 'service' };
    try { await deliver('telegram', owner, alert, env, o.fetchImpl); sent.push(kind); } catch { db.prepare('DELETE FROM alerts_sent WHERE dedupe_key=?').run(key); }
  };
  if (poll >= (o.missMin ?? 3)) await post('webhook-missed', `whmiss:${Math.floor(now / windowMs)}`, 'specula webhook is missing transactions', `The reconciler found ${poll} transactions in the last ${o.windowMin ?? 30} min that the Helius webhook did not deliver. Check the webhook at Helius and the tunnel.`);
  const lastWh = (db.prepare("SELECT MAX(seen_at) t FROM observations WHERE source='webhook'").get() as { t: number | null }).t ?? o.startedAt;
  if (o.programs > 0 && now - lastWh > (o.deadHours ?? 6) * 3_600_000) await post('webhook-silent', `whdead:${Math.floor(now / 3_600_000)}`, 'specula webhook silent', `No webhook delivery for ${Math.round((now - lastWh) / 3_600_000)} h while ${o.programs} program(s) are watched.`);
  return sent;
}
