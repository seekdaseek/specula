import { createHash } from 'node:crypto';
import { snake } from './snake.js';

const disc = (ns: string, name: string) => [...createHash('sha256').update(`${ns}:${name}`).digest().subarray(0, 8)];

function ty(t: any): any {
  if (typeof t === 'string') return t === 'publicKey' ? 'pubkey' : t;
  if (t.defined !== undefined) return { defined: { name: typeof t.defined === 'string' ? t.defined : t.defined.name } };
  if (t.option) return { option: ty(t.option) };
  if (t.coption) return { coption: ty(t.coption) };
  if (t.vec) return { vec: ty(t.vec) };
  if (t.array) return { array: [ty(t.array[0]), t.array[1]] };
  return t;
}
function accts(a: any[]): any[] {
  return a.map((x) => x.accounts ? { name: x.name, accounts: accts(x.accounts) } : { name: x.name, ...(x.isMut ? { writable: true } : {}), ...(x.isSigner ? { signer: true } : {}), ...(x.isOptional || x.optional ? { optional: true } : {}) });
}
function fields(fs: any[] | undefined) { return fs?.map((f) => (f.name !== undefined ? { name: f.name, type: ty(f.type) } : ty(f))); }
function typeDef(t: any) {
  const k = t.type;
  if (k.kind === 'struct') return { name: t.name, type: { kind: 'struct', fields: fields(k.fields) } };
  if (k.kind === 'enum') return { name: t.name, type: { kind: 'enum', variants: k.variants.map((v: any) => ({ name: v.name, ...(v.fields ? { fields: fields(v.fields) } : {}) })) } };
  return { name: t.name, type: k };
}

/** Names of `defined` types referenced anywhere inside a type definition. */
function definedRefs(x: any, out = new Set<string>()): Set<string> {
  if (Array.isArray(x)) x.forEach((y) => definedRefs(y, out));
  else if (x && typeof x === 'object') { if (x.defined !== undefined) out.add(typeof x.defined === 'string' ? x.defined : x.defined.name); Object.values(x).forEach((y) => definedRefs(y, out)); }
  return out;
}
/** Drop type definitions that reference types the IDL does not define (e.g. Squads' generic `SmallVec<u8,Pubkey>`): the Anchor coder builds a layout for every type and would reject the whole IDL. Cascades. */
export function pruneUnresolvable<T extends { name: string }>(types: T[]): T[] {
  let cur = types;
  for (;;) {
    const names = new Set(cur.map((t) => t.name));
    const next = cur.filter((t) => [...definedRefs(t)].every((r) => names.has(r)));
    if (next.length === cur.length) return cur;
    cur = next;
  }
}

/** Convert a pre-0.30 Anchor IDL (isMut/isSigner, no discriminators) to spec 0.1.0 so the runtime coder accepts it. */
export function convertLegacyIdl(old: any, address?: string): any {
  const types = [...(old.types ?? [])];
  // legacy account and event structs are decoded by name; ensure they exist as types
  for (const a of old.accounts ?? []) if (!types.find((t: any) => t.name === a.name)) types.push(a);
  for (const e of old.events ?? []) if (!types.find((t: any) => t.name === e.name)) types.push({ name: e.name, type: { kind: 'struct', fields: e.fields.map((f: any) => ({ name: f.name, type: f.type })) } });
  return {
    address: address ?? old.metadata?.address ?? '',
    metadata: { name: old.name, version: old.version ?? '0.0.0', spec: '0.1.0' },
    instructions: old.instructions.map((i: any) => ({ name: snake(i.name), discriminator: disc('global', snake(i.name)), accounts: accts(i.accounts ?? []), args: (i.args ?? []).map((a: any) => ({ name: a.name, type: ty(a.type) })) })),
    accounts: (old.accounts ?? []).map((a: any) => ({ name: a.name, discriminator: disc('account', a.name) })),
    events: (old.events ?? []).map((e: any) => ({ name: e.name, discriminator: disc('event', e.name) })),
    errors: old.errors ?? [],
    types: pruneUnresolvable(types.map(typeDef)),
  };
}
export const isLegacyIdl = (idl: any) => !idl?.metadata?.spec && Array.isArray(idl?.instructions);
