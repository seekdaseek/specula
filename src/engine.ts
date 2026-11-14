import { AnchorDecoder, type TxDecoder } from './decode.js';
import { CodamaDecoder } from './decode-codama.js';
import { convertLegacyIdl, isLegacyIdl } from './idl-legacy.js';
import { claimAlert, insertRecord, type DB } from './db.js';
import { deliver, type Alert, type TenantChannels } from './channels.js';
import { ruleMatches, type AlertRule } from './rules.js';
import { toJson } from './shape.js';
import { findUpgrades, LOADER } from './upgrade.js';
import type { DecodedRecord, RawTx } from './types.js';

export interface ProgramSpec {
  tenantId: string;
  programId: string;
  idl: Record<string, unknown>;
  idlKind?: 'anchor' | 'codama';
  rules: AlertRule[];
  silenceHours?: number;          // alert when no decoded record for this long
  upgradeAlerts?: boolean;        // default true
  programdata?: string;           // resolved by resolveProgramdata() when omitted
  explorerUrl?: string;           // default https://explorer.solana.com/tx/{signature}
}
export interface EngineOpts {
  now?: () => number;             // ms; injectable for tests
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
  /** pipeline stall threshold in seconds with no successful ingest heartbeat */
  stallSeconds?: number;
  /** false => this tenant's program is paused (trial over / quota reached): no rule, upgrade or silence alerts */
  canAlert?: (tenantId: string, programId: string) => boolean;
  /** called once per (tenant program, transaction) before alerts are evaluated: metering */
  onTx?: (tenantId: string, programId: string, signature: string) => void;
  /** pipeline-stall alerts go ONLY here (the operator), never to tenants */
  ownerChannels?: TenantChannels;
}

interface Entry extends ProgramSpec { decoder: TxDecoder; ruleIds: number[] }

export class Engine {
  readonly now: () => number;
  private tenants = new Map<string, TenantChannels>();
  private entries: Entry[] = [];
  readonly stallSeconds: number;
  constructor(readonly db: DB, readonly opts: EngineOpts = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.stallSeconds = opts.stallSeconds ?? 300;
  }
  private log(m: string) { this.opts.log?.(m); }

  addTenant(id: string, channels: TenantChannels = {}, name = id) {
    this.tenants.set(id, channels);
    this.db.prepare('INSERT OR IGNORE INTO tenants (id, name, created_at) VALUES (?,?,?)').run(id, name, this.now());
  }

  private makeDecoder(spec: ProgramSpec, kind: string): TxDecoder {
    return kind === 'codama' ? new CodamaDecoder(spec.programId, spec.idl) : new AnchorDecoder(spec.programId, isLegacyIdl(spec.idl) ? convertLegacyIdl(spec.idl, spec.programId) : spec.idl);
  }

