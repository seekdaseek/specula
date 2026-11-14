import fs from 'node:fs';
import http from 'node:http';
import { describe, it, expect } from 'vitest';
import { renderLanding, buildPages, BOT_URL } from '../src/landing.js';
import { parsePlans } from '../src/plans.js';
import { webhookServer } from '../src/ingest.js';
import { loadServiceConfig } from '../src/daemon.js';
import { memEngine } from './util.js';

const cfg = loadServiceConfig('deploy/service.example.toml', { OWNER_CHAT_ID: '1' } as any).plans;

describe('landing page', () => {
  const html = renderLanding(cfg);
  it('is small, has the one button, meta and OG tags, a favicon link and the Microscope credit', () => {
    expect(Buffer.byteLength(html)).toBeLessThan(50 * 1024);
    expect(html).toContain(`href="${BOT_URL}"`); expect(BOT_URL).toBe('https://t.me/speculaDaBot');
    for (const t of ['<meta name="viewport"', '<meta name="description"', 'property="og:title"', 'property="og:image"', 'name="twitter:card"', 'rel="icon"', 'rel="canonical"']) expect(html).toContain(t);
    expect(html).toContain('solana-foundation/solana-microscope'); expect(html).toMatch(/MIT licen[cs]e/);
    expect(html).not.toMatch(/<script|<img |https?:\/\/(?!t\.me|specula\.ochinimus\.app|github\.com\/solana-foundation)/);   // no JS, no third-party loads
  });
  it('prices, limits and trial come from the config; the hidden proof plan and the config-less numbers are not invented', () => {
    for (const p of Object.values(cfg.plans).filter((x) => !x.hidden)) { expect(html).toContain(`<th scope="row">${p.name}</th><td>$${p.priceUsd}</td><td>${p.txPerMonth.toLocaleString('en-US')}</td><td>${p.maxPrograms}</td>`); }
    expect(html).not.toContain('Proof'); expect(html).toContain('14-day free trial'); expect(html).toContain('USDC');
    const other = parsePlans({ trial: { days: 7, plan: 'x', max_programs: 2 }, plans: { x: { name: 'Tiny', price_usd: 5, tx_per_month: 50, max_programs: 2 } } });
    const h2 = renderLanding(other); expect(h2).toContain('<td>$5</td><td>50</td><td>2</td>'); expect(h2).toContain('7-day free trial'.replace('7-day free trial', '7 days')); expect(h2).not.toContain('$149');
  });
  it('shows only measured claims', () => { for (const c of ['0 differences', 'p50 1.2 s', 'p95 1.8 s', '7 of 7', '270 transactions']) expect(html).toContain(c); });
  it('contains no email address, no personal name, no phone and no server IP', () => {
    expect(html).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/); expect(html).not.toMatch(new RegExp(['Ser'+'giu', 'Ser'+'ghei', 'Ochi'+'nca', 'gmail', 'proton', '\\b\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\b', '\\+\\d{8,}'].join('|'), 'i'));
  });
});

describe('static pages next to the webhook endpoint', () => {
  const get = (port: number, method: string, path: string, headers: Record<string, string> = {}) => new Promise<{ status: number; type?: string; body: string; headers: http.IncomingHttpHeaders }>((resolve) => { const r = http.request({ port, path, method, headers }, (res) => { const c: Buffer[] = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ status: res.statusCode!, type: res.headers['content-type'], body: Buffer.concat(c).toString(), headers: res.headers })); }); r.end(method === 'POST' ? '[]' : undefined); });
  it('GET / 200 html, favicon and og.png served, /health unchanged, everything else 404, webhook still needs its token', async () => {
    const srv = webhookServer(memEngine(), { authToken: 'tok', port: 0, path: '/webhook/helius', pages: buildPages(cfg, 'public'), health: () => ({ n: 1 }) });
    await new Promise((r) => srv.on('listening', r)); const port = (srv.address() as any).port;
    const root = await get(port, 'GET', '/'); expect(root.status).toBe(200); expect(root.type).toContain('text/html'); expect(root.body).toContain('Start in Telegram'); expect(root.headers['x-content-type-options']).toBe('nosniff');
    expect((await get(port, 'HEAD', '/')).status).toBe(200); expect((await get(port, 'HEAD', '/')).body).toBe('');
    expect((await get(port, 'GET', '/favicon.svg')).type).toBe('image/svg+xml'); expect((await get(port, 'GET', '/og.png')).type).toBe('image/png');
    expect((await get(port, 'GET', '/health')).body).toBe('{"ok":true,"n":1}');
    for (const p of ['/admin', '/index.html', '/webhook', '/webhook/helius', '/.env', '/../package.json', '/%2e%2e/etc/passwd', '/?x=1']) expect((await get(port, 'GET', p)).status).toBe(404);
    expect((await get(port, 'POST', '/')).status).toBe(404);
    expect((await get(port, 'POST', '/webhook/helius')).status).toBe(401); expect((await get(port, 'POST', '/webhook/helius', { authorization: 'tok' })).status).toBe(200);
    srv.close();
  });
  it('the shipped assets exist and are small', () => { expect(fs.statSync('public/og.png').size).toBeLessThan(60_000); expect(fs.statSync('public/favicon.svg').size).toBeLessThan(2000); });
});

describe('feed endpoint (upgrade-feed test)', () => {
  it('has its own token, records what it is given, and never touches the main webhook path', async () => {
    const got: string[] = [];
    const srv = webhookServer(memEngine(), { authToken: 'main', port: 0, path: '/webhook/helius', feed: { path: '/webhook/helius-feed', authToken: 'feed-token', onBody: (b) => got.push(b) } });
    await new Promise((r) => srv.on('listening', r)); const port = (srv.address() as any).port;
    const post = (path: string, auth?: string, body = '[{"signature":"S","type":"UPGRADE_PROGRAM_INSTRUCTION"}]') => new Promise<number>((resolve) => { const r = http.request({ port, path, method: 'POST', headers: auth ? { authorization: auth } : {} }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode!)); }); r.end(body); });
    expect(await post('/webhook/helius-feed')).toBe(401); expect(await post('/webhook/helius-feed', 'main')).toBe(401);   // the main token does not open the feed
    expect(await post('/webhook/helius', 'feed-token')).toBe(401);                                                     // and the feed token does not open the main path
    expect(got.length).toBe(0);
    expect(await post('/webhook/helius-feed', 'feed-token')).toBe(200); expect(got.length).toBe(1);
    expect(await post('/webhook/helius-feed', 'feed-token', 'not json')).toBe(200);   // the endpoint only hands the body to onBody; parsing errors are the callback's
    srv.close();
  });
});
