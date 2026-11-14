import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { AnchorDecoder } from '../src/decode.js';
import { convertLegacyIdl, isLegacyIdl } from '../src/idl-legacy.js';
import { Engine } from '../src/engine.js';
import { openDb } from '../src/db.js';

const SQ4 = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';
const legacy = JSON.parse(fs.readFileSync('fixtures/idl/squads-v4-legacy.json', 'utf8'));
const txs = fs.readdirSync('fixtures/squads-v4').map((f) => JSON.parse(fs.readFileSync(`fixtures/squads-v4/${f}`, 'utf8')));

describe('pre-0.30 Anchor IDLs (Squads v4) via runtime conversion', () => {
  it('is detected as legacy and the engine accepts it directly', () => {
    expect(isLegacyIdl(legacy)).toBe(true);
    const e = new Engine(openDb(':memory:')); e.addTenant('t'); e.addProgram({ tenantId: 't', programId: SQ4, idl: legacy, rules: [] });
    expect(e.programs()).toHaveLength(1);
  });
  it('real mainnet Squads v4 transactions decode to snake_case names whose discriminator matches sha256("global:<name>") computed here', () => {
    const d = new AnchorDecoder(SQ4, convertLegacyIdl(legacy, SQ4));
    let n = 0;
    for (const tx of txs) {
      const keys = tx.transaction.message.accountKeys;
      const recs = d.decodeTx(tx).filter((r: any) => r.kind === 'program_instruction');
      tx.transaction.message.instructions.forEach((ix: any, i: number) => {
        if (keys[ix.programIdIndex] !== SQ4) return;
        const disc = Buffer.from(bs58.decode(ix.data)).subarray(0, 8);
        const rec = recs.find((r: any) => r.instruction_path === String(i));
        expect(rec, `tx ${tx.transaction.signatures[0]} ix ${i}`).toBeTruthy();
        expect(createHash('sha256').update('global:' + rec!.name).digest().subarray(0, 8).equals(disc)).toBe(true);
        expect(rec!.name).toMatch(/^[a-z][a-z0-9_]*$/);
        n++;
      });
    }
    expect(n).toBeGreaterThanOrEqual(5);
  });
  it('negative control: tampering with a discriminator byte stops the decode', () => {
    const d = new AnchorDecoder(SQ4, convertLegacyIdl(legacy, SQ4));
    const tx = JSON.parse(JSON.stringify(txs[0]));
    const keys = tx.transaction.message.accountKeys;
    const ix = tx.transaction.message.instructions.find((x: any) => keys[x.programIdIndex] === SQ4);
    const b = Buffer.from(bs58.decode(ix.data)); b[0] ^= 0xff; ix.data = bs58.encode(b);
    const names = d.decodeTx(txs[0]).length; const tampered = d.decodeTx(tx).length;
    expect(tampered).toBeLessThan(names);
  });
});
