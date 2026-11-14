import { describe, it, expect } from 'vitest';
import anchor from '@coral-xyz/anchor';
import bs58 from 'bs58';
import { AnchorDecoder } from '../src/decode.js';
import { toJson } from '../src/shape.js';
import type { RawTx } from '../src/types.js';

// Expected shapes are read from Microscope's generated decoder (serde derive + base58 pubkeys), see LOG.md.
const PID = 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS';
const KEY = '11111111111111111111111111111112';
const idl = {
  address: PID, metadata: { name: 'sink', version: '0.1.0', spec: '0.1.0' },
  instructions: [{ name: 'kitchen_sink', discriminator: [1, 2, 3, 4, 5, 6, 7, 8], accounts: [],
    args: [
      { name: 'big_u64', type: 'u64' }, { name: 'huge_u128', type: 'u128' }, { name: 'neg_i128', type: 'i128' }, { name: 'small', type: 'u32' },
      { name: 'maybe_some', type: { option: 'u64' } }, { name: 'maybe_none', type: { option: 'u64' } },
      { name: 'owner', type: 'pubkey' }, { name: 'maybe_key', type: { option: 'pubkey' } },
      { name: 'blob', type: 'bytes' }, { name: 'hash', type: { array: ['u8', 4] } },
      { name: 'unit', type: { defined: { name: 'Vote' } } }, { name: 'named', type: { defined: { name: 'Action' } } },
      { name: 'tuple1', type: { defined: { name: 'Wrapper' } } }, { name: 'tuple2', type: { defined: { name: 'Pair' } } },
      { name: 'nested', type: { defined: { name: 'Inner' } } },
    ] }],
  types: [
    { name: 'Vote', type: { kind: 'enum', variants: [{ name: 'Approve' }, { name: 'Reject' }] } },
    { name: 'Action', type: { kind: 'enum', variants: [{ name: 'Noop' }, { name: 'AddMember', fields: [{ name: 'new_member', type: 'pubkey' }, { name: 'weight', type: 'u64' }] }] } },
    { name: 'Wrapper', type: { kind: 'enum', variants: [{ name: 'One', fields: ['u64'] }] } },
    { name: 'Pair', type: { kind: 'enum', variants: [{ name: 'Two', fields: ['u8', 'u8'] }] } },
    { name: 'Inner', type: { kind: 'struct', fields: [{ name: 'who', type: 'pubkey' }, { name: 'amount_u64', type: 'u64' }] } },
  ],
};
const U64MAX = '18446744073709551615', U128MAX = '340282366920938463463374607431768211455', I128MIN = '-170141183460469231731687303715884105728';

function run() {
  const coder = new anchor.BorshCoder(idl as any);
  const pk = new anchor.web3.PublicKey(KEY);
  const data = coder.instruction.encode('kitchen_sink', {
    big_u64: new anchor.BN(U64MAX), huge_u128: new anchor.BN(U128MAX), neg_i128: new anchor.BN(I128MIN), small: 7,
    maybe_some: new anchor.BN(5), maybe_none: null, owner: pk, maybe_key: pk,
    blob: Buffer.from([9, 8, 7]), hash: [1, 2, 3, 4],
    unit: { Approve: {} }, named: { AddMember: { new_member: pk, weight: new anchor.BN(2).pow(new anchor.BN(60)) } },
    tuple1: { One: { 0: new anchor.BN(3) } }, tuple2: { Two: { 0: 1, 1: 2 } },
    nested: { who: pk, amount_u64: new anchor.BN(9007199254740993n.toString()) },
  });
  const tx: RawTx = { slot: 1, blockTime: 1, transaction: { signatures: ['sig'], message: { accountKeys: [PID], instructions: [{ programIdIndex: 0, accounts: [], data: bs58.encode(data) }] } }, meta: { err: null, logMessages: [] } };
  const recs = new AnchorDecoder(PID, idl).decodeTx(tx);
  return recs;
}

describe('Microscope JSON shapes', () => {
  const recs = run();
  const args = (recs[0]!.data as any).data;
  it('decodes one record named kitchen_sink', () => { expect(recs.length).toBe(1); expect(recs[0]!.name).toBe('kitchen_sink'); });
  it('u64 above 2^53 is an exact bare JSON number, not a string', () => {
    const json = toJson(recs[0]!.data);
    expect(json).toContain(`"big_u64":${U64MAX}`);
    expect(json).not.toContain(`"${U64MAX}"`);
  });
  it('u128 and negative i128 are exact bare numbers', () => {
    const json = toJson(args);
    expect(json).toContain(`"huge_u128":${U128MAX}`);
    expect(json).toContain(`"neg_i128":${I128MIN}`);
  });
  it('safe integers stay plain numbers', () => { expect(args.small).toBe(7); });
  it('2^53+1 survives exactly in a nested struct', () => { expect(toJson(args.nested)).toBe(`{"who":"${KEY}","amount_u64":9007199254740993}`); });
  it('Option: Some is the value, None is null', () => { expect(args.maybe_some).toBe(5); expect(args.maybe_none).toBeNull(); });
  it('pubkeys and Option<pubkey> are base58 strings', () => { expect(args.owner).toBe(KEY); expect(args.maybe_key).toBe(KEY); });
  it('Vec<u8> and [u8; N] are arrays of numbers', () => { expect(args.blob).toEqual([9, 8, 7]); expect(args.hash).toEqual([1, 2, 3, 4]); });
  it('unit enum variant is the PascalCase string', () => { expect(args.unit).toBe('Approve'); });
  it('named-field enum variant is {Variant: {snake_fields}}', () => { expect(toJson(args.named)).toBe(`{"AddMember":{"new_member":"${KEY}","weight":1152921504606846976}}`); });
  it('tuple enum: one field is unwrapped, several are an array', () => { expect(args.tuple1).toEqual({ One: 3 }); expect(args.tuple2).toEqual({ Two: [1, 2] }); });
  it('negative control: the string form of a big u64 would NOT match the number form', () => { expect(toJson({ a: BigInt(U64MAX) })).toBe(`{"a":${U64MAX}}`); expect(toJson({ a: U64MAX })).toBe(`{"a":"${U64MAX}"}`); });
});
