import { describe, expect, it } from 'vitest';
import { conditionMatches, parseAlertsToml, ruleMatches, validateCondition, type Condition } from '../src/rules.js';
import type { DecodedRecord } from '../src/types.js';

const rec = (data: unknown, over: Partial<DecodedRecord> = {}): DecodedRecord => ({ kind: 'program_event', name: 'ev', data, program_id: 'P', signature: 'S', slot: 1, block_time: 1, failed: false, instruction_path: '0', ix_key: '0:ev0', ...over });
const m = (c: Condition, data: unknown, over?: Partial<DecodedRecord>) => ruleMatches({ kind: 'event', name: 'ev', match: 'all', conditions: [c], severity: 'info', channels: [], unsupportedChannels: [] }, rec(data, over));

describe('operators (semantics from Microscope alerting.rs condition_filter)', () => {
  it('exists: missing, null and "" do not match; 0, false and "x" do', () => {
    const c: Condition = { field: 'data.a', operator: 'exists' };
    expect(m(c, {})).toBe(false); expect(m(c, { a: null })).toBe(false); expect(m(c, { a: '' })).toBe(false);
    expect(m(c, { a: 0 })).toBe(true); expect(m(c, { a: false })).toBe(true); expect(m(c, { a: 'x' })).toBe(true);
  });
  it('contains: substring on string, needs the field; "" never matches', () => {
    const c: Condition = { field: 'data.s', operator: 'contains', value: 'ab' };
    expect(m(c, { s: 'xxabyy' })).toBe(true); expect(m(c, { s: 'xx' })).toBe(false); expect(m(c, {})).toBe(false); expect(m(c, { s: null })).toBe(false); expect(m(c, { s: '' })).toBe(false);
  });
  it('eq number: numeric; missing/null/""/non-numeric never match', () => {
    const c: Condition = { field: 'data.n', operator: 'eq', value: 5 };
    expect(m(c, { n: 5 })).toBe(true); expect(m(c, { n: 6 })).toBe(false); expect(m(c, {})).toBe(false); expect(m(c, { n: null })).toBe(false); expect(m(c, { n: '' })).toBe(false); expect(m(c, { n: 'abc' })).toBe(false);
  });
  it('eq string / boolean compare label text', () => {
    expect(m({ field: 'data.s', operator: 'eq', value: 'x' }, { s: 'x' })).toBe(true);
    expect(m({ field: 'failed', operator: 'eq', value: false }, {}, { failed: false })).toBe(true);
    expect(m({ field: 'failed', operator: 'eq', value: false }, {}, { failed: true })).toBe(false);
  });
  it('ne string/boolean requires the field to be present; ne number needs a numeric field', () => {
    const s: Condition = { field: 'data.s', operator: 'ne', value: 'x' };
    expect(m(s, { s: 'y' })).toBe(true); expect(m(s, { s: 'x' })).toBe(false); expect(m(s, {})).toBe(false); expect(m(s, { s: null })).toBe(false); expect(m(s, { s: '' })).toBe(false);
    const b: Condition = { field: 'data.b', operator: 'ne', value: true };
    expect(m(b, { b: false })).toBe(true); expect(m(b, { b: true })).toBe(false); expect(m(b, {})).toBe(false);
    const n: Condition = { field: 'data.n', operator: 'ne', value: 5 };
    expect(m(n, { n: 6 })).toBe(true); expect(m(n, { n: 5 })).toBe(false); expect(m(n, {})).toBe(false);
  });
  it.each([['gt', 5, 6, true], ['gt', 5, 5, false], ['gte', 5, 5, true], ['gte', 5, 4, false], ['lt', 5, 4, true], ['lt', 5, 5, false], ['lte', 5, 5, true], ['lte', 5, 6, false]] as const)('%s %s vs %s -> %s', (op, v, x, want) => {
    expect(m({ field: 'data.n', operator: op, value: v }, { n: x })).toBe(want);
  });
  it('gt/lt: missing, null, "" and non-numeric do not match (Loki __error__ drops them)', () => {
    const c: Condition = { field: 'data.n', operator: 'lt', value: 100 };
    expect(m(c, {})).toBe(false); expect(m(c, { n: null })).toBe(false); expect(m(c, { n: '' })).toBe(false); expect(m(c, { n: 'abc' })).toBe(false); expect(m(c, { n: 3 })).toBe(true);
  });
  it('numeric strings are compared numerically (Loki label conversion)', () => expect(m({ field: 'data.n', operator: 'gt', value: 5 }, { n: '12' })).toBe(true));
  it('nested path data.data.args', () => expect(m({ field: 'data.data.assets', operator: 'gt', value: 0 }, { data: { assets: 3 } })).toBe(true));
});

