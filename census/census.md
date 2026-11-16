# Solana program upgrade-authority census

Read from mainnet RPC (finalized) on **2026-11-16T06:28:39.592Z**, slots 470030419 to 470030423. 407 RPC calls. Every authority, programdata address and deploy slot below is a chain read (scripts/census.mjs); nothing comes from memory.
Programs: the 25 named programs whose ids a fetch agent read on the protocol's own docs or GitHub page on 16 Nov 2026 (census/seeds.json, source per row), then the most-invoked programs of a real block sample (40 finalized blocks, 12257 transactions, 2026-11-16T05:17:44.000Z to 2026-11-16T06:20:11.000Z), named from their on-chain Anchor IDL when one exists. A name shown as "unlabelled" means no source for the name was found; the id is still read from the chain.

## Headline

- **18 of 50 upgradeable programs are controlled by a single key** (an ordinary wallet that can replace the program's code alone).
- 22 sit behind a Squads multisig vault, 8 behind a program-controlled address that is not Squads or Realms, 1 behind governance, 1 behind a program-owned account.
- 7 programs in the list are immutable (upgrade authority None): Metaplex Token Metadata, Squads v4, Squads v3, unlabelled Toke...Q5DA, unlabelled ATok...8knL, unlabelled L2TE...3S95, unlabelled Memo...fcHr.

Reading a type: "single key" = the authority is on the ed25519 curve and owned by the System program. "Squads vault" = the authority is a PDA (off the curve) and its newest transaction invokes the Squads program (that is how a Squads v3/v4 vault looks on chain: a PDA, not an account the Squads program owns). "PDA, controller not Squads or Realms" = off the curve, newest transaction invokes neither: another program controls it (the census does not say which). The type was read once; the live authority is on the specula landing page.

## Table

| # | Program | Program id | Upgrade authority | Type | Last deploy (slot) | Name source | ProgramData tx/day |
|---|---|---|---|---|---|---|---|
| 1 | PumpSwap AMM | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` | `7gZufwwAo17y5kg8FMyJy2phgpvv9RSdzWtdXiWHjFr8` | Squads v4 vault (PDA) | 469811067 | docs or GitHub page (id_source) | 84.601 |
| 2 | Pump.fun bonding curve | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` | `7gZufwwAo17y5kg8FMyJy2phgpvv9RSdzWtdXiWHjFr8` | Squads v4 vault (PDA) | 469811025 | docs or GitHub page (id_source) | 207.468 |
| 3 | Meteora DAMM v2 | `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG` | `JADaUV8kvDpDbJr55wxXJHVaBS3VCj8thZZHjfeuCVLd` | Squads v3 vault (PDA) | 457080014 | docs or GitHub page (id_source) | 82.99 |
| 4 | Jupiter Swap v6 | `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` | `CvQZZ23qYDWF2RUpxYJ8y9K4skmuvYEEjH7fK58jtipQ` | PDA, controller not Squads or Realms | 468023491 | docs or GitHub page (id_source) | 0.236 |
| 5 | Meteora DLMM | `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo` | `JADaUV8kvDpDbJr55wxXJHVaBS3VCj8thZZHjfeuCVLd` | Squads v3 vault (PDA) | 423977638 | docs or GitHub page (id_source) | 77.636 |
| 6 | Orca Whirlpools | `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` | `GwH3Hiv5mACLX3ufTw1pFsrhSPon5tdw252DBs4Rx4PV` | Squads v4 vault (PDA) | 457152296 | docs or GitHub page (id_source) | 83.57 |
| 7 | Raydium CLMM | `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK` | `FytDrVzDybM1TwFQPGb8qaxZR7dBCzNeqT3vtQsceZQK` | Squads v4 vault (PDA) | 459932378 | docs or GitHub page (id_source) | 76.714 |
| 8 | Meteora Dynamic Bonding Curve | `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN` | `JADaUV8kvDpDbJr55wxXJHVaBS3VCj8thZZHjfeuCVLd` | Squads v3 vault (PDA) | 457502600 | docs or GitHub page (id_source) | 1.091 |
| 9 | Raydium AMM v4 | `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8` | `FytDrVzDybM1TwFQPGb8qaxZR7dBCzNeqT3vtQsceZQK` | Squads v4 vault (PDA) | 445763204 | docs or GitHub page (id_source) | 65.404 |
| 10 | Raydium CP-Swap | `CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C` | `FytDrVzDybM1TwFQPGb8qaxZR7dBCzNeqT3vtQsceZQK` | Squads v4 vault (PDA) | 463522946 | docs or GitHub page (id_source) | 69.901 |
| 11 | Meteora Dynamic AMM | `Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB` | `JADaUV8kvDpDbJr55wxXJHVaBS3VCj8thZZHjfeuCVLd` | Squads v3 vault (PDA) | 468782174 | docs or GitHub page (id_source) | 0.088 |
| 12 | Kamino Lend | `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` | `GzFgdRJXmawPhGeBsyRCDLx4jAKPsvbUqoqitzppkzkW` | PDA, controller not Squads or Realms | 461744249 | docs or GitHub page (id_source) | 0.485 |
| 13 | Kamino Vaults | `KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd` | `GzFgdRJXmawPhGeBsyRCDLx4jAKPsvbUqoqitzppkzkW` | PDA, controller not Squads or Realms | 461660004 | docs or GitHub page (id_source) | 0.049 |
| 14 | Kamino Farms | `FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr` | `CivjSDKgTpmkRNL4zYcmv9D9QqPJg6yTxBVxMGcXvMuY` | Squads v4 vault (PDA) | 444035168 | docs or GitHub page (id_source) | 0.029 |
| 15 | Drift v2 | `dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH` | `8jj7zJgdr5bDndc7evM74FMGwzLPmd4u4QxNzFi1BMai` | Squads v4 vault (PDA) | 429731225 | docs or GitHub page (id_source) | 0.181 |
| 16 | Marginfi v2 | `MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA` | `J3oBkTkDXU3TcAggJEa3YeBZE5om5yNAdTtLVNXFD47` | Squads v4 vault (PDA) | 465361726 | docs or GitHub page (id_source) | 0.093 |
| 17 | Marinade liquid staking | `MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD` | `551FBXSXdhcRDDkdcb3ThDRg84Mwe5Zs6YjJ1EEoyzBp` | PDA, controller not Squads or Realms | 433290841 | docs or GitHub page (id_source) | 33.289 |
| 18 | Metaplex Core | `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d` | `bfQVv6niKVgEURYqQ1beJmiEQQN7MrvLRvk3mZGFubb` | Squads v3 vault (PDA) | 455005931 | docs or GitHub page (id_source) | 0.04 |
| 19 | Metaplex Token Metadata | `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s` | none | immutable | 380725176 | docs or GitHub page (id_source) | 0.071 |
| 20 | Mango v4 | `4MangoMjqJ2firMokCjjGgoK8d4MXcrgL7XJaL3w6fVg` | `FP4PxqHTVzeG2c6eZd7974F9WvKUSdBeduUK3rjYyvBw` | program-owned account | 330008833 | docs or GitHub page (id_source) | 0.041 |
| 21 | Pyth Solana receiver | `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` | `6oXTdojyfDS8m5VtTaYB9xRCxpKGSvKJFndLUPV3V3wT` | PDA, controller not Squads or Realms | 327047637 | docs or GitHub page (id_source) | 0.05 |
| 22 | Squads v4 | `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf` | none | immutable | 302582236 | docs or GitHub page (id_source) | 0.018 |
| 23 | Squads v3 | `SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu` | none | immutable | 178977035 | docs or GitHub page (id_source) | 0.01 |
| 24 | Phoenix v1 | `PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY` | `8mv7G3fJq5a5ej7E14vgcSGeQKH79emjU9fVfuhyitEq` | PDA, controller not Squads or Realms | 231433470 | docs or GitHub page (id_source) | 0.008 |
| 25 | OpenBook v2 | `opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb` | `CZoAmQErbMwhSNA5WtbWLcwGE1mhXEv4hTvyvvHXGkrr` | governance | 250859864 | docs or GitHub page (id_source) | 0.013 |
| 26 | unlabelled Toke...Q5DA | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | none | immutable | 419472000 | none found | 44.919 |
| 27 | token-2022 (SPL Token-2022) | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | `AeLmXCbPaQHGWRLr2saFsEVfmMNuKnxRAbWCT9P5twgz` | Squads v3 vault (PDA) | 460497271 | OtterSec verify registry, verified build: https://github.com/solana-program/token-2022/tree/8867f751c0f69367ba03af4f85510b5611989491 (verify.osec.io/status-all/<id>, read 16 Nov 2026) | 44.304 |
| 28 | unlabelled ATok...8knL | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` | none | bpf-loader-2 (immutable) |  | none found |  |
| 29 | pump_fees | `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ` | `7gZufwwAo17y5kg8FMyJy2phgpvv9RSdzWtdXiWHjFr8` | Squads v4 vault (PDA) | 456132171 | on-chain IDL | 22.117 |
| 30 | unlabelled L2TE...3S95 | `L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95` | none | immutable | 294179293 | none found | 0.017 |
| 31 | unlabelled Etrn...jWih | `EtrnLzgbS7nMMy5fbD42kXiUzGg8XQzJ972Xtk1cjWih` | `GPgADQrhzGoUgLqxsZMKvSpwcLaJFVTq6gEixKhmcwpm` | Squads v4 vault (PDA) | 468612424 | none found | 0.532 |
| 32 | unlabelled ojh1...orch | `ojh19ojaKduoJZuaJADhcVGp4xt1TcdAvZmpVsCorch` | `F6qazjHEsMwHowDpLEVbwyJrtczPBecgYtFFTeptz862` | single key | 468079633 | none found | 0.102 |
| 33 | unlabelled BiSo...Uypi | `BiSoNHVpsVZW2F7rx2eQ59yQwKxzU5NvBcmKshCSUypi` | `6dDjBZdpafRKe7WuVHYTF1HphW1BWiKqioMD5eBGYipS` | single key | 464563291 | none found | 317.604 |
| 34 | unlabelled Tri3...vSo4 | `Tri3NG4HkZ6DddYPKoX2ehgkqFtDuej9Aspw5BmvSo4` | `thxNtkTCcsZY45eA4R67wkJBEgLi5ERCPm93fZRxY4B` | single key | 452701164 | none found | 0.154 |
| 35 | unlabelled dijk...1mBu | `dijkbkCAKfFTCxQg3u1pg82gVU1jJGHBBRcteD11mBu` | `BBvfpKqYovhzEjS4Ch1xZXFdxkaoUiXsujR9kgN1t8iR` | PDA, controller not Squads or Realms | 466119099 | none found | 0.015 |
| 36 | unlabelled tick...WY6N | `tickUcsEQegChaAuo9VYQQztB4ZGApY6ZT4FkULWY6N` | `DzxY3eGHb8qVfxSAmeqkTQEFiQ5XVmEfejNqZtdWyL2x` | single key | 437433498 | none found | 0.039 |
| 37 | jito_tip_distribution | `4R3gSG8BpU4t19KYj8CfnbtRpnT8gtk4dvTHxVRwc2r7` | `4ivLcnNLhe4cKdpV9b4jyEmxgbYWFgktHcTyyBvYavsD` | PDA, controller not Squads or Realms | 403585576 | on-chain IDL | 0.01 |
| 38 | unlabelled Rout...xxpb | `RouterBmuRBkPUbgEDMtdvTZ75GBdSREZR5uGUxxxpb` | `8EP3VommYzMRSdnSn88GnQpxjRwxg6nroTeUNJoqu9b8` | Squads v4 vault (PDA) | 436000011 | none found | 0.021 |
| 39 | unlabelled Memo...fcHr | `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` | none | bpf-loader-2 (immutable) |  | none found |  |
| 40 | unlabelled Diab...xc5z | `DiabLokxisGR8P4Qqp2QL6PmBhhVsdzPstCE4WoLxc5z` | `DiABuyNFgAFuMJGPDjRc1qSvWm345n7sk3DXz4jo3fbR` | single key | 461568652 | none found | 0.207 |
| 41 | unlabelled oraf...cwiD | `orafZ4BdfzikRRg498P23vG3EdEyMR7bYoYcD2zcwiD` | `6YrRV52Eq3qmWYyMsq9Wn3kCTokk1xYQJgpKQTWrKj7b` | Squads v4 vault (PDA) | 457296652 | none found | 0.054 |
| 42 | unlabelled 2DNb...Ksbh | `2DNbzPochEcyCcWMbL4d9S3u9QqQEj5bbe6cSZFvKsbh` | `6dDjBZdpafRKe7WuVHYTF1HphW1BWiKqioMD5eBGYipS` | single key | 456171250 | none found | 0.298 |
| 43 | unlabelled 8NDj...Mt9m | `8NDj9qLWYzvW7KXaetseTDvTFCZ5NSi3SmoSjFNMMt9m` | `2syEZcxCKfJm1Ht1xaxCENK5Hi5C4kjAh9LHbEabq83j` | single key | 465654030 | none found | 0.092 |
| 44 | unlabelled Arch...PMhy | `Archer8kgiavM61GyusMzaaS2ft5sALtNsD1HxkUPMhy` | `Hfj4HDxLqdj4k9FB3eZeURf4sZtu3w9aJMRfctmXR66P` | Squads v4 vault (PDA) | 460513991 | none found | 0.191 |
| 45 | unlabelled CZqF...6xw5 | `CZqFPJ35PQT1Jx2o3QAirY8pdTQp7tErJsiQm2GD6xw5` | `5uKenX4vksBKurpTeezen9gtJCBpKTzKQEVU52W5gX4y` | single key | 462075912 | none found | 0.151 |
| 46 | unlabelled 7JwT...94ZG | `7JwTi9ambvCTYwZbNQEZA8hzpG3ymPWRZpAxgKPJ94ZG` | `3ntEpydDjraXrnwWTCJM7DvfBvtYUMc7q1oHADMCoFuK` | single key | 468194880 | none found | 0.291 |
| 47 | unlabelled W1LD...1bWR | `W1LDCARDa67SPBG7TFpQivHnEZXRtxCFP13ysEd1bWR` | `UPgd1zNpfgYRRcudZyubhKPrrYKL7vKRmw25SR6qto5` | single key | 464575187 | none found | 0.208 |
| 48 | unlabelled BevF...56A3 | `BevFQ2LKT3riywRANkmWWKE5dksoTkpCtn7B1uzp56A3` | `4oiHK6qkZ7eaH5FFybByvDQA7pZ65EusAx1eeApVqT3w` | single key | 454578217 | none found | 9.213 |
| 49 | unlabelled Dhpy...84HY | `DhpyNWkdxFh3DRPsBrwRwrK3TYC5t7Q4arnSvf3t84HY` | `2KP9miexioqgNbjPwysggcbi3sKqhH8JsPaDmFxRPURD` | single key | 454813567 | none found | 0.182 |
| 50 | unlabelled ERfh...sm5e | `ERfhoTm5C4cQ1U7M2K5R83nnCzWMqZr9Df21Nzx4sm5e` | `5uKenX4vksBKurpTeezen9gtJCBpKTzKQEVU52W5gX4y` | single key | 462746197 | none found | 0.039 |
| 51 | unlabelled SCoR...3mqn | `SCoRcH8c2dpjvcJD6FiPbCSQyQgu3PcUAWj2Xxx3mqn` | `6km771wAtWmH16R8fsRp8zEUduDFPF1vtEXWTx4buiWZ` | single key | 464463313 | none found | 0.068 |
| 52 | unlabelled 9mnw...VKH5 | `9mnwcoqeBRLdRx9khMXF7FyWxVu8JnXD7yjTcUJKVKH5` | `BkqUjSoMfyrW2KZbGfm9X75Ci3bFcbyE1msMeCqtoRrx` | single key | 467767148 | none found | 0.713 |
| 53 | unlabelled 3hNt...dGba | `3hNtuoujqHmPUCDu9r1HSQgK7mVrBN46qDXPPwD4dGba` | `9mUJpAkMf9y6Ju7R3s8uZy8Tn7pdy4fTL72ki4zDM8op` | single key | 463957098 | none found | 0.283 |
| 54 | unlabelled MAyh...MD4e | `MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e` | `7gZufwwAo17y5kg8FMyJy2phgpvv9RSdzWtdXiWHjFr8` | Squads v4 vault (PDA) | 452655053 | none found | 0.04 |
| 55 | unlabelled FLAS...txB9 | `FLASHX8DrLbgeR8FcfNV1F5krxYcYMUdBkrP1EPBtxB9` | `AxDepcBgxQXcEYTQokwbyR6D8R4fxF6aAQMs8Kr2TmjW` | single key | 467825541 | none found | 0.194 |
| 56 | unlabelled Em9B...f1Rs | `Em9BQtEaBVkoAtx6kxqJAMFTQoHoxJR41pwPXEPAf1Rs` | `6hsiGApHFh7MvX93uNion6s4E4YuXzaVNw8VVmerzGxr` | single key | 469821674 | none found | 1.924 |
| 57 | swap_orchestrator | `DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH` | `9uo2iJKJkmiYwy5MrkrbGQXbPqwHXqvQaUqxhCkowgsh` | Squads v4 vault (PDA) | 469017374 | on-chain IDL | 317.638 |

## What it costs to watch these (Helius free plan, measured 16 Nov 2026 06:32 UTC)

- Plan: free, 1,000,000 credits for 9 Nov to 9 Dec. Used 467,726, remaining 532,274. Burn 64,314 a day (webhooks 59,572 for the one watched program KLend, RPC 4,743). At that burn the credits run out on **24 Nov**, 15 days before the cycle ends.
- 30% of the remaining credits = 159,682 = 7,026 a day for the rest of the cycle.
- Measured per call (usage endpoint before and after): getMultipleAccounts of 60 addresses = 1 credit; getSignaturesForAddress = 1; getTransaction = 1; one webhook event = 1.
- Watching a ProgramData address with a webhook plus a 5-minute reconcile would cost about 318 credits per address per day on average (events: mean 30.0, max 317.638 a day, plus 288 polls): about 22 programs would fit the 30%.
- Reading the 50 ProgramData accounts as state in ONE getMultipleAccounts call every 60 s costs 1,440 credits a day for all of them (28.8 per program per day), 32,731 credits to the end of the cycle = 20% of the 30% budget. That is what the feed does.

## Labelling attempt, 16 Nov 2026 (the 28 programs that had no name)
Sources tried for every one: on-chain Anchor IDL (3 had one: pump_fees, jito_tip_distribution, swap_orchestrator), the OtterSec verify registry (verify.osec.io/status-all/<id>), SolanaFM (API answered 502), Solscan (403), Solana Explorer (429), a web search per id (blocked by a bot challenge). Result: **1 more label** (the Token-2022 program: OtterSec verified build of github.com/solana-program/token-2022, cited in its Name source cell) and **24 programs stay unlabelled** because no source I could read names them. They keep their program id, authority and type, all read from the chain.
