# Plan margins at Helius paid pricing (read live 16 Nov 2026 from https://www.helius.dev/pricing; no plan was changed)

Helius, read live: a webhook push = **1 credit**; plans Free $0 = 1M credits, Developer $49 = 10M, Business $499 = 100M, Professional $999 = 200M; additional credits **$5 per million** on every paid plan. Cost below = credits x $5 per million (Developer's own rate is $4.90 per million, so this is slightly pessimistic).

Credits per program per month, measured 16 Nov 2026 (usage endpoint before/after, scripts in LOG.md):
- webhook: 1 per transaction on the watched program id (a busy program is thousands a day: KLend was 59,572 a day);
- reconciler (src/ingest.ts pollAll, every 5 min, program id + programdata): 2 x 288 x 30 = 17,280 getSignaturesForAddress, plus about 2,400 getTransaction (the reconciler fetches the few transactions it sees before the webhook): about **19,700**;
- upgrade-only watch (free tier, public feed): ProgramData state in one getMultipleAccounts call a minute shared by up to 100 programs = **432 per program per month** ($0.002).

Worst case = the customer's programs all sit at their transaction quota every month.

| plan | price | programs | quota per program | webhook credits (quota x programs) | reconciler credits | total credits | cost at $5/M | margin | margin % |
|---|---|---|---|---|---|---|---|---|---|
| Starter | $9 | 3 | 100,000 | 300,000 | 59,100 | 359,100 | $1.80 | **+$7.20** | 80% |
| Growth | $39 | 10 | 1,000,000 | 10,000,000 | 197,000 | 10,197,000 | $50.99 | **-$11.99** | -31% |
| Scale | $149 | 25 | 5,000,000 | 125,000,000 | 492,500 | 125,492,500 | $627.46 | **-$478.46** | -321% |
| Free tier | $0 | 1 | upgrade-only | 0 | 432 | 432 | $0.002 | -$0.002 | n/a |

Break-even transactions per program per month at full programs: Growth about 0.77M of its 1M quota; Scale about 1.2M of its 5M.

Two things this table does not say, both matter:
1. **Quota does not cap the bill.** At 100% of quota alerts pause (src/service.ts onTx), but the webhook keeps pushing and Helius bills every push. A program with 64k transactions a day (KLend) costs about 1.9M credits ($9.6) a month against a Starter price of $9, whatever the quota says. The fix that makes the table true is to take a program off the webhook address list when its quota is reached (WebhookSync edit, 100 credits) and put it back on the 1st; not done.
2. Growth and Scale lose money only if customers actually use their quota; Starter is positive even at 100%. Real usage is unknown: the only customer program ever watched was our own.