describe('match all vs any, name/kind scoping', () => {
  const rule = (match: 'all' | 'any') => ({ kind: 'event' as const, name: 'ev', match, conditions: [{ field: 'data.a', operator: 'gt' as const, value: 1 }, { field: 'data.b', operator: 'eq' as const, value: 'x' }], severity: 'info' as const, channels: [], unsupportedChannels: [] });
  it('all needs every condition; any needs one, and a missing field in one branch does not hide the other', () => {
    expect(ruleMatches(rule('all'), rec({ a: 2, b: 'x' }))).toBe(true);
    expect(ruleMatches(rule('all'), rec({ a: 2, b: 'y' }))).toBe(false);
    expect(ruleMatches(rule('any'), rec({ a: 2 }))).toBe(true);
    expect(ruleMatches(rule('any'), rec({ b: 'x' }))).toBe(true);
    expect(ruleMatches(rule('any'), rec({}))).toBe(false);
  });
  it('no conditions matches every record with that name; wrong name or kind does not', () => {
    const r = { kind: 'event' as const, name: 'ev', match: 'all' as const, conditions: [], severity: 'info' as const, channels: [], unsupportedChannels: [] };
    expect(ruleMatches(r, rec({}))).toBe(true);
    expect(ruleMatches({ ...r, name: 'other' }, rec({}))).toBe(false);
    expect(ruleMatches({ ...r, kind: 'instruction' }, rec({}))).toBe(false);
    expect(ruleMatches({ ...r, kind: 'instruction' }, rec({}, { kind: 'program_instruction' }))).toBe(true);
  });
});

describe('validation and pasted Microscope TOML', () => {
  it('rejects the same invalid combinations Microscope rejects', () => {
    expect(() => validateCondition({ field: 'a', operator: 'exists', value: 1 })).toThrow(/does not accept/);
    expect(() => validateCondition({ field: 'a', operator: 'gt' })).toThrow(/requires a value/);
    expect(() => validateCondition({ field: 'a', operator: 'contains', value: '' })).toThrow(/non-empty/);
    expect(() => validateCondition({ field: 'a', operator: 'contains', value: 5 })).toThrow(/string/);
    expect(() => validateCondition({ field: 'a', operator: 'gt', value: 'x' })).toThrow(/numeric/);
    expect(() => validateCondition({ field: 'a', operator: 'eq', value: 2 ** 54 })).toThrow(/2\^53/);
    expect(() => validateCondition({ field: 'a b', operator: 'eq', value: 1 })).toThrow(/dot-separated/);
  });
  it('parses the exact block from Microscope microscope.toml.example and the Jupiter Lend example', () => {
    const rules = parseAlertsToml(`
[[alerts]]
kind = "event"
name = "recurring_transfer_event"
match = "all"
conditions = [
  { field = "data.amount", operator = "gt", value = 0 },
  { field = "failed", operator = "eq", value = false },
]
severity = "warning"
channels = []

[[alerts]]
kind = "instruction"
name = "update_authority"
severity = "critical"
channels = ["slack", "pagerduty", "telegram"]
`);
    expect(rules).toHaveLength(2);
    expect(rules[0]!.conditions[1]).toEqual({ field: 'failed', operator: 'eq', value: false });
    expect(rules[1]!.channels).toEqual(['telegram']);
    expect(rules[1]!.unsupportedChannels).toEqual(['slack', 'pagerduty']);
    expect(rules[1]!.match).toBe('all');
  });
  it('kind defaults to event; multisig is rejected with a plain message; unknown keys rejected', () => {
    expect(parseAlertsToml('[[alerts]]\nname="x"\nseverity="info"')[0]!.kind).toBe('event');
    expect(() => parseAlertsToml('[[alerts]]\nkind="multisig"\nname="x"\nseverity="info"')).toThrow(/not supported in specula v0/);
    expect(() => parseAlertsToml('[[alerts]]\nname="x"\nseverity="info"\nbogus=1')).toThrow(/unknown field/);
  });
});
