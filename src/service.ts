// Self-serve service layer: users, trial, quota metering, per-user tenants. No Telegram I/O here (see bot.ts).
import type { DB } from './db.js';
import type { Engine } from './engine.js';
import type { PlansConfig, Plan } from './plans.js';

export const SERVICE_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  telegram_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, tenant_id TEXT NOT NULL UNIQUE,
  plan TEXT, trial_started_at INTEGER, trial_ends_at INTEGER, trial_notified INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS usage (
  tenant_id TEXT NOT NULL, program_id TEXT NOT NULL, month TEXT NOT NULL, tx_count INTEGER NOT NULL DEFAULT 0,
  warned80 INTEGER NOT NULL DEFAULT 0, paused_notified INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (tenant_id, program_id, month));
CREATE TABLE IF NOT EXISTS metered (tenant_id TEXT NOT NULL, program_id TEXT NOT NULL, signature TEXT NOT NULL, month TEXT NOT NULL, PRIMARY KEY (tenant_id, program_id, signature));
CREATE TABLE IF NOT EXISTS watch_log (telegram_id TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS pending_idl (telegram_id TEXT PRIMARY KEY, program_id TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS billing_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT NOT NULL, plan_id TEXT NOT NULL, amount_raw TEXT NOT NULL, reference TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open', last_checked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS payments (
  signature TEXT PRIMARY KEY, order_id INTEGER NOT NULL, telegram_id TEXT NOT NULL, plan_id TEXT NOT NULL, amount_raw TEXT NOT NULL,
  status TEXT NOT NULL, detail TEXT, created_at INTEGER NOT NULL);
`;
const MIGRATIONS = ['ALTER TABLE users ADD COLUMN paid_plan TEXT', 'ALTER TABLE users ADD COLUMN paid_until INTEGER', "ALTER TABLE users ADD COLUMN renew_flags TEXT NOT NULL DEFAULT ''"];

export interface Notice { chatId: string; text: string }
export interface UserRow { telegram_id: string; chat_id: string; tenant_id: string; plan: string | null; trial_started_at: number | null; trial_ends_at: number | null; trial_notified: number; created_at: number; paid_plan: string | null; paid_until: number | null; renew_flags: string }

export const monthKey = (ms: number) => new Date(ms).toISOString().slice(0, 7);
export const tenantOf = (telegramId: string) => `tg:${telegramId}`;

export class Service {
  readonly notices: Notice[] = [];
  constructor(readonly db: DB, readonly engine: Engine, readonly cfg: PlansConfig, readonly now: () => number = () => Date.now()) {
    db.exec(SERVICE_SCHEMA);
    for (const m of MIGRATIONS) { try { db.exec(m); } catch { /* column already there */ } }
  }

  // ---- users / plans
  user(telegramId: string): UserRow | undefined { return this.db.prepare('SELECT * FROM users WHERE telegram_id=?').get(telegramId) as UserRow | undefined; }
  userByTenant(tenantId: string): UserRow | undefined { return this.db.prepare('SELECT * FROM users WHERE tenant_id=?').get(tenantId) as UserRow | undefined; }
  ensureUser(telegramId: string, chatId: string): UserRow {
    let u = this.user(telegramId);
    if (!u) {
      this.db.prepare('INSERT INTO users (telegram_id, chat_id, tenant_id, created_at) VALUES (?,?,?,?)').run(telegramId, chatId, tenantOf(telegramId), this.now());
      u = this.user(telegramId)!;
    } else if (u.chat_id !== chatId) { this.db.prepare('UPDATE users SET chat_id=? WHERE telegram_id=?').run(chatId, telegramId); u = this.user(telegramId)!; }
    this.engine.addTenant(u.tenant_id, { telegram: { chat_id: u.chat_id } }, `telegram ${telegramId}`);
    return u;
  }
  /** Load every user's tenant into the engine (service restart). */
  restoreTenants() { for (const u of this.db.prepare('SELECT * FROM users').all() as UserRow[]) this.engine.addTenant(u.tenant_id, { telegram: { chat_id: u.chat_id } }, `telegram ${u.telegram_id}`); }

  /** The trial clock starts at the first successful /watch; one trial per Telegram user id (the users row is permanent). */
  startTrialIfNeeded(telegramId: string) {
    const u = this.user(telegramId)!;
    if (u.trial_started_at) return;
    const t = this.now();
    this.db.prepare('UPDATE users SET trial_started_at=?, trial_ends_at=?, plan=? WHERE telegram_id=?').run(t, t + this.cfg.trial.days * 86_400_000, this.cfg.trial.plan, telegramId);
  }
  /** 'none' = no trial started yet, 'trial', 'expired' (no access), or 'paid' (active or inside the grace period). */
  state(u: UserRow): 'none' | 'trial' | 'expired' | 'paid' {
    const b = this.cfg.billing;
    if (u.paid_plan && this.cfg.plans[u.paid_plan] && this.now() < (u.paid_until ?? 0) + b.graceDays * 86_400_000) return 'paid';
    if (!u.trial_started_at) return u.paid_plan ? 'expired' : 'none';   // a lapsed paying user does not get a fresh trial
    return this.now() < (u.trial_ends_at ?? 0) ? 'trial' : 'expired';
  }
  /** The free tier (R39): a user with no paid plan and no trial running (none yet, or ended). It watches ONE program for upgrade and authority changes: no IDL, no rules, no tx metering, no expiry. */
  get freeEnabled(): boolean { return !!this.cfg.free; }
  isFree(u: UserRow): boolean { if (!this.cfg.free) return false; const st = this.state(u); return st === 'none' || st === 'expired'; }
  /** paid plan state in more detail: active, grace, or null */
  paidPhase(u: UserRow): 'active' | 'grace' | null {
    if (!u.paid_plan || !this.cfg.plans[u.paid_plan]) return null;
    const until = u.paid_until ?? 0;
    if (this.now() < until) return 'active';
    return this.now() < until + this.cfg.billing.graceDays * 86_400_000 ? 'grace' : null;
  }
  limits(u: UserRow): { plan: Plan; maxPrograms: number } | null {
    const st = this.state(u);
    if (st === 'expired') return null;
    if (st === 'paid') { const plan = this.cfg.plans[u.paid_plan!]!; return { plan, maxPrograms: plan.maxPrograms }; }
    return { plan: this.cfg.plans[this.cfg.trial.plan]!, maxPrograms: this.cfg.trial.maxPrograms };
  }
  /** Activate or extend a paid plan by one period from max(now, current expiry). Returns the new expiry. */
  activatePaid(telegramId: string, planId: string): number {
    const u = this.user(telegramId)!; const now = this.now();
    const base = Math.max(now, this.paidPhase(u) === 'active' ? (u.paid_until ?? 0) : now);
    const until = base + this.cfg.billing.periodDays * 86_400_000;
    this.db.prepare("UPDATE users SET paid_plan=?, paid_until=?, renew_flags='' WHERE telegram_id=?").run(planId, until, telegramId);
    return until;
  }
  trialDaysLeft(u: UserRow): number { return Math.max(0, Math.ceil(((u.trial_ends_at ?? 0) - this.now()) / 86_400_000)); }
  programCount(tenantId: string): number { return (this.db.prepare('SELECT COUNT(*) n FROM programs WHERE tenant_id=?').get(tenantId) as { n: number }).n; }

  // ---- rate limits
  /** 5 /watch per user per hour; every attempt counts. Returns false when over the limit. */
  watchAllowed(telegramId: string, perHour = 5): boolean {
    const since = this.now() - 3_600_000;
    this.db.prepare('DELETE FROM watch_log WHERE at < ?').run(since);
    const n = (this.db.prepare('SELECT COUNT(*) n FROM watch_log WHERE telegram_id=?').get(telegramId) as { n: number }).n;
    if (n >= perHour) return false;
    this.db.prepare('INSERT INTO watch_log (telegram_id, at) VALUES (?,?)').run(telegramId, this.now());
    return true;
  }

  // ---- metering (engine hooks)
  quotaFor(tenantId: string): number | null {
    const u = this.userByTenant(tenantId); if (!u) return null;           // static tenants (operator proof tenant) are not metered
    const l = this.limits(u); return l ? l.plan.txPerMonth : 0;
  }
  /** R41: true when this program may no longer cost credits: this month's quota is used up, or the user has no access. Static tenants (operator proof tenant) are never over quota. */
  quotaReached = (tenantId: string, programId: string): boolean => {
    const quota = this.quotaFor(tenantId); if (quota === null) return false;
    return quota <= 0 || this.usage(tenantId, programId) >= quota;
  };
  usage(tenantId: string, programId: string): number {
    return ((this.db.prepare('SELECT tx_count n FROM usage WHERE tenant_id=? AND program_id=? AND month=?').get(tenantId, programId, monthKey(this.now())) as { n: number } | undefined)?.n) ?? 0;
  }
  /** Engine.onTx: count a transaction once per (tenant, program, signature); queue the 80% warning and the 100% pause notice once per month. */
  onTx = (tenantId: string, programId: string, signature: string) => {
    const quota = this.quotaFor(tenantId); if (quota === null) return;
    const month = monthKey(this.now());
    if (this.db.prepare('INSERT OR IGNORE INTO metered (tenant_id, program_id, signature, month) VALUES (?,?,?,?)').run(tenantId, programId, signature, month).changes === 0) return;
    this.db.prepare('INSERT INTO usage (tenant_id, program_id, month, tx_count) VALUES (?,?,?,1) ON CONFLICT(tenant_id, program_id, month) DO UPDATE SET tx_count = tx_count + 1').run(tenantId, programId, month);
    const row = this.db.prepare('SELECT * FROM usage WHERE tenant_id=? AND program_id=? AND month=?').get(tenantId, programId, month) as { tx_count: number; warned80: number; paused_notified: number };
    const u = this.userByTenant(tenantId)!;
    if (row.tx_count >= quota && !row.paused_notified) {
      this.db.prepare('UPDATE usage SET paused_notified=1, warned80=1 WHERE tenant_id=? AND program_id=? AND month=?').run(tenantId, programId, month);
      this.notices.push({ chatId: u.chat_id, text: `Alerts for ${programId} are paused: you used ${row.tx_count.toLocaleString('en-US')} of ${quota.toLocaleString('en-US')} transactions this month. They resume on the 1st (UTC). A higher plan raises the limit: /plans.` });
    } else if (row.tx_count >= Math.ceil(quota * 0.8) && !row.warned80) {
      this.db.prepare('UPDATE usage SET warned80=1 WHERE tenant_id=? AND program_id=? AND month=?').run(tenantId, programId, month);
      this.notices.push({ chatId: u.chat_id, text: `Heads-up: ${programId} has used ${row.tx_count.toLocaleString('en-US')} of ${quota.toLocaleString('en-US')} transactions this month (80%). At 100% alerts for it pause until the 1st (UTC).` });
    }
  };
  /** Engine.canAlert: false when the trial is over, there is no trial yet, or this month's quota is used up. */
  canAlert = (tenantId: string, programId: string): boolean => {
    const quota = this.quotaFor(tenantId); if (quota === null) return true;
    return quota > 0 && this.usage(tenantId, programId) < quota;
  };

  /** Timer: trial-ended notices (once per user). Returns and clears the queued notices. */
  tick(): Notice[] {
    const now = this.now();
    for (const u of this.db.prepare('SELECT * FROM users WHERE trial_started_at IS NOT NULL AND trial_notified=0 AND trial_ends_at <= ?').all(now) as UserRow[]) {
      if (this.paidPhase(u)) continue;
      this.db.prepare('UPDATE users SET trial_notified=1 WHERE telegram_id=?').run(u.telegram_id);
      this.notices.push({ chatId: u.chat_id, text: `Your ${this.cfg.trial.days}-day trial has ended, so alerts are paused. /plans shows the plans and /upgrade PLAN pays in USDC. Your programs and rules are kept.` });
    }
    // renewal reminders: 3 days before expiry, on the expiry day, and when the grace period ends (each once per paid period)
    const b = this.cfg.billing;
    for (const u of this.db.prepare('SELECT * FROM users WHERE paid_plan IS NOT NULL AND paid_until IS NOT NULL').all() as UserRow[]) {
      const until = u.paid_until!; const flags = new Set(u.renew_flags.split(',').filter(Boolean)); const add = (f: string, text: string) => { flags.add(f); this.db.prepare('UPDATE users SET renew_flags=? WHERE telegram_id=?').run([...flags].join(','), u.telegram_id); this.notices.push({ chatId: u.chat_id, text }); };
      const name = this.cfg.plans[u.paid_plan!]?.name ?? u.paid_plan;
      if (now >= until + b.graceDays * 86_400_000) { if (!flags.has('end')) add('end', `Your ${name} plan grace period is over, so alerts are paused. /upgrade ${u.paid_plan} renews it; your programs and rules are kept.`); }
      else if (now >= until) { if (!flags.has('due')) add('due', `Your ${name} plan expired today. Alerts keep running for ${b.graceDays} more days; /upgrade ${u.paid_plan} renews it.`); }
      else if (now >= until - b.reminderDays * 86_400_000) { if (!flags.has('soon')) add('soon', `Your ${name} plan expires on ${new Date(until).toISOString().slice(0, 10)}. /upgrade ${u.paid_plan} renews it (extends by ${b.periodDays} days from the current expiry).`); }
    }
    this.db.prepare("DELETE FROM metered WHERE month < ?").run(monthKey(now - 40 * 86_400_000));
    return this.notices.splice(0);
  }
}
