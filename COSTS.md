# specula — Phase 0 cost gate (measured 14 Nov 2026, ~03:00 UTC)

Question: monthly ingest cost per monitored program, three designs, three traffic tiers.
Month = 30 days. All dollar figures are **marginal** (per-credit/per-call rate), not plan base fees; a plan's fixed fee is shared by every program on it (Helius Developer $49 = 10M credits, so one plan carries ~50 mid-tier programs on design A).

## 1. Traffic measured (getSignaturesForAddress, last 24h)

RPC that answered: **api.mainnet-beta.solana.com** (all rows). Script: `phase0/measure.mjs`, raw output `phase0/measure-*.jsonl`. Count = signatures incl. failed.

| tier | program | id | tx/24h | failed | how |
|---|---|---|---|---|---|
| low | Metaplex Auction House | hausS13jsjafwWwGqZTUQRmWyvyxn9EQpqMwV1PBBmk | 2 | 0 | full 24h, 1 page |
| low | Squads v3 | SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu | 55 | 0 | full 24h, 1 page |
| mid | **Jupiter Lend** | jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9 | 6,147 | 328 | full 24h, 7 pages |
| mid | Squads v4 | SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf | 6,512 | 7 | full 24h, 7 pages |
| high | Kamino Lend | KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD | ~120,000 | 11,912 of 20,000 sampled (60%) | **EXTRAPOLATED**: 20 pages (20,000 sigs) spanned 14,356 s |
| high | Raydium CLMM | CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK | ~6,280,000 | 5,795 of 20,000 sampled | **EXTRAPOLATED from a 275 s window; order of magnitude only** |

Median of the six = (6,147 + 6,512)/2 = **6,330 tx/day** (mid tier). Streamflow (13,732/day, full 24h) was also measured but not selected.
The two high rows were not paged to 24h because public RPC rate limits make that impractical; treat them as estimates.

## 2. Prices fetched (all fetched 14 Nov 2026)

| provider | fact | source |
|---|---|---|
| Helius | Plans: Free $0/1M credits, Developer $49/10M, Business $499/100M, Professional $999/200M; **additional credits $5 per million** on paid plans | https://www.helius.dev/pricing |
| Helius | Standard RPC call (incl. getTransaction, getSignaturesForAddress) = **1 credit** | https://www.helius.dev/docs/billing/credits |
| Helius | **Webhook event = 1 credit**, charged whether or not your endpoint accepts it; create/edit/delete a webhook via API = 100 credits | https://www.helius.dev/docs/webhooks |
| Helius | **100k addresses per webhook**; max webhooks Free 5, Developer/Business/Professional 50 | https://www.helius.dev/docs/billing/rate-limits |
| Helius | LaserStream WebSocket (standard Solana methods incl. logsSubscribe) = **2 credits per 0.1 MB** streamed | https://www.helius.dev/docs/billing/credits |
| Helius | RPS: Free 10, Developer 50, Business 200 (see pricing page) | https://www.helius.dev/pricing |
| QuickNode | Build $49/mo (80M credits, $0.43/M listed), Accelerate $249 (450M, $0.47/M), Scale $499 (950M, $0.45/M) | https://www.quicknode.com/pricing |
| QuickNode | Solana "All methods" = **30 API credits** per call | https://www.quicknode.com/api-credits/sol |
| Triton | Pay-as-you-go: **$10 per million calls + $0.08/GB bandwidth**; streaming = $0.08/GB only; $25 minimum prepaid deposit | https://triton.one/pricing |
| Chainstack | Growth $49/mo = 20M request units; Pro $199 = 80M; Business $499 = 200M | https://chainstack.com/pricing/ |
| Chainstack | Solana: full request 1 RU; **getSignaturesForAddress always archive = 2 RU**; getTransaction 1 RU | https://docs.chainstack.com/docs/request-units |

Measured by me, this session (small samples, flagged):
- logsSubscribe notification size (public WSS, 90 s): Jupiter Lend 4,551 B avg (n=4), Squads v4 1,090 B avg (n=6). Model uses 4,551 B (conservative). `phase0/logsbw.mjs`.
- getSignaturesForAddress response: ~226 B per signature (n=1000 each). getTransaction (json) response: ~8,327 B avg (n=6, Jupiter Lend only; other 14 calls returned null on public RPC). `phase0/sizes.mjs`.

## 3. Designs and formulas

- **A** one shared webhook watching all customer program IDs: cost = tx/month x 1 credit x $5/M.
- **B** websocket logsSubscribe + getTransaction per hit: cost = tx/month x (4,551 B x 20 credits/MB + 1 credit getTransaction) x $5/M on Helius; QuickNode/Triton columns below.
- **C** poll getSignaturesForAddress every 15 s + getTransaction per new signature: 172,800 polls/month fixed + tx/month getTransaction.

Rates used: Helius $5/M credits; QuickNode $0.43/M x 30 credits = $12.9 per million calls (lowest listed rate, best case); Triton $10/M calls + $0.08/GB; Chainstack Growth included rate $49/20M RU = $2.45/M RU (overage rate not fetched, UNVERIFIED). Script `phase0/costs.py` generates the table.

## 4. Result: $ per program per month

