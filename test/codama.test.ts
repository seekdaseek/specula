import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import bs58 from 'bs58';
import { CodamaDecoder } from '../src/decode-codama.js';
import { memEngine } from './util.js';
import type { RawTx } from '../src/types.js';

const root = JSON.parse(fs.readFileSync('fixtures/idl/codama-subscriptions.json', 'utf8'));
const PID: string = root.program.publicKey;
const dir = 'fixtures/codama-subscriptions';
const txs = fs.readdirSync(dir).map((f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8')) as RawTx);
const dec = new CodamaDecoder(PID, root);

function rawIxs(tx: RawTx) { // independent reader: top-level + inner instructions addressed to PID, raw bytes
  const keys = [...tx.transaction.message.accountKeys, ...(tx.meta?.loadedAddresses?.writable ?? []), ...(tx.meta?.loadedAddresses?.readonly ?? [])];
  const all = [...tx.transaction.message.instructions, ...(tx.meta?.innerInstructions ?? []).flatMap((g) => g.instructions)];
  return all.filter((i) => keys[i.programIdIndex] === PID).map((i) => Buffer.from(bs58.decode(i.data)));
}

describe('Codama rootNode IDL (idl/idl1.json, real mainnet txs of De1eg...)', () => {
  it('fixtures exist and are real (3 transactions, program is in the account keys)', () => { expect(txs.length).toBe(3); for (const t of txs) expect(rawIxs(t).length).toBeGreaterThan(0); });
  for (const [n, tx] of txs.entries()) {
    it(`tx ${n}: instruction and event fields match an independent byte reader`, () => {
      const recs = dec.decodeTx(tx);
      const ix = recs.find((r) => r.kind === 'program_instruction')!, ev = recs.find((r) => r.kind === 'program_event')!;
      expect(ix.name).toBe('transfer_recurring');
      expect(ev.name).toBe('recurring_transfer_event');
      const rawIx = rawIxs(tx).find((b) => b[0] === 5)!;                         // u8 discriminator 5 = transferRecurring
      const rawEv = rawIxs(tx).find((b) => b.subarray(0, 8).equals(Buffer.from('e445a52e51cb9a1d', 'hex')))!;
      const args = (ix.data as any).data.transfer_data;
      expect(args.amount).toBe(Number(rawIx.readBigUInt64LE(1)));
      expect(args.delegator).toBe(bs58.encode(rawIx.subarray(9, 41)));
      expect(args.mint).toBe(bs58.encode(rawIx.subarray(41, 73)));
      const e = ev.data as any;                                                  // prefix(8) tag(1) delegation delegator delegatee mint amount ...
      expect(e.delegation).toBe(bs58.encode(rawEv.subarray(9, 41)));
      expect(e.mint).toBe(bs58.encode(rawEv.subarray(105, 137)));
      expect(e.amount).toBe(Number(rawEv.readBigUInt64LE(137)));
      expect(e.amount).toBe(args.amount);                                        // the program's own event agrees with the instruction
      expect(ev.source).toBe('cpi');
    });
  }
  it('the engine accepts the Codama IDL and stores the records (idl_kind codama, auto-detected)', async () => {
    const eng = memEngine(); eng.addTenant('t', {});
    eng.addProgram({ tenantId: 't', programId: PID, idl: root, rules: [] });
    expect((eng.db.prepare('SELECT idl_kind k FROM programs').get() as any).k).toBe('codama');
    await eng.processTx(txs[0]!);
    expect((eng.db.prepare('SELECT COUNT(*) n FROM records').get() as any).n).toBe(2);
  });
  it('negative control: flipping a byte of the amount changes the decoded amount', () => {
    const tx: RawTx = JSON.parse(JSON.stringify(txs[0]));
    const keys = tx.transaction.message.accountKeys;
    const all = [...tx.transaction.message.instructions, ...(tx.meta!.innerInstructions ?? []).flatMap((g) => g.instructions)];
    const ix = all.find((i) => keys[i.programIdIndex] === PID && bs58.decode(i.data)[0] === 5)!;
    const b = Buffer.from(bs58.decode(ix.data)); b[1] ^= 0xff; ix.data = bs58.encode(b);
    const orig = (dec.decodeTx(txs[0]!).find((r) => r.kind === 'program_instruction')!.data as any).data.transfer_data.amount;
    const mut = (dec.decodeTx(tx).find((r) => r.kind === 'program_instruction')!.data as any).data.transfer_data.amount;
    expect(mut).not.toBe(orig);
  });
});
