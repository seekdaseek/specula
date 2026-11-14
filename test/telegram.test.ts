import { describe, it, expect } from 'vitest';
import { deliver } from '../src/channels.js';
import { receiver } from './util.js';

const alert = { severity: 'warning' as const, title: 'T', text: 'body', tenant_id: 't', program_id: 'p', kind: 'rule' };
const env = { TELEGRAM_BOT_TOKEN: 'TESTTOKEN123' } as any;
const ok = { status: 200, body: JSON.stringify({ ok: true, result: { message_id: 77 } }) };
const limited = (s: number) => ({ status: 429, body: JSON.stringify({ ok: false, error_code: 429, description: 'Too Many Requests: retry after ' + s, parameters: { retry_after: s } }) });

describe('telegram delivery', () => {
  it('returns the message id from the Bot API response body', async () => {
    const rx = await receiver(200, JSON.stringify(ok.body && JSON.parse(ok.body)));
    const r = await deliver('telegram', { telegram: { chat_id: '42', api_base: rx.url } }, alert, env);
    expect(r).toEqual({ message_id: 77 }); await rx.close();
  });
  it('429: waits parameters.retry_after seconds, retries, then delivers (one wait of 2000 ms, two requests)', async () => {
    const rx = await receiver(200, (n) => (n === 0 ? limited(2) : ok)); const waits: number[] = [];
    const r = await deliver('telegram', { telegram: { chat_id: '42', api_base: rx.url } }, alert, env, fetch, async (ms) => { waits.push(ms); });
    expect(waits).toEqual([2000]); expect(rx.got.length).toBe(2); expect(r).toEqual({ message_id: 77 }); await rx.close();
  });
  it('429 forever: gives up after 3 retries, error carries status but not the token', async () => {
    const rx = await receiver(200, () => limited(1)); const waits: number[] = [];
    const err = await deliver('telegram', { telegram: { chat_id: '42', api_base: rx.url } }, alert, env, fetch, async (ms) => { waits.push(ms); }).catch((e) => String(e));
    expect(rx.got.length).toBe(4); expect(waits.length).toBe(3); expect(err).toContain('429'); expect(err).not.toContain('TESTTOKEN123'); await rx.close();
  });
  it('retry_after is capped at 60 s', async () => {
    const rx = await receiver(200, (n) => (n === 0 ? limited(3600) : ok)); const waits: number[] = [];
    await deliver('telegram', { telegram: { chat_id: '1', api_base: rx.url } }, alert, env, fetch, async (ms) => { waits.push(ms); });
    expect(waits).toEqual([60000]); await rx.close();
  });
  it('a 400 (bad chat id) is not retried and surfaces the API description', async () => {
    const rx = await receiver(200, () => ({ status: 400, body: JSON.stringify({ ok: false, error_code: 400, description: 'Bad Request: chat not found' }) }));
    const err = await deliver('telegram', { telegram: { chat_id: 'x', api_base: rx.url } }, alert, env).catch((e) => String(e));
    expect(rx.got.length).toBe(1); expect(err).toContain('chat not found'); await rx.close();
  });
  it('HTTP 200 with ok:false is an error (not a delivery)', async () => {
    const rx = await receiver(200, JSON.stringify({ ok: false, description: 'nope' }));
    await expect(deliver('telegram', { telegram: { chat_id: '1', api_base: rx.url } }, alert, env)).rejects.toThrow(/telegram responded 200/); await rx.close();
  });
});