  addProgram(spec: ProgramSpec) {
    const kind = spec.idlKind ?? ((spec.idl as any).kind === 'rootNode' ? 'codama' : 'anchor');
    if (!this.tenants.has(spec.tenantId)) throw new Error(`unknown tenant ${spec.tenantId}`);
    const decoder = this.makeDecoder(spec, kind);          // throws on a bad IDL before anything is stored
    const ins = this.db.prepare(`INSERT OR IGNORE INTO programs (program_id, tenant_id, idl_json, idl_kind, programdata_address, silence_hours, upgrade_alerts, created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(spec.programId, spec.tenantId, JSON.stringify(spec.idl), kind, spec.programdata ?? null, spec.silenceHours ?? null, spec.upgradeAlerts === false ? 0 : 1, this.now());
    if (ins.changes === 0) this.db.prepare('DELETE FROM rules WHERE tenant_id=? AND program_id=?').run(spec.tenantId, spec.programId); // config file restart: the file is the authority
    const ruleIds = spec.rules.map((r) => Number(this.db.prepare('INSERT INTO rules (tenant_id, program_id, rule_json) VALUES (?,?,?)').run(spec.tenantId, spec.programId, JSON.stringify(r)).lastInsertRowid));
    this.entries.push({ ...spec, decoder, ruleIds });
  }

  /** Rebuild the in-memory entries from the database (service restart). Tenants must be added first. */
  restore() {
    for (const p of this.db.prepare('SELECT * FROM programs ORDER BY created_at').all() as any[]) {
      if (this.entries.some((e) => e.tenantId === p.tenant_id && e.programId === p.program_id) || !this.tenants.has(p.tenant_id)) continue;
      const rs = this.db.prepare('SELECT id, rule_json FROM rules WHERE tenant_id=? AND program_id=? ORDER BY id').all(p.tenant_id, p.program_id) as { id: number; rule_json: string }[];
      const spec: ProgramSpec = { tenantId: p.tenant_id, programId: p.program_id, idl: JSON.parse(p.idl_json), idlKind: p.idl_kind, rules: rs.map((r) => JSON.parse(r.rule_json)), silenceHours: p.silence_hours ?? undefined, upgradeAlerts: !!p.upgrade_alerts, programdata: p.programdata_address ?? undefined };
      try { this.entries.push({ ...spec, decoder: this.makeDecoder(spec, p.idl_kind), ruleIds: rs.map((r) => r.id) }); }
      catch (e) { this.log(`restore: skipping ${p.program_id}: ${(e as Error).message}`); }
    }
  }

  private entry(tenantId: string, programId: string) { return this.entries.find((e) => e.tenantId === tenantId && e.programId === programId); }
  addRule(tenantId: string, programId: string, rule: AlertRule): number {
    const e = this.entry(tenantId, programId); if (!e) throw new Error('program not found');
    const id = Number(this.db.prepare('INSERT INTO rules (tenant_id, program_id, rule_json) VALUES (?,?,?)').run(tenantId, programId, JSON.stringify(rule)).lastInsertRowid);
    e.rules.push(rule); e.ruleIds.push(id); return id;
  }
  removeRule(tenantId: string, programId: string, ruleId: number): boolean {
    const e = this.entry(tenantId, programId); const i = e ? e.ruleIds.indexOf(ruleId) : -1;
    if (!e || i < 0) return false;
    this.db.prepare('DELETE FROM rules WHERE id=? AND tenant_id=? AND program_id=?').run(ruleId, tenantId, programId);
    e.rules.splice(i, 1); e.ruleIds.splice(i, 1); return true;
  }
  rulesOf(tenantId: string, programId: string): { id: number; rule: AlertRule }[] { const e = this.entry(tenantId, programId); return e ? e.rules.map((rule, i) => ({ id: e.ruleIds[i]!, rule })) : []; }
  removeProgram(tenantId: string, programId: string): boolean {
    const i = this.entries.findIndex((e) => e.tenantId === tenantId && e.programId === programId); if (i < 0) return false;
    this.entries.splice(i, 1);
    this.db.prepare('DELETE FROM rules WHERE tenant_id=? AND program_id=?').run(tenantId, programId);
    this.db.prepare('DELETE FROM programs WHERE tenant_id=? AND program_id=?').run(tenantId, programId); return true;
  }
  getEntry(tenantId: string, programId: string) { return this.entry(tenantId, programId); }
  programs(): Entry[] { return this.entries; }
  /** true when a transaction touching a registered program was already ingested (by webhook or poll): the reconciler then skips its getTransaction */
  alreadyObserved(signature: string): boolean { return this.db.prepare('SELECT 1 FROM observations WHERE signature=? LIMIT 1').get(signature) !== undefined; }

  /** Find the programdata account from the program account (not hard-coded). */
  async resolveProgramdata(rpc: { getAccountData(addr: string): Promise<{ owner: string; data: Buffer } | null> }) {
    for (const e of this.entries) {
      if (e.programdata) continue;
      const acc = await rpc.getAccountData(e.programId);
      if (acc && acc.owner === LOADER && acc.data.length >= 36 && acc.data.readUInt32LE(0) === 2) {
        const { default: bs58 } = await import('bs58');
        e.programdata = bs58.encode(acc.data.subarray(4, 36));
        this.db.prepare('UPDATE programs SET programdata_address=? WHERE program_id=? AND tenant_id=?').run(e.programdata, e.programId, e.tenantId);
      } else this.log(`programdata not resolved for ${e.programId} (not an upgradeable-loader program account?)`);
    }
  }

  /** Decode a transaction for every registered program it touches, store records, fire alerts. */
  async processTx(tx: RawTx, source: 'poll' | 'webhook' = 'poll'): Promise<{ records: number; newRecords: number; alerts: number }> {
    const keys = new Set([...tx.transaction.message.accountKeys, ...(tx.meta?.loadedAddresses?.writable ?? []), ...(tx.meta?.loadedAddresses?.readonly ?? [])]);
    let records = 0, newRecords = 0, alerts = 0;
    if (this.entries.some((e) => keys.has(e.programId))) {
      this.db.prepare('INSERT OR IGNORE INTO observations (signature, source, seen_at, block_time, failed) VALUES (?,?,?,?,?)')
        .run(tx.transaction.signatures[0], source, this.now(), tx.blockTime ?? null, tx.meta?.err ? 1 : 0);
    }
    for (const e of this.entries.slice()) {
      if (keys.has(e.programId)) this.opts.onTx?.(e.tenantId, e.programId, tx.transaction.signatures[0]!);
      const allow = this.opts.canAlert ? this.opts.canAlert(e.tenantId, e.programId) : true;
      if (keys.has(e.programId)) {
        const recs = e.decoder.decodeTx(tx);
        for (const r of recs) {
          records++;
          if (insertRecord(this.db, r, this.now())) newRecords++;
          if (allow) alerts += await this.evaluate(e, r);
        }
      }
      if (e.upgradeAlerts !== false && e.programdata && keys.has(e.programdata) && keys.has(LOADER)) {
        for (const u of findUpgrades(tx, e.programdata)) {
          const rec: DecodedRecord = { kind: 'program_instruction', name: `loader_${u.action}`, data: u, program_id: e.programId, signature: u.signature, slot: u.slot, block_time: u.block_time, failed: u.failed, instruction_path: u.ix_key, ix_key: u.ix_key };
          records++;
          if (insertRecord(this.db, rec, this.now())) newRecords++;
          if (allow) alerts += await this.send(e, {
            severity: u.failed ? 'warning' : 'critical',
            title: `${u.failed ? 'FAILED ' : ''}program ${u.action === 'upgrade' ? 'upgrade' : 'authority change'}: ${e.programId}`,
            text: u.action === 'upgrade'
              ? `Program ${e.programId} programdata ${u.programdata} was upgraded from buffer ${u.buffer ?? '?'} by ${u.authority ?? '?'}${u.failed ? ' (transaction FAILED)' : ''}.`
              : `Upgrade authority of ${e.programId} (programdata ${u.programdata}) changed: ${u.authority ?? '?'} -> ${u.new_authority ?? 'NONE (program becomes immutable)'}${u.failed ? ' (transaction FAILED)' : ''}.`,
            kind: 'upgrade', signature: u.signature, fields: { ...u },
          }, `upgrade:${e.tenantId}:${e.programId}:${u.signature}:${u.ix_key}`, ['telegram', 'discord', 'webhook']);
        }
      }
    }
    return { records, newRecords, alerts };
  }

  private async evaluate(e: Entry, r: DecodedRecord): Promise<number> {
    let n = 0;
    for (let i = 0; i < e.rules.length; i++) {
      const rule = e.rules[i]!;
      if (!ruleMatches(rule, r)) continue;
      // one alert per rule per signature (Microscope sums by signature)
      n += await this.send(e, {
        severity: rule.severity, kind: 'rule',
        title: `${rule.kind} ${rule.name}${r.failed ? ' (failed tx)' : ''} on ${e.programId}`,
        text: `Rule ${e.ruleIds[i] ?? i} (${rule.kind} ${rule.name}) matched in ${r.signature}\n${toJson(r.data).slice(0, 800)}`,
        signature: r.signature, fields: { rule: e.ruleIds[i] ?? i, name: r.name, failed: r.failed, slot: r.slot },
      }, `rule:${e.tenantId}:${e.programId}:${e.ruleIds[i] ?? i}:${r.signature}`, rule.channels);
    }
    return n;
  }

  /** Claim the dedupe key, deliver to the channels, release the claim if every channel failed. Returns 1 if delivered/claimed. */
  async send(e: Entry, partial: Omit<Alert, 'tenant_id' | 'program_id' | 'text'> & { text: string }, key: string, channels: string[], via?: TenantChannels): Promise<number> {
    const alert: Alert = { ...partial, tenant_id: e.tenantId, program_id: e.programId, explorer_url: partial.signature ? (e.explorerUrl ?? 'https://explorer.solana.com/tx/{signature}').replace('{signature}', partial.signature) : undefined };
    if (!claimAlert(this.db, key, e.tenantId, e.programId, alert.kind, alert.title, this.now())) return 0;
    const cfg = via ?? this.tenants.get(e.tenantId) ?? {};
    const targets = channels.length ? channels : [];
    if (targets.length === 0) return 1; // evaluated, no delivery channels (Microscope: "leave channels empty to evaluate without delivering")
    const results = await Promise.allSettled(targets.filter((c) => (cfg as any)[c]).map((c) => deliver(c, cfg, alert, this.opts.env, this.opts.fetchImpl)));
    const ok = results.some((r) => r.status === 'fulfilled');
    results.forEach((r) => { if (r.status === 'rejected') this.log(`delivery failed: ${(r.reason as Error).message}`); else if ((r.value as any)?.message_id) this.log(`alert ${alert.kind} delivered, telegram message_id=${(r.value as any).message_id}`); });
    if (!ok && results.length > 0) { this.db.prepare('DELETE FROM alerts_sent WHERE dedupe_key=?').run(key); return 0; }
    return 1;
  }

  /** Silence + pipeline-health alerts. Call on a timer. Fake-clock friendly. */
  async checkHealth(): Promise<{ silence: number; pipeline: number }> {
    const nowMs = this.now();
    let silence = 0, pipeline = 0;
    for (const e of this.entries) {
      const hb = this.db.prepare('SELECT MAX(updated_at) AS t FROM checkpoints WHERE program_id IN (?, ?)').get(e.programId, e.programdata ?? e.programId) as { t: number | null };
      const created = (this.db.prepare('SELECT created_at FROM programs WHERE program_id=? AND tenant_id=?').get(e.programId, e.tenantId) as { created_at: number }).created_at;
      const lastBeat = hb.t ?? created;
      const stalled = nowMs - lastBeat > this.stallSeconds * 1000;
      if (stalled) {
        const owner = this.opts.ownerChannels;
        pipeline += await this.send(e, {
          severity: 'critical', kind: 'pipeline',
          title: `specula ingest stalled for ${e.programId}`,
          text: `No successful ingest poll for ${Math.round((nowMs - lastBeat) / 1000)}s (threshold ${this.stallSeconds}s). Silence alerts for this program are suppressed until ingest recovers.`,
        }, `pipeline:${owner ? 'owner' : e.tenantId}:${e.programId}:${lastBeat}`, ['telegram', 'discord', 'webhook'], owner);
        continue; // never let silence speak for a broken pipe
      }
      if (e.silenceHours && (this.opts.canAlert ? this.opts.canAlert(e.tenantId, e.programId) : true)) {
        const last = this.db.prepare('SELECT MAX(COALESCE(block_time * 1000, inserted_at)) AS t FROM records WHERE program_id=? AND kind IN (\'program_instruction\',\'program_event\')').get(e.programId) as { t: number | null };
        const ref = Math.max(last.t ?? 0, created);
        if (nowMs - ref > e.silenceHours * 3600_000) {
          silence += await this.send(e, {
            severity: 'warning', kind: 'silence',
            title: `no activity on ${e.programId} for ${e.silenceHours}h`,
            text: `No decoded record since ${new Date(ref).toISOString()} (threshold ${e.silenceHours}h). Ingest is healthy (last poll ${new Date(lastBeat).toISOString()}).`,
          }, `silence:${e.tenantId}:${e.programId}:${ref}`, ['telegram', 'discord', 'webhook']);
        }
      }
    }
    return { silence, pipeline };
  }
}
