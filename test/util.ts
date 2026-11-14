import fs from 'node:fs';
import http from 'node:http';
import { openDb } from '../src/db.js';
import { Engine } from '../src/engine.js';
import type { RawTx } from '../src/types.js';

export const JL = 'jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9';
export const jlIdl = () => JSON.parse(fs.readFileSync('fixtures/idl/jupiter-lend-lending.json', 'utf8'));
export const jlTx = (prefix: string): RawTx => { const f = fs.readdirSync('fixtures/jupiter-lend').find((x) => x.startsWith(prefix))!; return JSON.parse(fs.readFileSync(`fixtures/jupiter-lend/${f}`, 'utf8')); };
export const jlAll = () => fs.readdirSync('fixtures/jupiter-lend').map((f) => JSON.parse(fs.readFileSync(`fixtures/jupiter-lend/${f}`, 'utf8')) as RawTx);

export interface Received { url: string; headers: http.IncomingHttpHeaders; body: string }
export async function receiver(status = 200, respond: string | ((n: number) => { status: number; body: string; headers?: Record<string, string> }) = '{}'): Promise<{ url: string; got: Received[]; close(): Promise<void> }> {
  const got: Received[] = [];
  const srv = http.createServer((req, res) => { const c: Buffer[] = []; req.on('data', (d) => c.push(d)); req.on('end', () => { got.push({ url: req.url!, headers: req.headers, body: Buffer.concat(c).toString() }); if (typeof respond === 'function') { const r = respond(got.length - 1); res.writeHead(r.status, { 'content-type': 'application/json', ...(r.headers ?? {}) }).end(r.body); } else res.writeHead(status).end(respond); }); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as any).port;
  return { url: `http://127.0.0.1:${port}`, got, close: () => new Promise((r) => srv.close(() => r())) };
}
export function memEngine(opts: ConstructorParameters<typeof Engine>[1] = {}) { return new Engine(openDb(':memory:'), opts); }
