import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import bs58 from 'bs58';
import { JL, jlIdl, jlTx, memEngine, receiver } from './util.js';
import { parseAlertsToml } from '../src/rules.js';
import { openDb } from '../src/db.js';
import { Engine } from '../src/engine.js';
import { findUpgrades, LOADER } from '../src/upgrade.js';
import { deliver, sign } from '../src/channels.js';

const RULES = parseAlertsToml(`
[[alerts]]
kind = "event"
name = "log_deposit"
conditions = [{ field = "data.assets", operator = "gt", value = 0 }, { field = "failed", operator = "eq", value = false }]
severity = "info"
channels = ["webhook"]
`);

async function setup(extra: Partial<Parameters<Engine['addProgram']>[0]> = {}, opts = {}) {
  const rx = await receiver();
  const e = memEngine(opts);
  e.addTenant('t1', { webhook: { url: rx.url + '/hook', secret: 's3cret' } });
  e.addProgram({ tenantId: 't1', programId: JL, idl: jlIdl(), rules: RULES, ...extra });
  return { e, rx };
}

describe('dedupe', () => {
  it('the same signature delivered twice produces one record set and one alert', async () => {
    const { e, rx } = await setup();
    const tx = jlTx('23JuFJJdra');
    const a = await e.processTx(tx); const b = await e.processTx(tx);
    expect(a.newRecords).toBe(3); expect(b.newRecords).toBe(0); expect(b.records).toBe(3);
    expect((e.db.prepare('SELECT COUNT(*) c FROM records').get() as any).c).toBe(3);
    expect(a.alerts).toBe(1); expect(b.alerts).toBe(0);
    expect(rx.got).toHaveLength(1);
    await rx.close();
  });
  it('a failed transaction does not trip a rule that requires failed = false', async () => {
    const { e, rx } = await setup({ rules: parseAlertsToml('[[alerts]]\nkind="instruction"\nname="deposit"\nconditions=[{ field="failed", operator="eq", value=false }]\nseverity="info"\nchannels=["webhook"]') });
    await e.processTx(jlTx('FAILED-4P6'));
    expect(rx.got).toHaveLength(0);
    expect((e.db.prepare('SELECT failed FROM records').get() as any).failed).toBe(1);
    await rx.close();
  });
  it('re-delivery after a delivery failure retries (claim released), then dedupes', async () => {
    const bad = await receiver(500);
    const e = memEngine(); e.addTenant('t1', { webhook: { url: bad.url, secret: 'x' } }); e.addProgram({ tenantId: 't1', programId: JL, idl: jlIdl(), rules: RULES });
    const r1 = await e.processTx(jlTx('23JuFJJdra')); expect(r1.alerts).toBe(0);
    await bad.close();
    const good = await receiver(); (e as any).tenants.set('t1', { webhook: { url: good.url, secret: 'x' } });
    const r2 = await e.processTx(jlTx('23JuFJJdra')); expect(r2.alerts).toBe(1); expect(good.got).toHaveLength(1);
    const r3 = await e.processTx(jlTx('23JuFJJdra')); expect(r3.alerts).toBe(0);
    await good.close();
  });
});

