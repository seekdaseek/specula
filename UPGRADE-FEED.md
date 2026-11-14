# Solana Upgrade Feed: measurement and verdict (14 Nov 2026)

Idea: a free public Telegram channel that posts every mainnet program upgrade, so developers find the bot. Nothing was built.

## What was measured

`scripts/upgrade-feed-measure.ts`, read only, results in `live/uf.db` (not committed). Loader: `BPFLoaderUpgradeab1e11111111111111111111111`.

- Window: 24 cycles, one every 5 minutes. The first cycle was a 1,000-signature backfill (kept out of the rates). Cycles 2 to 24 cover block times 13:23:21Z to 15:18:03Z, 1.91 hours, with complete coverage: 22,930 loader transactions.
- Classification: signatures come from the public RPC; transactions (`getTransaction`) from the Helius key. Up to 400 transactions per cycle were fetched and classified by their loader instruction tag (random sample when a cycle had more); 7,557 of 22,930 (33%) were classified. Rates below weight each cycle by its own sampling fraction. Cost to the shared Helius key: 7,957 `getTransaction` calls, about 8,000 credits.
- Failed transactions: 18 of 23,930 signatures.

## Numbers

| loader instruction | classified | estimated per hour | share of loader transactions |
|---|---|---|---|
| Write (buffer upload) | 7,524 | 11,964 | 99.75% |
| InitializeBuffer | 15 | 15.8 | 0.13% |
| DeployWithMaxDataLen (new program) | 7 | 6.6 | 0.06% |
| Close | 4 | 3.7 | 0.03% |
| **Upgrade** | **4** | **2.3** | **0.02%** |
| **SetAuthority** | **2** | **1.6** | **0.01%** |
| ExtendProgram | 1 | 0.5 | 0.004% |

Total about 12,000 loader transactions per hour (median 5-minute cycle: 450; cycle 6 alone had 6,131, so traffic is bursty). Upgrade plus SetAuthority: about 3.9 per hour, 93 per day, from 6 classified events. That count is tiny: a Poisson 95% range on 6 events is roughly 1 to 7 per hour. Treat it as an order of magnitude.

## Findings that matter

1. **Write noise is 99.75% of the traffic.** Anything that has to look at every loader transaction pays for about 12,000 transactions per hour to find about 4.
2. **Helius refuses the loader address in `getSignaturesForAddress`**: `Invalid params: Address is not supported` (the public RPC accepts it). So the "poll the loader through the Helius key" design is not possible, and polling has no instruction filter anyway: every signature must be fetched to see its type.
3. **Helius does accept a webhook on the loader address**, raw and enhanced. I created both, then deleted both within seconds and confirmed only the production webhook remained. The enhanced one accepted the type filter `UPGRADE_PROGRAM_INSTRUCTION`.

## Cost per month at the COSTS.md rates (1 credit per event or call, $5 per million credits)

| design | credits per month | marginal cost |
|---|---|---|
| Raw webhook on the loader, no filter | 12,000 x 720 = 8.6M | about $43 (most of a whole 10M-credit plan) |
| Polling: signatures on the public RPC, `getTransaction` on every signature | 8.6M | about $43, no saving |
| Enhanced webhook with type filter `UPGRADE_PROGRAM_INSTRUCTION`, **if** only matching events are delivered and billed | about 1,700 events (2.3 per hour) | about $0.01 |

The third row is the only cheap one and it is UNVERIFIED in two ways: I did not check that Helius bills only delivered events when a type filter is set, and I did not check that its type list covers authority changes (only `UPGRADE_PROGRAM_INSTRUCTION` was tried). A 30-minute test with a local receiver would settle both; at 2.3 upgrades per hour it would see only a handful of events.

## Verdict: NO-GO as described

- Volume: even the cheap design posts roughly 55 upgrades a day (94 with authority changes), almost all for programs nobody has heard of. That is a firehose, not a feed people follow.
- Funnel: nothing measured shows that readers of such a channel become bot users. The only thing the numbers prove is that the data is cheap to get if the Helius filter behaves.
- Risk: a public bot-promoting channel needs ongoing moderation of its own.

If the operator wants to pursue it anyway, the smallest next step is the 30-minute filtered-webhook test (about 100 credits to create and delete, a few events), and a curated version: only upgrades of programs above an activity threshold, posted as a daily digest instead of one message each.
