# Plan margins at Helius paid pricing (R41, 16 Nov 2026; no live plan was changed before the deploy of this commit)

Helius, read live on 16 Nov 2026 from https://www.helius.dev/pricing: a webhook push = **1 credit**; additional credits **$5 per million**; Developer $49 = 10M credits. Cost = credits x $5 per million.

Caps (decided in R41): a plan's TOTAL webhook transactions per month, across all its programs, may not exceed price x 100,000, which costs exactly half the price at $5 per million: Starter $9 -> 900,000, Growth $39 -> 3,900,000, Scale $149 -> 14,900,000. They are set as programs x transactions per program: 3 x 300,000, 10 x 390,000, 25 x 596,000 (test/plans-margin.test.ts enforces it from deploy/service.example.toml).

Quota safety (R41): a program that reaches its monthly quota is taken off the Helius webhook address list (the webhook is deleted when none is left), is not polled by the reconciler, and returns on the 1st or when the user upgrades (test/quota.test.ts). So the worst case below is a real ceiling, not a hope.

Reconciler overhead, measured 16 Nov 2026: about 19,700 credits per program per month (2 x 288 getSignaturesForAddress a day for the program id and its programdata, plus about 2,400 getTransaction for transactions the reconciler sees before the webhook).

| plan | price | programs | tx per program | max tx / month, all programs | webhook credits | reconciler credits | total credits | cost at $5/M | margin | margin % |
|---|---|---|---|---|---|---|---|---|---|---|
| Starter | $9 | 3 | 300,000 | 900,000 | 900,000 | 59,100 | 959,100 | $4.80 | **+$4.20** | 46.7% |
| Growth | $39 | 10 | 390,000 | 3,900,000 | 3,900,000 | 197,000 | 4,097,000 | $20.49 | **+$18.51** | 47.5% |
| Scale | $149 | 25 | 596,000 | 14,900,000 | 14,900,000 | 492,500 | 15,392,500 | $76.96 | **+$72.04** | 48.3% |
| Free tier | $0 | 1 | upgrade-only | 0 | 0 | 432 | 432 | $0.002 | -$0.002 | n/a |

On the webhook credits alone (1 credit per transaction, the rule the caps were set from) every plan is exactly 50%. Counting the reconciler, the worst-case margin is 46.7% to 48.3%, a little under 50%. To hold 50% including the reconciler the totals would have to be 840,900 (Starter), 3,703,000 (Growth) and 14,407,500 (Scale) transactions; or the reconciler for paid programs could poll every 15 minutes instead of every 5 (a third of its cost). Not applied: the caps above are the ones asked for.

Before this change (same method): Starter +$7.20 on 300,000 worst-case, Growth -$11.99 on 10M, Scale -$478.46 on 125M, and quota did not stop webhook billing.
