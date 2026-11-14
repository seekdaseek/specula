import Database from 'better-sqlite3';
import { toJson } from './shape.js';
import type { DecodedRecord } from './types.js';

export type DB = Database.Database;

export function openDb(path: string): DB {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS programs (
  program_id TEXT NOT NULL, tenant_id TEXT NOT NULL REFERENCES tenants(id),
  idl_json TEXT NOT NULL, idl_kind TEXT NOT NULL CHECK (idl_kind IN ('anchor','codama')),
  programdata_address TEXT, silence_hours REAL, upgrade_alerts INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, PRIMARY KEY (tenant_id, program_id));
CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, program_id TEXT NOT NULL,
  rule_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS records (
  program_id TEXT NOT NULL, signature TEXT NOT NULL, ix_key TEXT NOT NULL,
  kind TEXT NOT NULL, name TEXT NOT NULL, failed INTEGER NOT NULL, slot INTEGER NOT NULL, block_time INTEGER,
  data_json TEXT NOT NULL, inserted_at INTEGER NOT NULL,
  PRIMARY KEY (program_id, signature, ix_key));
CREATE INDEX IF NOT EXISTS records_prog_time ON records(program_id, inserted_at);
CREATE TABLE IF NOT EXISTS alerts_sent (
  dedupe_key TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, program_id TEXT NOT NULL, kind TEXT NOT NULL,
  title TEXT NOT NULL, sent_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS checkpoints (
  program_id TEXT PRIMARY KEY, last_signature TEXT, last_slot INTEGER, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS observations (
  signature TEXT NOT NULL, source TEXT NOT NULL, seen_at INTEGER NOT NULL, block_time INTEGER, failed INTEGER NOT NULL,
  PRIMARY KEY (signature, source));
CREATE TABLE IF NOT EXISTS seen_signatures (
  program_id TEXT NOT NULL, signature TEXT NOT NULL, PRIMARY KEY (program_id, signature));
`);
  return db;
}

/** INSERT OR IGNORE: a re-delivery of the same signature + instruction is a no-op. Returns true when new. */
export function insertRecord(db: DB, r: DecodedRecord, now: number): boolean {
  const res = db.prepare(`INSERT OR IGNORE INTO records (program_id, signature, ix_key, kind, name, failed, slot, block_time, data_json, inserted_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(r.program_id, r.signature, r.ix_key, r.kind, r.name, r.failed ? 1 : 0, r.slot, r.block_time, toJson(r.data), now);
  return res.changes === 1;
}

/** Records the alert dedupe key; returns true when this is the first time (caller should deliver). */
export function claimAlert(db: DB, key: string, tenant: string, program: string, kind: string, title: string, now: number): boolean {
  return db.prepare(`INSERT OR IGNORE INTO alerts_sent (dedupe_key, tenant_id, program_id, kind, title, sent_at) VALUES (?,?,?,?,?,?)`).run(key, tenant, program, kind, title, now).changes === 1;
}
