import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { AnchorDecoder } from '../src/decode.js';
import { snake } from '../src/snake.js';
import bs58 from 'bs58';
import { JL, jlAll, jlIdl, jlTx } from './util.js';

const idl = jlIdl();
const dec = new AnchorDecoder(JL, idl);
const u64 = (b: Buffer, o: number) => Number(b.readBigUInt64LE(o));

describe('golden: Jupiter Lend mainnet fixtures vs the IDL, checked by an independent byte reader', () => {
  const all = jlAll().map((tx) => ({ tx, recs: dec.decodeTx(tx) }));

  it('has >= 5 real transactions, >= 3 distinct instructions and >= 1 event', () => {
    expect(all.length).toBeGreaterThanOrEqual(5);
    const ixNames = new Set(all.flatMap((a) => a.recs.filter((r) => r.kind === 'program_instruction').map((r) => r.name)));
    const evNames = new Set(all.flatMap((a) => a.recs.filter((r) => r.kind === 'program_event').map((r) => r.name)));
    expect([...ixNames].sort()).toEqual(['deposit', 'redeem', 'update_rate', 'withdraw']);
    expect([...evNames].sort()).toEqual(['log_deposit', 'log_update_rates', 'log_withdraw']);
  });

  it('every instruction name equals the IDL name found by raw discriminator match (not via anchor)', () => {
    let checked = 0;
    for (const { tx, recs } of all) {
      const keys = [...tx.transaction.message.accountKeys, ...(tx.meta!.loadedAddresses?.writable ?? []), ...(tx.meta!.loadedAddresses?.readonly ?? [])];
      const flat: { path: string; programIdIndex: number; data: string }[] = [];
      tx.transaction.message.instructions.forEach((ix, i) => { flat.push({ path: String(i), ...ix }); tx.meta!.innerInstructions!.find((g) => g.index === i)?.instructions.forEach((c, k) => flat.push({ path: `${i}.${k}`, ...c })); });
      for (const ix of flat) {
        if (keys[ix.programIdIndex] !== JL) continue;
        const d = Buffer.from(bs58.decode(ix.data));
        const def = idl.instructions.find((x: any) => Buffer.from(x.discriminator).equals(d.subarray(0, 8)));
        const rec = recs.find((r) => r.kind === 'program_instruction' && r.instruction_path === ix.path);
        expect(def, `no IDL instruction for discriminator at ${ix.path}`).toBeTruthy();
        expect(rec!.name).toBe(snake(def.name));
        checked++;
      }
    }
    expect(checked).toBe(8);
  });

  it('deposit: assets arg and every account equal the raw bytes / account list', () => {
    const tx = jlTx('23JuFJJdra'); const rec = dec.decodeTx(tx).find((r) => r.name === 'deposit')!;
    const ix = tx.transaction.message.instructions[2]!;
    const raw = Buffer.from(bs58.decode(ix.data));
    expect((rec.data as any).data.assets).toBe(u64(raw, 8));
    expect(Object.values((rec.data as any).accounts)).toEqual(ix.accounts.map((a) => tx.transaction.message.accountKeys[a]));
    expect(Object.keys((rec.data as any).accounts).slice(0, 3)).toEqual(['signer', 'depositor_token_account', 'recipient_token_account']);
    expect(rec.failed).toBe(false);
  });

  it('log_deposit event: sender, receiver, assets, shares_minted equal the raw Program data bytes', () => {
    const tx = jlTx('23JuFJJdra'); const ev = dec.decodeTx(tx).find((r) => r.name === 'log_deposit')!;
    const line = tx.meta!.logMessages!.map((l) => (l.startsWith('Program data: ') ? Buffer.from(l.slice(14), 'base64') : null)).filter(Boolean)
      .find((b) => b!.subarray(0, 8).equals(Buffer.from(idl.events.find((e: any) => e.name === 'LogDeposit').discriminator)))!;
    expect((ev.data as any).sender).toBe(bs58.encode(line.subarray(8, 40)));
    expect((ev.data as any).receiver).toBe(bs58.encode(line.subarray(40, 72)));
    expect((ev.data as any).assets).toBe(u64(line, 72));
    expect((ev.data as any).shares_minted).toBe(u64(line, 80));
    expect(ev.source).toBe('log');
  });

  it('inner (CPI) instruction paths are recorded, e.g. deposit invoked by another program', () => {
    const recs = dec.decodeTx(jlTx('4HShv8bU6q'));
    expect(recs.find((r) => r.kind === 'program_instruction')!.instruction_path).toBe('7.9');
  });

  it('two events in one tx get distinct keys; update_rate + withdraw in one tx', () => {
    const recs = dec.decodeTx(jlTx('5v8qdh11WX'));
    expect(recs.filter((r) => r.kind === 'program_instruction').map((r) => r.name)).toEqual(['update_rate', 'withdraw']);
    const keys = recs.map((r) => r.ix_key); expect(new Set(keys).size).toBe(keys.length);
  });

  it('failed transactions are recorded with failed = true (and no events)', () => {
    const tx = jlTx('FAILED-4P6'); expect(tx.meta!.err).toBeTruthy();
    const recs = dec.decodeTx(tx);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every((r) => r.failed === true)).toBe(true);
    expect(recs[0]!.name).toBe('deposit');
  });

  it('negative control: a transaction that never touches the program decodes to nothing', () => {
    const tx = jlTx('23JuFJJdra'); const swap = (k: string) => (k === JL ? '11111111111111111111111111111111' : k);
    tx.transaction.message.accountKeys = tx.transaction.message.accountKeys.map(swap);
    tx.meta!.logMessages = tx.meta!.logMessages!.map((l) => l.split(JL).join('11111111111111111111111111111111'));
    expect(dec.decodeTx(tx)).toEqual([]);
  });
});

describe('snake_case matches heck for names Microscope would produce', () => {
  it.each([['LogDeposit', 'log_deposit'], ['updateAuthority', 'update_authority'], ['deposit_with_min_amount_out', 'deposit_with_min_amount_out'], ['ProposalActivate', 'proposal_activate'], ['XMLHttp', 'xml_http'], ['setRewardsRateModel', 'set_rewards_rate_model']])('%s', (a, b) => expect(snake(a)).toBe(b));
  it('IDL event/instruction names all come out snake_case', () => {
    for (const n of [...idl.instructions, ...idl.events].map((x: any) => snake(x.name))) expect(n).toMatch(/^[a-z][a-z0-9_]*$/);
  });
});