describe('channels', () => {
  it('generic webhook body is signed with HMAC-SHA256 over the exact body', async () => {
    const { e, rx } = await setup();
    await e.processTx(jlTx('23JuFJJdra'));
    const g = rx.got[0]!;
    expect(g.headers['x-specula-signature']).toBe('sha256=' + createHmac('sha256', 's3cret').update(g.body).digest('hex'));
    expect(g.headers['x-specula-signature']).toBe(sign(g.body, 's3cret'));
    expect(JSON.parse(g.body)).toMatchObject({ severity: 'info', kind: 'rule', program_id: JL, signature: expect.any(String) });
    // negative control: a different secret must not verify
    expect(g.headers['x-specula-signature']).not.toBe(sign(g.body, 'wrong'));
    await rx.close();
  });
  it('discord posts {content}; telegram uses the env token in the URL and never leaks it in errors', async () => {
    const rx = await receiver(200, '{"ok":true,"result":{"message_id":5}}'); const alert = { severity: 'warning' as const, title: 'T', text: 'body', tenant_id: 't', program_id: 'p', kind: 'rule' };
    await deliver('discord', { discord: { url: rx.url + '/d' } }, alert);
    expect(JSON.parse(rx.got[0]!.body).content).toContain('[WARNING] T');
    await deliver('telegram', { telegram: { chat_id: '42', api_base: rx.url } }, alert, { TELEGRAM_BOT_TOKEN: 'TESTTOKEN123' } as any);
    expect(rx.got[1]!.url).toBe('/botTESTTOKEN123/sendMessage'); expect(JSON.parse(rx.got[1]!.body).chat_id).toBe('42');
    const down = await receiver(401);
    const err = await deliver('telegram', { telegram: { chat_id: '42', api_base: down.url } }, alert, { TELEGRAM_BOT_TOKEN: 'TESTTOKEN123' } as any).catch((x) => String(x));
    expect(err).toContain('401'); expect(err).not.toContain('TESTTOKEN123');
    await expect(deliver('telegram', { telegram: { chat_id: '1' } }, alert, {} as any)).rejects.toThrow(/not set/);
    await rx.close(); await down.close();
  });
});

describe('upgrade / set-authority alert on real historical mainnet transactions', () => {
  const load = (p: string) => JSON.parse(fs.readFileSync(`fixtures/upgrade/${p}`, 'utf8'));
  const up = load('upgrade-SQDS4e-upgrade-2C8c1t74.json'); const sa = load('upgrade-SQDS4e-set_authority-2Qikw7Xm.json');

  it('programdata address is read from the program account, not hard-coded', async () => {
    const e = memEngine(); e.addTenant('t1'); e.addProgram({ tenantId: 't1', programId: up.programId, idl: jlIdl(), rules: [] });
    // program account layout: u32 tag 2 (Program) + programdata pubkey
    const data = Buffer.concat([Buffer.from([2, 0, 0, 0]), Buffer.from(bs58.decode(up.programdata))]);
    await e.resolveProgramdata({ getAccountData: async () => ({ owner: LOADER, data }) });
    expect(e.programs()[0]!.programdata).toBe(up.programdata);
    // negative control: an account not owned by the loader resolves nothing
    const e2 = memEngine(); e2.addTenant('t1'); e2.addProgram({ tenantId: 't1', programId: up.programId, idl: jlIdl(), rules: [] });
    await e2.resolveProgramdata({ getAccountData: async () => ({ owner: '11111111111111111111111111111111', data }) });
    expect(e2.programs()[0]!.programdata).toBeUndefined();
  });
  it('finds Upgrade and SetAuthority touching the programdata account; finds nothing for an unrelated programdata', () => {
    expect(findUpgrades(up.tx, up.programdata).map((x) => x.action)).toEqual(['upgrade']);
    expect(findUpgrades(sa.tx, sa.programdata).map((x) => x.action)).toEqual(['set_authority']);
    expect(findUpgrades(up.tx, '11111111111111111111111111111111')).toEqual([]);
    expect(findUpgrades(jlTx('23JuFJJdra'), up.programdata)).toEqual([]);
  });
  it('fires a critical alert through the engine, once, with the authority change in the text', async () => {
    const rx = await receiver();
    const e = memEngine(); e.addTenant('t1', { webhook: { url: rx.url, secret: 'k' } });
    e.addProgram({ tenantId: 't1', programId: up.programId, idl: jlIdl(), rules: [], programdata: up.programdata });
    const r1 = await e.processTx(up.tx); await e.processTx(up.tx);
    await e.processTx(sa.tx);
    expect(r1.alerts).toBe(1);
    expect(rx.got).toHaveLength(2);
    const a = JSON.parse(rx.got[0]!.body); expect(a).toMatchObject({ severity: 'critical', kind: 'upgrade' }); expect(a.title).toContain('program upgrade');
    const b = JSON.parse(rx.got[1]!.body); expect(b.title).toContain('authority change'); expect(b.text).toContain('->');
    await rx.close();
  });
  it('can be switched off per program', async () => {
    const rx = await receiver(); const e = memEngine(); e.addTenant('t1', { webhook: { url: rx.url, secret: 'k' } });
    e.addProgram({ tenantId: 't1', programId: up.programId, idl: jlIdl(), rules: [], programdata: up.programdata, upgradeAlerts: false });
    await e.processTx(up.tx); expect(rx.got).toHaveLength(0); await rx.close();
  });
});

