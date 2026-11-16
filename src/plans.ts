// Plans live in the config file (service.toml), never in code. Defaults here are only the shape.
export interface Plan { id: string; name: string; priceUsd: number; txPerMonth: number; maxPrograms: number; hidden: boolean }
export interface BillingConfig { cluster: 'mainnet-beta' | 'devnet'; recipient: string; usdcMint: string; decimals: number; periodDays: number; graceDays: number; reminderDays: number; orderTtlMinutes: number; lateOrderDays: number; rpcUrl?: string }
export interface FreeTier { maxPrograms: number }
export interface PlansConfig { plans: Record<string, Plan>; trial: { days: number; plan: string; maxPrograms: number }; billing: BillingConfig; /** the free tier (R39): upgrade and authority alerts for this many programs, no rules, no expiry; null/absent = no free tier (the old trial flow) */ free?: FreeTier | null }

export function parsePlans(d: any): PlansConfig {
  const plans: Record<string, Plan> = {};
  for (const [id, p] of Object.entries<any>(d?.plans ?? {})) {
    if (!(p.tx_per_month > 0) || !(p.max_programs > 0)) throw new Error(`plan ${id}: tx_per_month and max_programs must be positive`);
    plans[id] = { id, name: p.name ?? id, priceUsd: Number(p.price_usd ?? 0), txPerMonth: Number(p.tx_per_month), maxPrograms: Number(p.max_programs), hidden: p.hidden === true };
  }
  const t = d?.trial ?? {};
  const trial = { days: Number(t.days ?? 14), plan: String(t.plan ?? 'starter'), maxPrograms: Number(t.max_programs ?? 1) };
  if (!plans[trial.plan]) throw new Error(`trial plan ${trial.plan} is not defined in [plans]`);
  const b = d?.billing ?? {};
  const billing: BillingConfig = {
    cluster: b.cluster ?? 'mainnet-beta', recipient: b.recipient ?? '', usdcMint: b.usdc_mint ?? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: Number(b.decimals ?? 6),
    periodDays: Number(b.period_days ?? 30), graceDays: Number(b.grace_days ?? 3), reminderDays: Number(b.reminder_days ?? 3), orderTtlMinutes: Number(b.order_ttl_minutes ?? 30), lateOrderDays: Number(b.late_order_days ?? 14), ...(b.rpc_url ? { rpcUrl: String(b.rpc_url) } : {}),
  };
  const f = d?.free;
  const free: FreeTier | null = f && typeof f === 'object' ? { maxPrograms: Math.max(1, Number(f.max_programs ?? 1)) } : null;
  return { plans, trial, billing, free };
}
