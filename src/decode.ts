import anchor from '@coral-xyz/anchor';
import bs58 from 'bs58';
import { snake } from './snake.js';
import { Shaper } from './shape.js';
import type { DecodedRecord, RawTx } from './types.js';

const EVENT_CPI_PREFIX = Buffer.from([228, 69, 165, 46, 81, 203, 154, 29]);

type AnchorIdl = Record<string, any>;

export interface IxDecoded { name: string; data: unknown; accountNames: string[] }

/** Walks a transaction (instructions, inner instructions, event-CPI, "Program data:" log events) and delegates the IDL-specific decoding. */
export abstract class TxDecoder {
  constructor(readonly programId: string) {}
  /** decode instruction data (discriminator included); null when it is not an instruction of this IDL */
  protected abstract decodeIx(buf: Buffer): IxDecoded | null;
  /** decode event bytes WITHOUT the 8-byte event-CPI prefix (event discriminator + borsh body) */
  protected abstract decodeEventBytes(raw: Buffer): { name: string; data: unknown } | null;
  private decodeEvent(raw: Buffer) { try { return this.decodeEventBytes(raw); } catch { return null; } }

  /** Decode every instruction and event of one transaction that belongs to this program. */
  decodeTx(tx: RawTx): DecodedRecord[] {
    const out: DecodedRecord[] = [];
    const sig = tx.transaction.signatures[0]!;
    const failed = !!tx.meta && tx.meta.err !== null && tx.meta.err !== undefined;
    const keys = [...tx.transaction.message.accountKeys, ...(tx.meta?.loadedAddresses?.writable ?? []), ...(tx.meta?.loadedAddresses?.readonly ?? [])];
    const base = { program_id: this.programId, signature: sig, slot: tx.slot, block_time: tx.blockTime ?? null, failed };

    type Ix = { path: string; top: number; programIdIndex: number; accounts: number[]; data: string; stack: number | null | undefined };
    const flat: Ix[] = [];
    tx.transaction.message.instructions.forEach((ix, i) => {
      flat.push({ path: String(i), top: i, ...ix, stack: 1 });
      const inner = tx.meta?.innerInstructions?.find((g) => g.index === i);
      inner?.instructions.forEach((c, k) => flat.push({ path: `${i}.${k}`, top: i, ...c, stack: c.stackHeight }));
    });

    // Per-top-level-instruction event counters so keys are stable.
    const evCount = new Map<string, number>();
    const nextEv = (path: string) => { const n = evCount.get(path) ?? 0; evCount.set(path, n + 1); return `${path}:ev${n}`; };
    const logEvents = this.eventsFromLogs(tx.meta?.logMessages ?? []);

    for (const ix of flat) {
      if (keys[ix.programIdIndex] !== this.programId) continue;
      let buf: Buffer;
      try { buf = Buffer.from(bs58.decode(ix.data)); } catch { continue; }
      if (buf.subarray(0, 8).equals(EVENT_CPI_PREFIX)) {
        // event-CPI: self-CPI whose data is prefix + event discriminator + borsh
        const ev = this.decodeEvent(buf.subarray(8));
        if (ev) out.push({ ...base, kind: 'program_event', name: ev.name, data: ev.data, source: 'cpi', instruction_path: ix.path, ix_key: nextEv(ix.path) });
        continue;
      }
      const dec = this.decodeIx(buf);
      if (!dec) continue;
      const name = dec.name;
      const names = dec.accountNames;
      const accounts: Record<string, string> = {};
      ix.accounts.forEach((a, i) => { const k = names[i] ?? `remaining_${i - names.length}`; accounts[k] = keys[a]!; });
      out.push({
        ...base, kind: 'program_instruction', name,
        data: { program_id: this.programId, data: dec.data, accounts },
        instruction_path: ix.path, ix_key: ix.path,
      });
    }
    // Log events: attributed to the top-level instruction frame they were emitted in.
    for (const le of logEvents) {
      const ev = this.decodeEvent(Buffer.from(le.b64, 'base64'));
      if (!ev) continue;
      const path = String(le.top);
      out.push({ ...base, kind: 'program_event', name: ev.name, data: ev.data, source: 'log', instruction_path: path, ix_key: nextEv(path) });
    }
    return out;
  }

  /** "Program data:" lines emitted while our program is the top of the invoke stack.
   *  Program-controlled "Program log:" text is never trusted for structure (same hardening as Microscope). */
  private eventsFromLogs(logs: string[]): { top: number; b64: string }[] {
    const out: { top: number; b64: string }[] = [];
    const stack: string[] = [];
    let top = -1;
    for (const line of logs) {
      let m = /^Program (\w+) invoke \[(\d+)\]$/.exec(line);
      if (m) { stack.push(m[1]!); if (m[2] === '1') top++; continue; }
      m = /^Program (\w+) (success|failed.*)$/.exec(line);
      if (m && !line.startsWith('Program log:')) { stack.pop(); continue; }
      if (line.startsWith('Program data: ') && stack[stack.length - 1] === this.programId) out.push({ top, b64: line.slice('Program data: '.length).trim() });
    }
    return out;
  }
}

export class AnchorDecoder extends TxDecoder {
  readonly coder: anchor.BorshCoder;
  private shaper: Shaper;
  private argTypes = new Map<string, any[]>();
  private accountNames = new Map<string, string[]>();
  constructor(programId: string, readonly idl: AnchorIdl) {
    super(programId);
    this.coder = new anchor.BorshCoder(idl as anchor.Idl);
    this.shaper = new Shaper(idl);
    for (const ix of idl.instructions ?? []) { this.argTypes.set(snake(ix.name), ix.args ?? []); this.accountNames.set(snake(ix.name), flattenAccounts(ix.accounts ?? [])); }
  }
  protected decodeIx(buf: Buffer): IxDecoded | null {
    const dec = this.coder.instruction.decode(buf);
    if (!dec) return null;
    const name = snake(dec.name);
    return { name, data: this.shaper.fields(this.argTypes.get(name) ?? [], dec.data), accountNames: this.accountNames.get(name) ?? [] };
  }
  protected decodeEventBytes(raw: Buffer) {
    const e = this.coder.events.decode(raw.toString('base64'));
    return e ? { name: snake(e.name), data: this.shaper.value({ defined: { name: e.name } }, e.data) } : null;
  }
}

function flattenAccounts(accts: any[]): string[] {
  return accts.flatMap((a) => (a.accounts ? flattenAccounts(a.accounts) : [snake(a.name)]));
}

/** BN -> number when safe else decimal string; PublicKey -> base58; Buffer -> number[]. */
export function jsonify(v: any): any {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
  if (anchor.BN.isBN(v)) return v.bitLength() <= 53 ? v.toNumber() : v.toString(10);
  if (v && typeof v.toBase58 === 'function') return v.toBase58();
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return Array.from(v);
  if (Array.isArray(v)) return v.map(jsonify);
  if (typeof v === 'object') { const o: Record<string, unknown> = {}; for (const [k, x] of Object.entries(v)) o[k] = jsonify(x); return o; }
  return v;
}
