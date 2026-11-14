import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { decodeIdlAccount, idlAddress, inspectIdl } from '../src/idl-fetch.js';
import { Bot } from '../src/bot.js';
import { openDb } from '../src/db.js';
import { Engine } from '../src/engine.js';
import { Service } from '../src/service.js';
import { parsePlans } from '../src/plans.js';
import { fetchOnchainIdl } from '../src/idl-fetch.js';

// Raw bytes of the real Squads v4 IDL account (owner = the program), saved from mainnet on 14 Nov 2026. Pre-0.30 format with unresolvable generic types.
const fx = JSON.parse(fs.readFileSync('fixtures/onchain-idl/squads-v4.account.json', 'utf8'));
const data = Buffer.from(fx.dataBase64, 'base64');

describe('on-chain Squads v4 IDL (pre-0.30 format)', () => {
  it('the account address is the Anchor IDL PDA and the bytes decode to the legacy IDL', async () => {
    expect(await idlAddress(fx.programId)).toBe(fx.idlAddress);
    const idl = decodeIdlAccount(data); expect(idl.version).toBe('2.0.0'); expect(idl.metadata).toBeUndefined();
  });
  it('inspectIdl accepts it for its program id and lists instructions (it failed with "Type not found: accountKeys" before)', () => {
    const info = inspectIdl(decodeIdlAccount(data), fx.programId);
    expect(info.kind).toBe('anchor'); expect(info.instructions).toContain('proposal_approve'); expect(info.instructions).toContain('multisig_create_v2');
  });
  it('fetchOnchainIdl over a fake RPC returns it, and /watch activates the program with it', async () => {
    const rpc = { getAccountData: async (a: string) => (a === fx.idlAddress ? { owner: fx.programId, data } : null), account: async () => ({ executable: true, owner: 'x' }) };
    expect((await fetchOnchainIdl(rpc, fx.programId)).name).toBeDefined();
    const db = openDb(':memory:'); const eng = new Engine(db, {});
    const svc = new Service(db, eng, parsePlans({ plans: { starter: { tx_per_month: 10, max_programs: 3 } }, trial: { plan: 'starter', days: 14, max_programs: 3 } }));
    const sent: string[] = [];
    const bot = new Bot(svc, { rpc: rpc as any, tg: { sendMessage: async (_c, t) => { sent.push(t); return 1; }, getFile: async () => null, download: async () => Buffer.alloc(0) } });
    await bot.handleUpdate({ update_id: 1, message: { chat: { id: 5, type: 'private' }, from: { id: 5 }, text: `/watch ${fx.programId}` } });
    expect(eng.getEntry('tg:5', fx.programId)).toBeDefined(); expect(sent.at(-1)).toContain('Watching');
  });
  it('real Squads v4 transactions decode identically with the on-chain IDL and with Microscope\'s legacy IDL file', async () => {
    const { AnchorDecoder } = await import('../src/decode.js'); const { convertLegacyIdl } = await import('../src/idl-legacy.js'); const { toJson } = await import('../src/shape.js');
    const A = new AnchorDecoder(fx.programId, convertLegacyIdl(decodeIdlAccount(data), fx.programId));
    const B = new AnchorDecoder(fx.programId, convertLegacyIdl(JSON.parse(fs.readFileSync('fixtures/idl/squads-v4-legacy.json', 'utf8')), fx.programId));
    let n = 0;
    for (const f of fs.readdirSync('fixtures/squads-v4')) { const tx = JSON.parse(fs.readFileSync(`fixtures/squads-v4/${f}`, 'utf8')); const a = A.decodeTx(tx); n += a.length; expect(toJson(a)).toBe(toJson(B.decodeTx(tx))); }
    expect(n).toBeGreaterThan(0);
  });
});
