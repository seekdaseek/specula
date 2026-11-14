import zlib from 'node:zlib';
import anchor from '@coral-xyz/anchor';
import bs58 from 'bs58';
import { snake } from './snake.js';
import { AnchorDecoder } from './decode.js';
import { CodamaDecoder } from './decode-codama.js';
import { convertLegacyIdl, isLegacyIdl } from './idl-legacy.js';

export const MAX_IDL_BYTES = 1_000_000;
const PublicKey = anchor.web3.PublicKey;

export function isPubkey(s: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return false;
  try { return bs58.decode(s).length === 32; } catch { return false; }
}

export interface IdlInfo { kind: 'anchor' | 'codama'; instructions: string[]; events: string[] }

/** Validate an IDL for a program id: size, shape, declared address, and that a decoder can be built from it. Throws a message safe to show a user. */
export function inspectIdl(idl: any, programId: string): IdlInfo {
  if (!idl || typeof idl !== 'object' || Array.isArray(idl)) throw new Error('The IDL must be a JSON object.');
  if (JSON.stringify(idl).length > MAX_IDL_BYTES) throw new Error('The IDL is larger than 1 MB.');
  let info: IdlInfo;
  if (idl.kind === 'rootNode') {
    const declared = idl.program?.publicKey;
    if (declared && declared !== programId) throw new Error(`IDL address mismatch: the IDL declares ${declared}, you asked for ${programId}.`);
    try { new CodamaDecoder(programId, idl); } catch (e) { throw new Error(`The Codama IDL cannot be used: ${(e as Error).message}`); }
    info = { kind: 'codama', instructions: (idl.program.instructions ?? []).map((i: any) => snake(i.name)), events: (idl.program.events ?? []).map((e: any) => snake(e.name)) };
  } else {
    if (!Array.isArray(idl.instructions)) throw new Error('This does not look like an Anchor or Codama IDL (no instructions).');
    const declared = idl.address ?? idl.metadata?.address;
    if (declared && declared !== programId) throw new Error(`IDL address mismatch: the IDL declares ${declared}, you asked for ${programId}.`);
    try { new AnchorDecoder(programId, isLegacyIdl(idl) ? convertLegacyIdl(idl, programId) : idl); } catch (e) { throw new Error(`The Anchor IDL cannot be used: ${(e as Error).message}`); }
    info = { kind: 'anchor', instructions: idl.instructions.map((i: any) => snake(i.name)), events: (idl.events ?? []).map((e: any) => snake(e.name)) };
  }
  return info;
}

/** The IDL account Anchor publishes: createWithSeed(base, "anchor:idl", programId), base = PDA([], programId). Data = 8 disc + 32 authority + u32 len + zlib JSON. */
export async function idlAddress(programId: string): Promise<string> {
  const pid = new PublicKey(programId);
  const [base] = PublicKey.findProgramAddressSync([], pid);
  return (await PublicKey.createWithSeed(base, 'anchor:idl', pid)).toBase58();
}
export function decodeIdlAccount(data: Buffer): any {
  if (data.length < 44) throw new Error('IDL account too short');
  const len = data.readUInt32LE(40);
  if (len > MAX_IDL_BYTES || 44 + len > data.length) throw new Error('IDL account length invalid');
  return JSON.parse(zlib.inflateSync(data.subarray(44, 44 + len), { maxOutputLength: 8_000_000 }).toString('utf8'));
}
export async function fetchOnchainIdl(rpc: { getAccountData(a: string): Promise<{ owner: string; data: Buffer } | null> }, programId: string): Promise<any | null> {
  const acc = await rpc.getAccountData(await idlAddress(programId));
  if (!acc || acc.owner !== programId) return null;       // the IDL account is owned by the program itself
  try { return decodeIdlAccount(acc.data); } catch { return null; }
}
