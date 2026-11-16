// R41: the plan caps keep the worst-case webhook cost at or under half the price: 1 credit per webhook transaction (Helius, read live 16 Nov 2026), $5 per million credits.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { parse } from 'smol-toml';
import { parsePlans } from '../src/plans.js';

const CAP: Record<string, number> = { starter: 900_000, growth: 3_900_000, scale: 14_900_000 };   // total transactions a month across all programs: price x 100,000 at $5 per 1M credits is half the price
describe('plan caps', () => {
  const cfg = parsePlans(parse(fs.readFileSync('deploy/service.example.toml', 'utf8')));
  for (const [id, cap] of Object.entries(CAP)) {
    it(`${id}: programs x tx per program stays at or under ${cap.toLocaleString('en-US')} and the webhook cost is at most half the price`, () => {
      const p = cfg.plans[id]!; const total = p.txPerMonth * p.maxPrograms;
      expect(total).toBeLessThanOrEqual(cap);
      expect((total / 1_000_000) * 5).toBeLessThanOrEqual(p.priceUsd / 2);
      expect(total).toBeGreaterThan(cap * 0.99);                       // the cap is used, not wasted
    });
  }
});