| tier | tx/day | tx/month | **A** Helius webhook | B Helius WSS logs + getTx | C Helius poll 15s | C QuickNode poll | B QuickNode (getTx only; WS price UNVERIFIED) | B Triton | C Triton | C Chainstack |
|---|---|---|---|---|---|---|---|---|---|---|
| low: auction-house | 2 | 60 | $0.0003 | $0.0003 | $0.86 | $2.23 | $0.0008 | $0.0007 | $1.73 | $0.85 |
| low: squads-v3 | 55 | 1,650 | $0.0083 | $0.0090 | $0.87 | $2.25 | $0.02 | $0.02 | $1.75 | $0.85 |
| mid: jupiter-lend | 6,147 | 184,410 | $0.92 | $1.01 | $1.79 | $4.61 | $2.38 | $2.03 | $3.70 | $1.30 |
| mid: squads-v4 | 6,512 | 195,360 | $0.98 | $1.07 | $1.84 | $4.75 | $2.52 | $2.15 | $3.82 | $1.33 |
| **MEDIAN (6,330/day)** | 6,330 | 189,885 | **$0.95** | $1.04 | $1.81 | $4.68 | $2.45 | $2.09 | $3.76 | $1.31 |
| high: kamino-lend (extrap) | 120,368 | 3,611,040 | $18.06 | $19.70 | $18.92 | $48.81 | $46.58 | $39.83 | $40.31 | $9.69 |
| high: raydium-clmm (extrap, wild) | 6,283,636 | 188,509,080 | $942.55 | $1,028.34 | $943.41 | $2,434.00 | $2,431.77 | $2,079.30 | $2,015.80 | $462.69 |

## 5. Reading it

- **Gate: PASS.** Cheapest design at median traffic is A on Helius at ~$0.95 per program per month (< $3). Phase 1 continues.
- Polling (C) has a fixed floor: 172,800 calls/month per program even with zero traffic ($0.86 on Helius, $2.23 on QuickNode at 30 credits/call). Webhook cost scales to zero with traffic. Below ~1k tx/day A is 10-100x cheaper than C.
- B is about A + 9% on Helius because logs bandwidth is cheap; its real cost is that logs lack instruction data, so every hit still needs getTransaction, and WSS needs a persistent connection per provider.
- High-traffic programs (>100k tx/day) cost $18+/month on every design; they need a usage-tiered price or a cap. The Raydium row shows an un-capped public AMM is not a customer shape.
- **Chosen for Phase 1: design A (raw webhook, one shared webhook over many program IDs) with a low-cadence polling reconciler (design C at ~5 min, ~8,640 calls/month = ~$0.04 on Helius) as the correctness fallback and as the only ingest mode when no webhook endpoint is reachable (the Mac dry run).** Overlap between webhook and poll is harmless because records are keyed on signature + instruction index.

## 6. UNVERIFIED / not fetched

- ~~Whether Helius raw webhooks deliver failed transactions~~ and ~~webhook latency and loss rate~~: measured in Phase 1b, see section 7 and PRICING.md section 5 (7 of 7 failed delivered; p50 1.2 s; 3 of 273 missed, all in the first minute).
- QuickNode Streams/WebSocket pricing, Triton logsSubscribe behavior, Chainstack WebSocket and overage rates: not fetched.
- Helius LaserStream WSS plan availability per tier (pricing table row for it did not parse).
- High-tier traffic figures (extrapolations). Payload size figures are small samples (n=4 to n=6).
- Rates are list prices on one day; none of this includes our own VPS cost or provider enterprise discounts.

## 7. Phase 1b inputs (14 Nov 2026) used by PRICING.md

| input | value | source |
|---|---|---|
| Helius plans, included credits, overage, webhook event = 1 credit, webhook create/delete = 100 credits | as in section 2 (fetched 14 Nov 2026 03:00 UTC); **not re-fetched in Phase 1b** | sections 2 table |
| tx/day today for the 6 programs | auction-house 2, squads-v3 41, jupiter-lend 6,076 (302 failed), squads-v4 6,214 (11 failed), kamino-lend 75,819 (extrapolated, 20 pages / 22,791 s), raydium-clmm 3,502,703 (extrapolated, 3 pages / 74 s) | `phase0/measure-20261114T0904Z.jsonl`, RPC api.mainnet-beta.solana.com, 14 Nov 2026 ~09:05 UTC. Phase 0 (03:00 UTC) figures in section 1 differ: traffic moves during the day |
| webhook miss rate | 3 of 273 (1.1%), 0 of 270 after the first delivery | live run, `scripts/live-report.ts` on live/live-*.db |
| webhook latency | p50 1.2 s, p95 1.8 s, max 2.8 s (n=270, +-1 s) | same |
| failed transactions delivered by webhook | 7 of 7 | same |
| reconciler | 5-minute poll, 2 addresses (program + programdata) = 17,280 getSignaturesForAddress/month | our configuration |
| VPS cost | $10/month **ASSUMED, UNVERIFIED** | not fetched |
| Helius dashboard credit usage for the live run | **not read, UNVERIFIED**; derived 797 credits from our own call counts | `scripts/live-credits.ts` |
| Proposed prices and caps | proposals | PRICING.md |
