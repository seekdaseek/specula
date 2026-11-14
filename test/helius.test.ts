import fs from 'node:fs';
import http from 'node:http';
import { describe, it, expect } from 'vitest';
import { memEngine, JL, jlIdl } from './util.js';
import { AnchorDecoder } from '../src/decode.js';
import { normalizeWebhookTx, webhookServer } from '../src/ingest.js';
import { toJson } from '../src/shape.js';
import type { RawTx } from '../src/types.js';

// Raw bodies exactly as Helius delivered them (raw webhook, 14 Nov 2026), plus getTransaction for the same signature.
const SQ4 = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';
const tags = ['failed', 'event', 'squads'] as const;
const body = (t: string) => fs.readFileSync(`fixtures/helius/webhook-${t}.json`, 'utf8');
const poll = (t: string) => JSON.parse(fs.readFileSync(`fixtures/helius/poll-${t}.json`, 'utf8')) as RawTx;
const sqIdl = () => JSON.parse(fs.readFileSync('fixtures/idl/squads-v4-legacy.json', 'utf8'));
const decoders = () => [new AnchorDecoder(JL, jlIdl()), new AnchorDecoder(SQ4, (() => { const e = memEngine(); e.addTenant('x'); e.addProgram({ tenantId: 'x', programId: SQ4, idl: sqIdl(), rules: [] }); return (e.programs()[0] as any).decoder.idl; })())];

describe('real Helius raw webhook payloads', () => {
  it('a delivery is a JSON array of getTransaction-shaped transactions, account keys as plain strings', () => {
    for (const t of tags) {
      const arr = JSON.parse(body(t)); expect(Array.isArray(arr)).toBe(true); expect(arr.length).toBeGreaterThan(0);
      const tx = normalizeWebhookTx(arr[0]); expect(tx).not.toBeNull();
      expect(typeof tx!.transaction.message.accountKeys[0]).toBe('string'); expect(typeof tx!.slot).toBe('number'); expect(typeof tx!.blockTime).toBe('number');
    }
  });
  it('webhook and getTransaction decode to identical records (same signature, both feeds)', () => {
    for (const t of tags) {
      const w = normalizeWebhookTx(JSON.parse(body(t))[0])!, p = poll(t);
      expect(w.transaction.signatures[0]).toBe(p.transaction.signatures[0]);
      for (const d of decoders()) expect(toJson(d.decodeTx(w))).toBe(toJson(d.decodeTx(p)));
    }
    const n = decoders().reduce((a, d) => a + d.decodeTx(normalizeWebhookTx(JSON.parse(body('event'))[0])!).length, 0);
    expect(n).toBeGreaterThan(0); // the comparison saw something: not an empty-equals-empty pass
  });
  it('FAILED transactions are delivered by the webhook and recorded with failed = true', () => {
    const w = normalizeWebhookTx(JSON.parse(body('failed'))[0])!;
    expect(w.meta!.err).not.toBeNull();
    const recs = decoders().flatMap((d) => d.decodeTx(w));
    expect(recs.length).toBeGreaterThan(0); expect(recs.every((r) => r.failed)).toBe(true);
  });
  it('the event fixture yields an instruction and an event record', () => {
    const recs = decoders().flatMap((d) => d.decodeTx(normalizeWebhookTx(JSON.parse(body('event'))[0])!));
    expect(recs.some((r) => r.kind === 'program_instruction')).toBe(true); expect(recs.some((r) => r.kind === 'program_event')).toBe(true);
  });
  it('end to end: bearer token required, records stored, re-delivery is a no-op, observation source is webhook', async () => {
    const e = memEngine(); e.addTenant('t'); e.addProgram({ tenantId: 't', programId: JL, idl: jlIdl(), rules: [], upgradeAlerts: false }); e.addProgram({ tenantId: 't', programId: SQ4, idl: sqIdl(), rules: [], upgradeAlerts: false });
    const raws: string[] = [];
    const srv = webhookServer(e, { authToken: 'tok-123', port: 0, path: '/hook', onRaw: (b) => raws.push(b) });
    await new Promise((r) => srv.on('listening', r)); const port = (srv.address() as any).port;
    const post = (auth: string | null, b: string) => new Promise<number>((resolve) => { const r = http.request({ port, path: '/hook', method: 'POST', headers: auth === null ? {} : { authorization: auth } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode!)); }); r.end(b); });
    expect(await post(null, body('event'))).toBe(401);
    expect(await post('wrong', body('event'))).toBe(401);
    expect(e.db.prepare('SELECT COUNT(*) n FROM records').get()).toEqual({ n: 0 });
    for (const t of tags) expect(await post('tok-123', body(t))).toBe(200);
    const n1 = (e.db.prepare('SELECT COUNT(*) n FROM records').get() as any).n; expect(n1).toBeGreaterThan(0);
    expect(await post('tok-123', body('event'))).toBe(200); // re-delivery
    expect((e.db.prepare('SELECT COUNT(*) n FROM records').get() as any).n).toBe(n1);
    expect(e.db.prepare("SELECT DISTINCT source s FROM observations").all()).toEqual([{ s: 'webhook' }]);
    expect((e.db.prepare('SELECT COUNT(*) n FROM observations WHERE failed=1').get() as any).n).toBe(1);
    expect(raws.length).toBe(4); // 3 deliveries + 1 re-delivery; the two 401s never reach the handler expect(await post('tok-123', 'not json')).toBe(400);
    srv.close();
  });
});
