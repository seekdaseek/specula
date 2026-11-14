# Generates the numbers in PRICING.md. Inputs are in COSTS.md (section 7). Run: python3 phase0/pricing.py [miss_rate]
import sys, math
miss = float(sys.argv[1]) if len(sys.argv) > 1 else 0.05      # fraction of transactions the webhook missed (reconciler getTransaction), MEASURED in the live run
VPS = float(sys.argv[2]) if len(sys.argv) > 2 else 10.0       # USD/month, ASSUMPTION (UNVERIFIED)
P = 5 / 1e6                                                   # Helius $ per credit beyond the plan (COSTS.md)
PLANS = [('Developer', 49, 10e6), ('Business', 499, 100e6), ('Professional', 999, 200e6)]
RECON = 2 * 8640                                              # getSignaturesForAddress: program + programdata, every 5 min, 30 days
tiers = [('auction-house', 2), ('squads-v3', 41), ('jupiter-lend', 6076), ('squads-v4', 6214), ('kamino-lend (extrap)', 75819), ('raydium-clmm (extrap)', 3502703)]
def credits(txd): m = txd * 30; return m + RECON + miss * m          # webhook event + reconciler calls + reconciler getTransaction for misses
def plan_cost(total):                                         # cheapest plan incl. overage
    best = min(((f + max(0, total - inc) * P), n) for n, f, inc in PLANS); return best
print('| program | tx/day | tx/month | credits/month | marginal $/month (credits x $5/M) |'); print('|---|---|---|---|---|')
for n, t in tiers: c = credits(t); print(f'| {n} | {t:,} | {t*30:,} | {c:,.0f} | ${c*P:.2f} |')
print()
print(f'Plan fee shared (all N customers on one tier, cheapest Helius plan incl. $5/M overage; VPS ${VPS:.0f}/month ASSUMED):')
print('| tier | N=10 | N=50 | N=200 |'); print('|---|---|---|---|')
for n, t in tiers:
    row = []
    for N in (10, 50, 200):
        cost, plan = plan_cost(N * credits(t)); row.append(f'${cost/N:.2f} ({plan}) +VPS ${VPS/N:.2f}')
    print(f'| {n} | ' + ' | '.join(row) + ' |')
print()
# ladder
ladder = [('Starter', 100_000, 9), ('Growth', 1_000_000, 39), ('Scale', 5_000_000, 149)]
print('| tier | tx/month included | price/month | worst-case Helius cost at the cap | margin at cap before fixed costs |'); print('|---|---|---|---|---|')
for n, cap, price in ladder: cc = (cap + RECON + miss * cap) * P; print(f'| {n} | {cap:,} | ${price} | ${cc:.2f} | ${price-cc:.2f} |')
print()
# break-even on the cheapest viable mix
for label, price, mc in [('Starter @ $9', 9, (100_000*(1+miss)+RECON)*P), ('Growth @ $39', 39, (1_000_000*(1+miss)+RECON)*P), ('Starter, typical load (auction-house) @ $9', 9, credits(41)*P), ('Growth, typical load (jupiter-lend) @ $39', 39, credits(6076)*P)]:
    n = math.ceil((49 + VPS) / (price - mc)); print(f'break-even ({label}): marginal ${mc:.2f}; (Helius $49 + VPS ${VPS:.0f}) / (${price} - ${mc:.2f}) = {n} customers')
