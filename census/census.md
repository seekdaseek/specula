# Solana program upgrade-authority census

Read from mainnet RPC (finalized) on **2026-11-16T06:28:39.592Z**, slots 470030419 to 470030423; activity and Squads depth read 2026-11-16T11:10:21.042Z. 913 RPC calls. Every authority, programdata address, deploy slot, activity count and multisig field below is a chain read (scripts/census.mjs, scripts/census-depth.mjs); nothing comes from memory.

## How the 50 programs were chosen

- **29 named programs.** 22 are programs whose ids a fetch agent read on the protocol's own docs or GitHub page on 16 Nov 2026 (census/seeds.json, source per row); 1 is named from the OtterSec verified-build registry (Token-2022); 3 from their own on-chain Anchor IDL; 3 from the security.txt inside the program's ELF (the project's own declaration of its name).
- **21 other watched programs.** They were not picked for being important. They are the upgradeable programs, after the named ones, that appeared in the most transactions of ONE sample: 40 finalized blocks (12257 transactions, 2026-11-16T05:17:44.000Z to 2026-11-16T06:20:11.000Z), counting a program once per transaction that invokes it at any depth, taken in that order until the list reached 50 upgradeable programs. A different hour would give a different tail. Native and token programs (System, Compute Budget, Token, ATA, Memo and the like) are not upgradeable and drop out.
- No name for these 21 was found by any source I could read (on-chain IDL, the program's security.txt, OtterSec verify registry, SolanaFM, Solscan, web search); they are shown by id and are NOT claimed to be major or important. Each was checked for activity (below).

## Headline

- **18 of 50 upgradeable programs are controlled by a single key** (an ordinary wallet that can replace the program's code alone); 0 of them are named, 18 are other watched programs.
- 16 sit behind a Squads v4 vault and 6 behind a Squads v3 vault; 8 behind a program-controlled address that is not Squads or Realms, 1 behind governance, 1 behind a program-owned account.
- **Squads depth** (the multisig behind each vault, read from the chain and accepted only when its vault PDA re-derives to the authority): 21 decoded. Among the 19 named programs behind Squads: **0 are 1-of-N**, **10 have time_lock 0** (of 13 Squads v4 multisigs; v3 has no time lock field: 6 v3). Across all 21: 0 are 1-of-N, 12 of 15 v4 multisigs have time_lock 0, median threshold 3.
- 7 programs in the list are immutable (upgrade authority None): Metaplex Token Metadata, Squads v4, Squads v3, other watched program Toke...Q5DA, other watched program ATok...8knL, other watched program L2TE...3S95, other watched program Memo...fcHr.

Reading a type: "single key" = the authority is on the ed25519 curve and owned by the System program. "Squads vault" = the authority is a PDA (off the curve) whose newest transaction invokes Squads, and (depth) a Squads multisig account exists whose vault PDA equals the authority. "PDA, controller not Squads or Realms" = off the curve, newest transaction invokes neither. Threshold = signatures needed; members = signers on the multisig; time lock = delay between approval and execution (v4 only); config authority = who can change the multisig without a vote (v4: "none (autonomous)" means the multisig governs itself).

Activity verdict, from the program id's signatures (RPC cap 1,000): **real active protocol** = at least 100 transactions in the last 7 days; **low-activity** = 1 to 99; **dormant** = none in 7 days.

## The 18 single-key programs

| Program | Program id | Authority | Last deploy | First programdata tx (age) | Tx in 7 days | Authority signed in 30 days | security.txt | Verdict |
|---|---|---|---|---|---|---|---|---|
| other watched program ojh1...orch | `ojh19ojaKduoJZuaJADhcVGp4xt1TcdAvZmpVsCorch` | `F6qazjHEsMwHowDpLEVbwyJrtczPBecgYtFFTeptz862` | 2026-11-11 | 2025-11-28 (353 d) | 1000+ (cap) | yes (last 2026-11-11) | none in the ELF | real active protocol |
| other watched program BiSo...Uypi | `BiSoNHVpsVZW2F7rx2eQ59yQwKxzU5NvBcmKshCSUypi` | `6dDjBZdpafRKe7WuVHYTF1HphW1BWiKqioMD5eBGYipS` | 2026-11-02 | 2026-10-08 (39 d+) | 1000+ (cap) | yes (last 2026-11-02) | none in the ELF | real active protocol |
| other watched program Tri3...vSo4 | `Tri3NG4HkZ6DddYPKoX2ehgkqFtDuej9Aspw5BmvSo4` | `thxNtkTCcsZY45eA4R67wkJBEgLi5ERCPm93fZRxY4B` | 2026-10-02 | 2026-07-09 (130 d) | 1000+ (cap) | no | none in the ELF | real active protocol |
| other watched program tick...WY6N | `tickUcsEQegChaAuo9VYQQztB4ZGApY6ZT4FkULWY6N` | `DzxY3eGHb8qVfxSAmeqkTQEFiQ5XVmEfejNqZtdWyL2x` | 2026-08-05 | 2026-08-05 (103 d) | 1000+ (cap) | no | none in the ELF | real active protocol |
| other watched program Diab...xc5z | `DiabLokxisGR8P4Qqp2QL6PmBhhVsdzPstCE4WoLxc5z` | `DiABuyNFgAFuMJGPDjRc1qSvWm345n7sk3DXz4jo3fbR` | 2026-10-26 | 2026-10-03 (44 d) | 1000+ (cap) | yes (last 2026-11-16) | none in the ELF | real active protocol |
| other watched program 2DNb...Ksbh | `2DNbzPochEcyCcWMbL4d9S3u9QqQEj5bbe6cSZFvKsbh` | `6dDjBZdpafRKe7WuVHYTF1HphW1BWiKqioMD5eBGYipS` | 2026-10-12 | 2026-03-19 (242 d) | 1000+ (cap) | yes (last 2026-11-02) | none in the ELF | real active protocol |
| other watched program 8NDj...Mt9m | `8NDj9qLWYzvW7KXaetseTDvTFCZ5NSi3SmoSjFNMMt9m` | `2syEZcxCKfJm1Ht1xaxCENK5Hi5C4kjAh9LHbEabq83j` | 2026-11-05 | 2026-11-05 (11 d) | 1000+ (cap) | yes (last 2026-11-05) | none in the ELF | real active protocol |
| other watched program CZqF...6xw5 | `CZqFPJ35PQT1Jx2o3QAirY8pdTQp7tErJsiQm2GD6xw5` | `5uKenX4vksBKurpTeezen9gtJCBpKTzKQEVU52W5gX4y` | 2026-10-27 | 2026-10-27 (20 d) | 1000+ (cap) | yes (last 2026-10-29) | none in the ELF | real active protocol |
| other watched program 7JwT...94ZG | `7JwTi9ambvCTYwZbNQEZA8hzpG3ymPWRZpAxgKPJ94ZG` | `3ntEpydDjraXrnwWTCJM7DvfBvtYUMc7q1oHADMCoFuK` | 2026-11-11 | 2026-05-31 (169 d) | 1000+ (cap) | yes (last 2026-11-11) | none in the ELF | real active protocol |
| other watched program W1LD...1bWR | `W1LDCARDa67SPBG7TFpQivHnEZXRtxCFP13ysEd1bWR` | `UPgd1zNpfgYRRcudZyubhKPrrYKL7vKRmw25SR6qto5` | 2026-11-02 | 2026-05-22 (178 d) | 1000+ (cap) | yes (last 2026-11-02) | none in the ELF | real active protocol |
| other watched program BevF...56A3 | `BevFQ2LKT3riywRANkmWWKE5dksoTkpCtn7B1uzp56A3` | `4oiHK6qkZ7eaH5FFybByvDQA7pZ65EusAx1eeApVqT3w` | 2026-10-08 | 2026-06-15 (154 d) | 1000+ (cap) | no | none in the ELF | real active protocol |
| other watched program Dhpy...84HY | `DhpyNWkdxFh3DRPsBrwRwrK3TYC5t7Q4arnSvf3t84HY` | `2KP9miexioqgNbjPwysggcbi3sKqhH8JsPaDmFxRPURD` | 2026-10-09 | 2026-07-23 (116 d) | 1000+ (cap) | yes (last 2026-11-16) | none in the ELF | real active protocol |
| other watched program ERfh...sm5e | `ERfhoTm5C4cQ1U7M2K5R83nnCzWMqZr9Df21Nzx4sm5e` | `5uKenX4vksBKurpTeezen9gtJCBpKTzKQEVU52W5gX4y` | 2026-10-29 | 2026-08-31 (77 d) | 1000+ (cap) | yes (last 2026-10-29) | none in the ELF | real active protocol |
| other watched program SCoR...3mqn | `SCoRcH8c2dpjvcJD6FiPbCSQyQgu3PcUAWj2Xxx3mqn` | `6km771wAtWmH16R8fsRp8zEUduDFPF1vtEXWTx4buiWZ` | 2026-11-02 | 2025-11-28 (353 d) | 1000+ (cap) | yes (last 2026-11-02) | none in the ELF | real active protocol |
| other watched program 9mnw...VKH5 | `9mnwcoqeBRLdRx9khMXF7FyWxVu8JnXD7yjTcUJKVKH5` | `BkqUjSoMfyrW2KZbGfm9X75Ci3bFcbyE1msMeCqtoRrx` | 2026-11-10 | 2026-10-31 (16 d) | 1000+ (cap) | yes (last 2026-11-10) | none in the ELF | real active protocol |
| other watched program 3hNt...dGba | `3hNtuoujqHmPUCDu9r1HSQgK7mVrBN46qDXPPwD4dGba` | `9mUJpAkMf9y6Ju7R3s8uZy8Tn7pdy4fTL72ki4zDM8op` | 2026-11-01 | 2026-10-15 (32 d) | 1000+ (cap) | yes (last 2026-11-01) | none in the ELF | real active protocol |
| other watched program FLAS...txB9 | `FLASHX8DrLbgeR8FcfNV1F5krxYcYMUdBkrP1EPBtxB9` | `AxDepcBgxQXcEYTQokwbyR6D8R4fxF6aAQMs8Kr2TmjW` | 2026-11-10 | 2025-11-29 (351 d) | 1000+ (cap) | yes (last 2026-11-10) | none in the ELF | real active protocol |
| other watched program Em9B...f1Rs | `Em9BQtEaBVkoAtx6kxqJAMFTQoHoxJR41pwPXEPAf1Rs` | `6hsiGApHFh7MvX93uNion6s4E4YuXzaVNw8VVmerzGxr` | 2026-11-15 | 2026-11-15 (1 d) | 1000+ (cap) | yes (last 2026-11-16) | none in the ELF | real active protocol |

## Table (all watched programs)

| # | Group | Program | Program id | Upgrade authority | Type | Threshold | Time lock | Config authority | Last deploy (slot) | Name source |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | named | PumpSwap AMM | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` | `7gZufwwAo17y5kg8FMyJy2phgpvv9RSdzWtdXiWHjFr8` | Squads v4 vault (PDA) | 3 of 4 | none | none (autonomous) | 469811067 | docs or GitHub page (id_source) |
| 2 | named | Pump.fun bonding curve | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` | `7gZufwwAo17y5kg8FMyJy2phgpvv9RSdzWtdXiWHjFr8` | Squads v4 vault (PDA) | 3 of 4 | none | none (autonomous) | 469811025 | docs or GitHub page (id_source) |
| 3 | named | Meteora DAMM v2 | `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG` | `JADaUV8kvDpDbJr55wxXJHVaBS3VCj8thZZHjfeuCVLd` | Squads v3 vault (PDA) | 4 of 7 | n/a (v3) | `n/a (v3: changes go through the multisig itself)` | 457080014 | docs or GitHub page (id_source) |
| 4 | named | Jupiter Swap v6 | `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` | `CvQZZ23qYDWF2RUpxYJ8y9K4skmuvYEEjH7fK58jtipQ` | PDA, controller not Squads or Realms |  |  |  | 468023491 | docs or GitHub page (id_source) |
| 5 | named | Meteora DLMM | `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo` | `JADaUV8kvDpDbJr55wxXJHVaBS3VCj8thZZHjfeuCVLd` | Squads v3 vault (PDA) | 4 of 7 | n/a (v3) | `n/a (v3: changes go through the multisig itself)` | 423977638 | docs or GitHub page (id_source) |
| 6 | named | Orca Whirlpools | `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` | `GwH3Hiv5mACLX3ufTw1pFsrhSPon5tdw252DBs4Rx4PV` | Squads v4 vault (PDA) | 5 of 13 | 24 h | none (autonomous) | 457152296 | docs or GitHub page (id_source) |
| 7 | named | Raydium CLMM | `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK` | `FytDrVzDybM1TwFQPGb8qaxZR7dBCzNeqT3vtQsceZQK` | Squads v4 vault (PDA) | 3 of 4 | none | none (autonomous) | 459932378 | docs or GitHub page (id_source) |
| 8 | named | Meteora Dynamic Bonding Curve | `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN` | `JADaUV8kvDpDbJr55wxXJHVaBS3VCj8thZZHjfeuCVLd` | Squads v3 vault (PDA) | 4 of 7 | n/a (v3) | `n/a (v3: changes go through the multisig itself)` | 457502600 | docs or GitHub page (id_source) |
| 9 | named | Raydium AMM v4 | `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8` | `FytDrVzDybM1TwFQPGb8qaxZR7dBCzNeqT3vtQsceZQK` | Squads v4 vault (PDA) | 3 of 4 | none | none (autonomous) | 445763204 | docs or GitHub page (id_source) |
| 10 | named | Raydium CP-Swap | `CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C` | `FytDrVzDybM1TwFQPGb8qaxZR7dBCzNeqT3vtQsceZQK` | Squads v4 vault (PDA) | 3 of 4 | none | none (autonomous) | 463522946 | docs or GitHub page (id_source) |
| 11 | named | Meteora Dynamic AMM | `Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB` | `JADaUV8kvDpDbJr55wxXJHVaBS3VCj8thZZHjfeuCVLd` | Squads v3 vault (PDA) | 4 of 7 | n/a (v3) | `n/a (v3: changes go through the multisig itself)` | 468782174 | docs or GitHub page (id_source) |
| 12 | named | Kamino Lend | `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` | `GzFgdRJXmawPhGeBsyRCDLx4jAKPsvbUqoqitzppkzkW` | PDA, controller not Squads or Realms |  |  |  | 461744249 | docs or GitHub page (id_source) |
| 13 | named | Kamino Vaults | `KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd` | `GzFgdRJXmawPhGeBsyRCDLx4jAKPsvbUqoqitzppkzkW` | PDA, controller not Squads or Realms |  |  |  | 461660004 | docs or GitHub page (id_source) |
| 14 | named | Kamino Farms | `FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr` | `CivjSDKgTpmkRNL4zYcmv9D9QqPJg6yTxBVxMGcXvMuY` | Squads v4 vault (PDA) | 5 of 10 | 24 h | none (autonomous) | 444035168 | docs or GitHub page (id_source) |
| 15 | named | Drift v2 | `dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH` | `8jj7zJgdr5bDndc7evM74FMGwzLPmd4u4QxNzFi1BMai` | Squads v4 vault (PDA) | 4 of 6 | 1 h | none (autonomous) | 429731225 | docs or GitHub page (id_source) |
| 16 | named | Marginfi v2 | `MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA` | `J3oBkTkDXU3TcAggJEa3YeBZE5om5yNAdTtLVNXFD47` | Squads v4 vault (PDA) | 7 of 14 | none | none (autonomous) | 465361726 | docs or GitHub page (id_source) |
| 17 | named | Marinade liquid staking | `MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD` | `551FBXSXdhcRDDkdcb3ThDRg84Mwe5Zs6YjJ1EEoyzBp` | PDA, controller not Squads or Realms |  |  |  | 433290841 | docs or GitHub page (id_source) |
| 18 | named | Metaplex Core | `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d` | `bfQVv6niKVgEURYqQ1beJmiEQQN7MrvLRvk3mZGFubb` | Squads v3 vault (PDA) | 2 of 5 | n/a (v3) | `n/a (v3: changes go through the multisig itself)` | 455005931 | docs or GitHub page (id_source) |
| 19 | named | Metaplex Token Metadata | `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s` | none | immutable |  |  |  | 380725176 | docs or GitHub page (id_source) |
| 20 | named | Mango v4 | `4MangoMjqJ2firMokCjjGgoK8d4MXcrgL7XJaL3w6fVg` | `FP4PxqHTVzeG2c6eZd7974F9WvKUSdBeduUK3rjYyvBw` | program-owned account |  |  |  | 330008833 | docs or GitHub page (id_source) |
| 21 | named | Pyth Solana receiver | `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` | `6oXTdojyfDS8m5VtTaYB9xRCxpKGSvKJFndLUPV3V3wT` | PDA, controller not Squads or Realms |  |  |  | 327047637 | docs or GitHub page (id_source) |
| 22 | named | Squads v4 | `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf` | none | immutable |  |  |  | 302582236 | docs or GitHub page (id_source) |
| 23 | named | Squads v3 | `SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu` | none | immutable |  |  |  | 178977035 | docs or GitHub page (id_source) |
| 24 | named | Phoenix v1 | `PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY` | `8mv7G3fJq5a5ej7E14vgcSGeQKH79emjU9fVfuhyitEq` | PDA, controller not Squads or Realms |  |  |  | 231433470 | docs or GitHub page (id_source) |
| 25 | named | OpenBook v2 | `opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb` | `CZoAmQErbMwhSNA5WtbWLcwGE1mhXEv4hTvyvvHXGkrr` | governance |  |  |  | 250859864 | docs or GitHub page (id_source) |
| 26 | other watched | other watched program Toke...Q5DA | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | none | immutable |  |  |  | 419472000 | none found |
| 27 | named | token-2022 (SPL Token-2022) | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | `AeLmXCbPaQHGWRLr2saFsEVfmMNuKnxRAbWCT9P5twgz` | Squads v3 vault (PDA) | 4 of 6 | n/a (v3) | `n/a (v3: changes go through the multisig itself)` | 460497271 | OtterSec verify registry, verified build: https://github.com/solana-program/token-2022/tree/8867f751c0f69367ba03af4f85510b5611989491 (verify.osec.io/status-all/<id>, read 16 Nov 2026) |
| 28 | other watched | other watched program ATok...8knL | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` | none | bpf-loader-2 (immutable) |  |  |  |  | none found |
| 29 | named | pump_fees | `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ` | `7gZufwwAo17y5kg8FMyJy2phgpvv9RSdzWtdXiWHjFr8` | Squads v4 vault (PDA) | 3 of 4 | none | none (autonomous) | 456132171 | on-chain IDL |
| 30 | other watched | other watched program L2TE...3S95 | `L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95` | none | immutable |  |  |  | 294179293 | none found |
| 31 | named | Phoenix: Eternal | `EtrnLzgbS7nMMy5fbD42kXiUzGg8XQzJ972Xtk1cjWih` | `GPgADQrhzGoUgLqxsZMKvSpwcLaJFVTq6gEixKhmcwpm` | Squads v4 vault (PDA) | 3 of 9 | none | none (autonomous) | 468612424 | security.txt in the program ELF (project_url https://phoenix.trade/) |
| 32 | other watched | other watched program ojh1...orch | `ojh19ojaKduoJZuaJADhcVGp4xt1TcdAvZmpVsCorch` | `F6qazjHEsMwHowDpLEVbwyJrtczPBecgYtFFTeptz862` | single key |  |  |  | 468079633 | none found |
| 33 | other watched | other watched program BiSo...Uypi | `BiSoNHVpsVZW2F7rx2eQ59yQwKxzU5NvBcmKshCSUypi` | `6dDjBZdpafRKe7WuVHYTF1HphW1BWiKqioMD5eBGYipS` | single key |  |  |  | 464563291 | none found |
| 34 | other watched | other watched program Tri3...vSo4 | `Tri3NG4HkZ6DddYPKoX2ehgkqFtDuej9Aspw5BmvSo4` | `thxNtkTCcsZY45eA4R67wkJBEgLi5ERCPm93fZRxY4B` | single key |  |  |  | 452701164 | none found |
| 35 | other watched | other watched program dijk...1mBu | `dijkbkCAKfFTCxQg3u1pg82gVU1jJGHBBRcteD11mBu` | `BBvfpKqYovhzEjS4Ch1xZXFdxkaoUiXsujR9kgN1t8iR` | PDA, controller not Squads or Realms |  |  |  | 466119099 | none found |
| 36 | other watched | other watched program tick...WY6N | `tickUcsEQegChaAuo9VYQQztB4ZGApY6ZT4FkULWY6N` | `DzxY3eGHb8qVfxSAmeqkTQEFiQ5XVmEfejNqZtdWyL2x` | single key |  |  |  | 437433498 | none found |
| 37 | named | jito_tip_distribution | `4R3gSG8BpU4t19KYj8CfnbtRpnT8gtk4dvTHxVRwc2r7` | `4ivLcnNLhe4cKdpV9b4jyEmxgbYWFgktHcTyyBvYavsD` | PDA, controller not Squads or Realms |  |  |  | 403585576 | on-chain IDL |
| 38 | named | Jito's MEV Tip Distribution NCN Program | `RouterBmuRBkPUbgEDMtdvTZ75GBdSREZR5uGUxxxpb` | `8EP3VommYzMRSdnSn88GnQpxjRwxg6nroTeUNJoqu9b8` | Squads v4 vault (PDA) | 4 of 7 | none | `DG76d6Akr3pzGUkE8gc3anBrSJUzH6EiXmqoX3P7ontL` | 436000011 | security.txt in the program ELF (project_url https://jito.network/) |
| 39 | other watched | other watched program Memo...fcHr | `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` | none | bpf-loader-2 (immutable) |  |  |  |  | none found |
| 40 | other watched | other watched program Diab...xc5z | `DiabLokxisGR8P4Qqp2QL6PmBhhVsdzPstCE4WoLxc5z` | `DiABuyNFgAFuMJGPDjRc1qSvWm345n7sk3DXz4jo3fbR` | single key |  |  |  | 461568652 | none found |
| 41 | other watched | other watched program oraf...cwiD | `orafZ4BdfzikRRg498P23vG3EdEyMR7bYoYcD2zcwiD` | `6YrRV52Eq3qmWYyMsq9Wn3kCTokk1xYQJgpKQTWrKj7b` | Squads v4 vault (PDA) | 2 of 2 | none | none (autonomous) | 457296652 | none found |
| 42 | other watched | other watched program 2DNb...Ksbh | `2DNbzPochEcyCcWMbL4d9S3u9QqQEj5bbe6cSZFvKsbh` | `6dDjBZdpafRKe7WuVHYTF1HphW1BWiKqioMD5eBGYipS` | single key |  |  |  | 456171250 | none found |
| 43 | other watched | other watched program 8NDj...Mt9m | `8NDj9qLWYzvW7KXaetseTDvTFCZ5NSi3SmoSjFNMMt9m` | `2syEZcxCKfJm1Ht1xaxCENK5Hi5C4kjAh9LHbEabq83j` | single key |  |  |  | 465654030 | none found |
| 44 | named | Archer Exchange | `Archer8kgiavM61GyusMzaaS2ft5sALtNsD1HxkUPMhy` | `Hfj4HDxLqdj4k9FB3eZeURf4sZtu3w9aJMRfctmXR66P` | Squads v4 vault (PDA) |  |  |  | 460513991 | security.txt in the program ELF (project_url https://archer.exchange) |
| 45 | other watched | other watched program CZqF...6xw5 | `CZqFPJ35PQT1Jx2o3QAirY8pdTQp7tErJsiQm2GD6xw5` | `5uKenX4vksBKurpTeezen9gtJCBpKTzKQEVU52W5gX4y` | single key |  |  |  | 462075912 | none found |
| 46 | other watched | other watched program 7JwT...94ZG | `7JwTi9ambvCTYwZbNQEZA8hzpG3ymPWRZpAxgKPJ94ZG` | `3ntEpydDjraXrnwWTCJM7DvfBvtYUMc7q1oHADMCoFuK` | single key |  |  |  | 468194880 | none found |
| 47 | other watched | other watched program W1LD...1bWR | `W1LDCARDa67SPBG7TFpQivHnEZXRtxCFP13ysEd1bWR` | `UPgd1zNpfgYRRcudZyubhKPrrYKL7vKRmw25SR6qto5` | single key |  |  |  | 464575187 | none found |
| 48 | other watched | other watched program BevF...56A3 | `BevFQ2LKT3riywRANkmWWKE5dksoTkpCtn7B1uzp56A3` | `4oiHK6qkZ7eaH5FFybByvDQA7pZ65EusAx1eeApVqT3w` | single key |  |  |  | 454578217 | none found |
| 49 | other watched | other watched program Dhpy...84HY | `DhpyNWkdxFh3DRPsBrwRwrK3TYC5t7Q4arnSvf3t84HY` | `2KP9miexioqgNbjPwysggcbi3sKqhH8JsPaDmFxRPURD` | single key |  |  |  | 454813567 | none found |
| 50 | other watched | other watched program ERfh...sm5e | `ERfhoTm5C4cQ1U7M2K5R83nnCzWMqZr9Df21Nzx4sm5e` | `5uKenX4vksBKurpTeezen9gtJCBpKTzKQEVU52W5gX4y` | single key |  |  |  | 462746197 | none found |
| 51 | other watched | other watched program SCoR...3mqn | `SCoRcH8c2dpjvcJD6FiPbCSQyQgu3PcUAWj2Xxx3mqn` | `6km771wAtWmH16R8fsRp8zEUduDFPF1vtEXWTx4buiWZ` | single key |  |  |  | 464463313 | none found |
| 52 | other watched | other watched program 9mnw...VKH5 | `9mnwcoqeBRLdRx9khMXF7FyWxVu8JnXD7yjTcUJKVKH5` | `BkqUjSoMfyrW2KZbGfm9X75Ci3bFcbyE1msMeCqtoRrx` | single key |  |  |  | 467767148 | none found |
| 53 | other watched | other watched program 3hNt...dGba | `3hNtuoujqHmPUCDu9r1HSQgK7mVrBN46qDXPPwD4dGba` | `9mUJpAkMf9y6Ju7R3s8uZy8Tn7pdy4fTL72ki4zDM8op` | single key |  |  |  | 463957098 | none found |
| 54 | other watched | other watched program MAyh...MD4e | `MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e` | `7gZufwwAo17y5kg8FMyJy2phgpvv9RSdzWtdXiWHjFr8` | Squads v4 vault (PDA) | 3 of 4 | none | none (autonomous) | 452655053 | none found |
| 55 | other watched | other watched program FLAS...txB9 | `FLASHX8DrLbgeR8FcfNV1F5krxYcYMUdBkrP1EPBtxB9` | `AxDepcBgxQXcEYTQokwbyR6D8R4fxF6aAQMs8Kr2TmjW` | single key |  |  |  | 467825541 | none found |
| 56 | other watched | other watched program Em9B...f1Rs | `Em9BQtEaBVkoAtx6kxqJAMFTQoHoxJR41pwPXEPAf1Rs` | `6hsiGApHFh7MvX93uNion6s4E4YuXzaVNw8VVmerzGxr` | single key |  |  |  | 469821674 | none found |
| 57 | named | swap_orchestrator | `DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH` | `9uo2iJKJkmiYwy5MrkrbGQXbPqwHXqvQaUqxhCkowgsh` | Squads v4 vault (PDA) | 2 of 2 | none | none (autonomous) | 469017374 | on-chain IDL |

## Labelling attempt, 16 Nov 2026

Sources tried for the programs without a name: on-chain Anchor IDL (3 had one), the OtterSec verify registry (1 verified: Token-2022), the program's security.txt in its ELF (0 of 21 had one; see the single-key table for any name it carries), SolanaFM (API 502), Solscan (403), Solana Explorer (429), a web search per id (blocked by a bot challenge). **21 programs stay without a name.**

## Verdicts for the other watched programs

| Program id | Authority type | Tx in 7 days | First programdata tx (age) | Verdict |
|---|---|---|---|---|
| `ojh19ojaKduoJZuaJADhcVGp4xt1TcdAvZmpVsCorch` | single key | 1000+ (cap) | 2025-11-28 (353 d) | real active protocol |
| `BiSoNHVpsVZW2F7rx2eQ59yQwKxzU5NvBcmKshCSUypi` | single key | 1000+ (cap) | 2026-10-08 (39 d+) | real active protocol |
| `Tri3NG4HkZ6DddYPKoX2ehgkqFtDuej9Aspw5BmvSo4` | single key | 1000+ (cap) | 2026-07-09 (130 d) | real active protocol |
| `dijkbkCAKfFTCxQg3u1pg82gVU1jJGHBBRcteD11mBu` | PDA, controller not Squads or Realms | 1000+ (cap) | 2025-12-11 (340 d) | real active protocol |
| `tickUcsEQegChaAuo9VYQQztB4ZGApY6ZT4FkULWY6N` | single key | 1000+ (cap) | 2026-08-05 (103 d) | real active protocol |
| `DiabLokxisGR8P4Qqp2QL6PmBhhVsdzPstCE4WoLxc5z` | single key | 1000+ (cap) | 2026-10-03 (44 d) | real active protocol |
| `orafZ4BdfzikRRg498P23vG3EdEyMR7bYoYcD2zcwiD` | Squads v4 vault (PDA) | 1000+ (cap) | 2026-06-03 (166 d) | real active protocol |
| `2DNbzPochEcyCcWMbL4d9S3u9QqQEj5bbe6cSZFvKsbh` | single key | 1000+ (cap) | 2026-03-19 (242 d) | real active protocol |
| `8NDj9qLWYzvW7KXaetseTDvTFCZ5NSi3SmoSjFNMMt9m` | single key | 1000+ (cap) | 2026-11-05 (11 d) | real active protocol |
| `CZqFPJ35PQT1Jx2o3QAirY8pdTQp7tErJsiQm2GD6xw5` | single key | 1000+ (cap) | 2026-10-27 (20 d) | real active protocol |
| `7JwTi9ambvCTYwZbNQEZA8hzpG3ymPWRZpAxgKPJ94ZG` | single key | 1000+ (cap) | 2026-05-31 (169 d) | real active protocol |
| `W1LDCARDa67SPBG7TFpQivHnEZXRtxCFP13ysEd1bWR` | single key | 1000+ (cap) | 2026-05-22 (178 d) | real active protocol |
| `BevFQ2LKT3riywRANkmWWKE5dksoTkpCtn7B1uzp56A3` | single key | 1000+ (cap) | 2026-06-15 (154 d) | real active protocol |
| `DhpyNWkdxFh3DRPsBrwRwrK3TYC5t7Q4arnSvf3t84HY` | single key | 1000+ (cap) | 2026-07-23 (116 d) | real active protocol |
| `ERfhoTm5C4cQ1U7M2K5R83nnCzWMqZr9Df21Nzx4sm5e` | single key | 1000+ (cap) | 2026-08-31 (77 d) | real active protocol |
| `SCoRcH8c2dpjvcJD6FiPbCSQyQgu3PcUAWj2Xxx3mqn` | single key | 1000+ (cap) | 2025-11-28 (353 d) | real active protocol |
| `9mnwcoqeBRLdRx9khMXF7FyWxVu8JnXD7yjTcUJKVKH5` | single key | 1000+ (cap) | 2026-10-31 (16 d) | real active protocol |
| `3hNtuoujqHmPUCDu9r1HSQgK7mVrBN46qDXPPwD4dGba` | single key | 1000+ (cap) | 2026-10-15 (32 d) | real active protocol |
| `MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e` | Squads v4 vault (PDA) | 1000+ (cap) | 2025-11-08 (373 d) | real active protocol |
| `FLASHX8DrLbgeR8FcfNV1F5krxYcYMUdBkrP1EPBtxB9` | single key | 1000+ (cap) | 2025-11-29 (351 d) | real active protocol |
| `Em9BQtEaBVkoAtx6kxqJAMFTQoHoxJR41pwPXEPAf1Rs` | single key | 1000+ (cap) | 2026-11-15 (1 d) | real active protocol |
