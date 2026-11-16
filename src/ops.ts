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
 * Webhook-health alerts, to the OWNER only.
 *  - missed (WARNING): a transaction counts as missed only when the reconciler saw it, it is older than graceMin (10) minutes, and the webhook STILL has not delivered it. The reconciler polls
 *    every 5 min and often sees a transaction a fraction of a second before the webhook arrives (measured 14 to 16 Nov 2026: 193 of 196 reconciler-first transactions were delivered by the webhook
 *    0 to 1.5 s later, average 0.27 s), so a young poll-only row is a race, not a miss. It fires only when misses are above missRatio (20%) of the window's transactions AND at least missMin (3),
 *    and at most once per repeatHours (6).
 *  - dead (CRITICAL): programs are watched but the webhook delivered nothing for deadHours. Unchanged.
 * The judged window is the windowMin (30) minutes that END graceMin minutes ago, so every transaction in it has had graceMin minutes to be delivered.
 */
export async function checkWebhookHealth(db: DB, now: number, owner: TenantChannels, env: NodeJS.ProcessEnv, o: { programs: number; windowMin?: number; graceMin?: number; missMin?: number; missRatio?: number; repeatHours?: number; deadHours?: number; fetchImpl?: typeof fetch; startedAt: number }): Promise<string[]> {
  const sent: string[] = [];
  const windowMs = (o.windowMin ?? 30) * 60_000;
  const graceMs = (o.graceMin ?? 10) * 60_000;
  const from = now - graceMs - windowMs, to = now - graceMs;
  const post = async (severity: Alert['severity'], kind: string, key: string, title: string, text: string) => {
    if (!claimAlert(db, key, 'owner', 'service', kind, title, now)) return;
    const alert: Alert = { severity, kind, title, text, tenant_id: 'owner', program_id: 'service' };
    try { await deliver('telegram', owner, alert, env, o.fetchImpl); sent.push(kind); } catch { db.prepare('DELETE FROM alerts_sent WHERE dedupe_key=?').run(key); }
  };
  const missed = (db.prepare("SELECT COUNT(*) n FROM observations p WHERE p.source='poll' AND p.seen_at > ? AND p.seen_at <= ? AND NOT EXISTS (SELECT 1 FROM observations w WHERE w.signature = p.signature AND w.source='webhook')").get(from, to) as { n: number }).n;
  const total = (db.prepare('SELECT COUNT(DISTINCT signature) n FROM observations WHERE seen_at > ? AND seen_at <= ?').get(from, to) as { n: number }).n;
  const lastMissAlert = (db.prepare("SELECT MAX(sent_at) t FROM alerts_sent WHERE kind='webhook-missed' AND tenant_id='owner'").get() as { t: number | null }).t;
  const repeatMs = (o.repeatHours ?? 6) * 3_600_000;
  if (missed >= (o.missMin ?? 3) && total > 0 && missed / total > (o.missRatio ?? 0.2) && (lastMissAlert === null || now - lastMissAlert >= repeatMs)) {
    await post('warning', 'webhook-missed', `whmiss:${now}`, 'specula webhook is missing transactions',
      `${missed} of ${total} transactions (${Math.round((missed / total) * 100)}%) seen by the reconciler in a ${o.windowMin ?? 30} min window that ended ${o.graceMin ?? 10} min ago still have no webhook delivery. Check the webhook at Helius and the tunnel.`);
  }
  const lastWh = (db.prepare("SELECT MAX(seen_at) t FROM observations WHERE source='webhook'").get() as { t: number | null }).t ?? o.startedAt;
  if (o.programs > 0 && now - lastWh > (o.deadHours ?? 6) * 3_600_000) await post('critical', 'webhook-silent', `whdead:${Math.floor(now / 3_600_000)}`, 'specula webhook silent', `No webhook delivery for ${Math.round((now - lastWh) / 3_600_000)} h while ${o.programs} program(s) are watched.`);
  return sent;
}
