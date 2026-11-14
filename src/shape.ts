// Shape decoded Anchor values into the JSON that Microscope's Rust decoder (serde_json) emits.
// Source of truth: ref/solana-microscope generated decoder for lending.json + squads-v4 (see LOG.md, Phase 1b section 3).
//   u8..u128 / i8..i128   exact JSON number (serde_json writes the full digits, even above 2^53)
//   Pubkey, Option<Pubkey> base58 string (the deployment decoder is generated with base58)
//   Option<T>             null | T
//   Vec<u8>, [u8; N]      array of numbers
//   struct                object with snake_case field names
//   enum, unit variant    "Variant"                       (serde externally tagged)
//   enum, named fields    {"Variant": {"field": ..}}
//   enum, tuple fields    {"Variant": x} for one field, {"Variant": [..]} for several
import anchor from '@coral-xyz/anchor';
import { snake } from './snake.js';

type Ty = any;
const norm = (s: string) => s.replace(/_/g, '').toLowerCase();
function pick(obj: any, name: string): unknown {
  if (obj === null || typeof obj !== 'object') return undefined;
  if (name in obj) return obj[name];
  const n = norm(name);
  for (const k of Object.keys(obj)) if (norm(k) === n) return obj[k];
  return undefined;
}
const pascal = (s: string) => s.split('_').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');

export function exactInt(v: any): number | bigint {
  const b = anchor.BN.isBN(v) ? BigInt(v.toString(10)) : BigInt(v);
  return b >= BigInt(Number.MIN_SAFE_INTEGER) && b <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(b) : b;
}

export class Shaper {
  private defs = new Map<string, any>();
  constructor(idl: Record<string, any>) { for (const t of idl.types ?? []) this.defs.set(t.name, t); }

  fields(fields: { name: string; type: Ty }[], obj: any): Record<string, unknown> {
    const o: Record<string, unknown> = {};
    for (const f of fields) o[snake(f.name)] = this.value(f.type, pick(obj, f.name));
    return o;
  }

  value(ty: Ty, v: any): unknown {
    if (v === undefined || v === null) return null;
    if (typeof ty === 'string') {
      switch (ty) {
        case 'pubkey': case 'publicKey': return v.toBase58 ? v.toBase58() : String(v);
        case 'u64': case 'i64': case 'u128': case 'i128': case 'u256': case 'i256': return exactInt(v);
        case 'f32': case 'f64': return Number.isFinite(v) ? v : null; // serde_json writes non-finite floats as null
        case 'bytes': return Array.from(v as Uint8Array);
        default: return typeof v === 'bigint' || anchor.BN.isBN(v) ? exactInt(v) : v;
      }
    }
    if (ty.option !== undefined || ty.coption !== undefined) return this.value(ty.option ?? ty.coption, v);
    if (ty.vec !== undefined) return (v as any[]).map((x) => this.value(ty.vec, x));
    if (ty.array !== undefined) return (Array.from(v as any[])).map((x) => this.value(ty.array[0], x));
    if (ty.defined !== undefined) {
      const name = typeof ty.defined === 'string' ? ty.defined : ty.defined.name;
      const def = this.defs.get(name);
      if (!def) return v;
      const k = def.type;
      if (k.kind === 'struct') {
        if (!k.fields) return {};
        return k.fields[0]?.name === undefined ? (k.fields as Ty[]).map((t, i) => this.value(t, pick(v, String(i)) ?? (Array.isArray(v) ? v[i] : undefined))) : this.fields(k.fields, v);
      }
      if (k.kind === 'enum') {
        const key = Object.keys(v)[0]!;
        const variant = (k.variants as any[]).find((x) => norm(x.name) === norm(key));
        if (!variant) return v;
        const vname = pascal(variant.name);
        const inner = (v as any)[key];
        if (!variant.fields || variant.fields.length === 0) return vname;
        if (variant.fields[0].name !== undefined) return { [vname]: this.fields(variant.fields, inner) };
        const arr = (variant.fields as Ty[]).map((t, i) => this.value(t, Array.isArray(inner) ? inner[i] : pick(inner, String(i))));
        return { [vname]: arr.length === 1 ? arr[0] : arr };
      }
      return v;
    }
    return v;
  }
}

const MARK = `@@big-${Math.random().toString(36).slice(2)}@@`;
/** JSON.stringify that writes bigint as an exact bare number, like serde_json does for u64/u128. */
export function toJson(v: unknown, space?: number): string {
  const s = JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${MARK}${x}${MARK}` : x), space);
  return s === undefined ? 'null' : s.replace(new RegExp(`"${MARK}(-?\\d+)${MARK}"`, 'g'), '$1');
}
