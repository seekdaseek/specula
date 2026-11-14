// Mirrors heck's ToSnakeCase as used by Microscope (`name.to_snake_case()`):
// boundaries at lower->Upper and at the end of an Upper run before Upper+lower.
export function snake(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

/** Recursively snake_case object keys (Rust field names are snake_case). */
export function snakeKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(snakeKeys);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[snake(k)] = snakeKeys(x);
    return o;
  }
  return v;
}