describe('silence and pipeline health with a fake clock', () => {
  const H = 3600_000;
  async function clocked(silenceHours = 2) {
    const rx = await receiver(); let t = 1_800_000_000_000;
    const e = new Engine(openDb(':memory:'), { now: () => t, stallSeconds: 600 });
    e.addTenant('t1', { webhook: { url: rx.url, secret: 'k' } });
    e.addProgram({ tenantId: 't1', programId: JL, idl: jlIdl(), rules: [], silenceHours });
    const beat = () => e.db.prepare('INSERT OR REPLACE INTO checkpoints (program_id, last_signature, last_slot, updated_at) VALUES (?,?,?,?)').run(JL, 'x', 1, t);
    return { e, rx, advance: (ms: number) => { t += ms; }, beat, now: () => t };
  }
  it('no alert inside the window; one silence alert after N hours; no repeat; a new record resets the episode', async () => {
    const { e, rx, advance, beat, now } = await clocked(2);
    beat(); advance(1 * H); beat();
    expect(await e.checkHealth()).toEqual({ silence: 0, pipeline: 0 });
    advance(1.5 * H); beat();
    expect(await e.checkHealth()).toEqual({ silence: 1, pipeline: 0 });
    advance(10 * 60_000); beat();
    expect(await e.checkHealth()).toEqual({ silence: 0, pipeline: 0 }); // deduped, same episode
    expect(rx.got).toHaveLength(1); expect(JSON.parse(rx.got[0]!.body).kind).toBe('silence');
    // activity arrives: a record with block_time = now resets the clock
    e.db.prepare("INSERT INTO records VALUES (?,?,?,?,?,?,?,?,?,?)").run(JL, 'sig', '0', 'program_instruction', 'deposit', 0, 1, Math.floor(now() / 1000), '{}', now());
    advance(1.9 * H); beat();
    expect((await e.checkHealth()).silence).toBe(0);
    advance(0.3 * H); beat();
    expect((await e.checkHealth()).silence).toBe(1); // a second, distinct episode
    expect(rx.got).toHaveLength(2);
    await rx.close();
  });
  it('a stalled ingest raises one pipeline alert and suppresses silence (silence never hides a broken pipe)', async () => {
    const { e, rx, advance, beat } = await clocked(2);
    beat();
    advance(3 * H); // no heartbeat for 3h: both conditions true
    const r = await e.checkHealth();
    expect(r).toEqual({ silence: 0, pipeline: 1 });
    expect(JSON.parse(rx.got[0]!.body)).toMatchObject({ kind: 'pipeline', severity: 'critical' });
    advance(60_000); expect(await e.checkHealth()).toEqual({ silence: 0, pipeline: 0 }); // same episode, deduped
    expect(rx.got).toHaveLength(1);
    // recovery: heartbeat resumes, silence now correctly reported
    beat(); expect((await e.checkHealth()).silence).toBe(1);
    await rx.close();
  });
  it('negative control: a healthy heartbeat just under the threshold raises no pipeline alert', async () => {
    const { e, rx, advance, beat } = await clocked(0 as any);
    beat(); advance(599_000); expect((await e.checkHealth()).pipeline).toBe(0); advance(2_000); expect((await e.checkHealth()).pipeline).toBe(1);
    await rx.close();
  });
});
