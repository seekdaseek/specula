// Codama rootNode IDLs, decoded at runtime with @codama/dynamic-codecs (the maintained runtime decoder).
// JSON shapes follow the same Microscope rules as shape.ts (exact integers, base58, enums as serde externally tagged).
import { getNodeCodec } from '@codama/dynamic-codecs';
import { snake } from './snake.js';
import { exactInt } from './shape.js';
import { TxDecoder, type IxDecoded } from './decode.js';

const pascal = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function shape(v: any): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return exactInt(v);
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Uint8Array) return Array.from(v);
  if (Array.isArray(v)) return v.map(shape);
  if (typeof v === 'object') {
    if ('__option' in v) return v.__option === 'Some' ? shape(v.value) : null;
    if ('__kind' in v) {
      const { __kind, ...rest } = v;
      const keys = Object.keys(rest);
      if (keys.length === 0) return pascal(__kind);
      if (keys.length === 1 && keys[0] === 'fields') { const f = (rest.fields as any[]).map(shape); return { [pascal(__kind)]: f.length === 1 ? f[0] : f }; }
      return { [pascal(__kind)]: Object.fromEntries(Object.entries(rest).map(([k, x]) => [snake(k), shape(x)])) };
    }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [snake(k), shape(x)]));
  }
  return v;
}

export class CodamaDecoder extends TxDecoder {
  private ixs: { name: string; disc: number; codec: { decode(b: Uint8Array): any }; accountNames: string[] }[] = [];
  private evs: { name: string; tag: Buffer; codec: { decode(b: Uint8Array): any } }[] = [];
  constructor(programId: string, readonly root: any) {
    super(programId);
    if (root?.kind !== 'rootNode' || !root.program) throw new Error('not a Codama rootNode IDL');
    const program = root.program;
    for (const node of program.instructions ?? []) {
      const d = node.arguments?.find((a: any) => a.name === 'discriminator')?.defaultValue;
      if (d?.kind !== 'numberValueNode') throw new Error(`instruction ${node.name}: only numeric u8 discriminators are supported`);
      this.ixs.push({ name: snake(node.name), disc: d.number, codec: getNodeCodec([root, program, node] as any) as any, accountNames: (node.accounts ?? []).map((a: any) => snake(a.name)) });
    }
    for (const node of program.events ?? []) {
      // event-CPI layout: [8-byte prefix][tag at offset 8][fields]; the prefix is stripped before decodeEventBytes
      const tagD = (node.discriminators ?? []).find((x: any) => x.kind === 'constantDiscriminatorNode' && x.offset >= 8);
      if (!tagD) throw new Error(`event ${node.name}: no discriminator at offset >= 8`);
      const tag = Buffer.from(tagD.constant.value.data, tagD.constant.value.encoding === 'base16' ? 'hex' : 'base64');
      this.evs.push({ name: snake(node.name), tag, codec: getNodeCodec([root, program, node, node.data] as any) as any });
    }
  }
  protected decodeIx(buf: Buffer): IxDecoded | null {
    const ix = this.ixs.find((i) => i.disc === buf[0]);
    if (!ix) return null;
    const { discriminator: _d, ...args } = ix.codec.decode(buf) as Record<string, unknown>;
    return { name: ix.name, data: shape(args), accountNames: ix.accountNames };
  }
  protected decodeEventBytes(raw: Buffer) {
    const ev = this.evs.find((e) => raw.length >= e.tag.length && raw.subarray(0, e.tag.length).equals(e.tag));
    if (!ev) return null;
    return { name: ev.name, data: shape(ev.codec.decode(raw.subarray(ev.tag.length))) };
  }
}
