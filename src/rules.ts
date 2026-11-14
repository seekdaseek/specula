// Alert rules: Microscope's [[alerts]] TOML schema (kinds event | instruction), same operators and
// match semantics as its generated LogQL (crates/microscope-indexer/src/alerting.rs @ aa514f1).
import { toJson } from './shape.js';
import { parse } from 'smol-toml';
import type { DecodedRecord } from './types.js';

export type Operator = 'exists' | 'contains' | 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte';
export type Severity = 'critical' | 'error' | 'warning' | 'info';
export interface Condition { field: string; operator: Operator; value?: number | string | boolean }
export interface AlertRule {
  kind: 'event' | 'instruction';
  name: string;
  match: 'all' | 'any';
  conditions: Condition[];
  severity: Severity;
  channels: string[];
  /** channel names present in the pasted block that this engine cannot deliver to (slack, pagerduty) */
  unsupportedChannels: string[];
}

const OPS: Operator[] = ['exists', 'contains', 'eq', 'ne', 'gt', 'gte', 'lt', 'lte'];
const SEVERITIES: Severity[] = ['critical', 'error', 'warning', 'info'];
const MAX_EXACT = 2 ** 53;
const DELIVERABLE = new Set(['telegram', 'discord', 'webhook']);

function validatePath(f: string) {
  if (!f || f.split('.').some((s) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(s))) throw new Error(`field ${JSON.stringify(f)} must be a dot-separated JSON path containing letters, numbers, and underscores`);
}

export function validateCondition(c: Condition) {
  validatePath(c.field);
  if (!OPS.includes(c.operator)) throw new Error(`unknown operator ${c.operator}`);
  if (typeof c.value === 'number' && Math.abs(c.value) > MAX_EXACT) throw new Error(`integer condition value ${c.value} exceeds 2^53; quote the value to compare it as an exact string`);
  const v = c.value;
  if (c.operator === 'exists') { if (v !== undefined) throw new Error('operator exists does not accept a value'); return; }
  if (v === undefined) throw new Error(`operator ${c.operator} requires a value`);
  if (c.operator === 'contains') { if (typeof v !== 'string') throw new Error('operator contains requires a string value'); if (v === '') throw new Error('operator contains requires a non-empty string value'); return; }
  if (['gt', 'gte', 'lt', 'lte'].includes(c.operator) && !(typeof v === 'number' && Number.isFinite(v))) throw new Error(`operator ${c.operator} requires a finite numeric value`);
  if ((c.operator === 'eq' || c.operator === 'ne') && typeof v === 'number' && !Number.isFinite(v)) throw new Error(`operator ${c.operator} requires a finite numeric value`);
}

/** Parse a pasted Microscope `[[alerts]]` block (or a whole config containing it). */
export function parseAlertsToml(text: string): AlertRule[] {
  const doc = parse(text) as { alerts?: any[] };
  return normalizeAlerts(doc.alerts ?? []);
}

export function normalizeAlerts(raw: any[]): AlertRule[] {
  return raw.map((a, i) => {
    const known = new Set(['kind', 'name', 'match', 'conditions', 'severity', 'channels', 'lookback_window_seconds', 'evaluation_interval_seconds']);
    for (const k of Object.keys(a)) if (!known.has(k)) throw new Error(`alert ${i}: unknown field ${k}`);
    const kind = a.kind ?? 'event';
    if (kind === 'multisig') throw new Error(`alert ${i} (${a.name}): kind "multisig" is not supported in specula v0`);
    if (kind !== 'event' && kind !== 'instruction') throw new Error(`alert ${i}: unknown kind ${kind}`);
    if (!a.name || !String(a.name).trim()) throw new Error(`alert ${i}: name must not be empty`);
    if (!SEVERITIES.includes(a.severity)) throw new Error(`alert ${i}: severity must be one of ${SEVERITIES.join(', ')}`);
    const match = a.match ?? 'all';
    if (match !== 'all' && match !== 'any') throw new Error(`alert ${i}: match must be all or any`);
    const channels: string[] = a.channels ?? [];
    if (new Set(channels).size !== channels.length) throw new Error(`alert ${i}: duplicate channel`);
    const conditions: Condition[] = (a.conditions ?? []).map((c: any) => {
      const cond: Condition = { field: c.field, operator: c.operator, ...(c.value !== undefined ? { value: typeof c.value === 'bigint' ? (() => { throw new Error(`integer condition value ${c.value} exceeds 2^53; quote the value to compare it as an exact string`); })() : c.value } : {}) };
      validateCondition(cond);
      return cond;
    });
    return { kind, name: a.name, match, conditions, severity: a.severity, channels: channels.filter((c) => DELIVERABLE.has(c)), unsupportedChannels: channels.filter((c) => !DELIVERABLE.has(c)) } as AlertRule;
  });
}

/** The JSON object Microscope would have logged for this record. */
export function recordView(r: DecodedRecord): Record<string, unknown> {
  return {
    kind: r.kind, name: r.name, data: r.data, program_id: r.program_id,
    ...(r.instruction ? { instruction: r.instruction } : {}), ...(r.source ? { source: r.source } : {}),
    instruction_path: r.instruction_path, signature: r.signature, slot: r.slot, block_time: r.block_time, failed: r.failed,
  };
}

function resolve(obj: unknown, path: string): unknown {
  let cur: any = obj;
  for (const seg of path.split('.')) { if (cur === null || typeof cur !== 'object' || !(seg in cur)) return undefined; cur = cur[seg]; }
  return cur;
}

/** Loki `| json` label: missing and null -> "", scalars -> their text, objects/arrays -> JSON text. */
function label(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  return toJson(v);
}
/** Loki numeric label compare: conversion failure (empty, non-numeric) drops the line (__error__). */
function num(l: string): number | null {
  if (l === '' || l.trim() !== l) return null;
  const n = Number(l);
  return Number.isFinite(n) ? n : null;
}

export function conditionMatches(c: Condition, view: Record<string, unknown>): boolean {
  const l = label(resolve(view, c.field));
  const v = c.value;
  switch (c.operator) {
    case 'exists': return l !== '';
    case 'contains': return l.includes(v as string);
    case 'eq': case 'ne': {
      if (typeof v === 'number') { const n = num(l); if (n === null) return false; return c.operator === 'eq' ? n === v : n !== v; }
      const s = typeof v === 'boolean' ? String(v) : (v as string);
      return c.operator === 'eq' ? l === s : l !== '' && l !== s;
    }
    default: {
      const n = num(l); if (n === null) return false;
      const t = v as number;
      return c.operator === 'gt' ? n > t : c.operator === 'gte' ? n >= t : c.operator === 'lt' ? n < t : n <= t;
    }
  }
}

export function ruleMatches(rule: AlertRule, r: DecodedRecord): boolean {
  if (rule.kind === 'event' ? r.kind !== 'program_event' : r.kind !== 'program_instruction') return false;
  if (r.name !== rule.name) return false;
  if (rule.conditions.length === 0) return true;
  const view = recordView(r);
  return rule.match === 'any' ? rule.conditions.some((c) => conditionMatches(c, view)) : rule.conditions.every((c) => conditionMatches(c, view));
}
