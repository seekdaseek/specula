# specula — TRACKER

Goal: hosted, multi-program Solana program monitoring and alerting. Open-source engine (seekdaseek/specula, private until v0 works), paid hosted version on the VPS. A lighter, multi-tenant answer to the Solana Foundation's Microscope (MIT).

Why not just host Microscope: its decoder is compiled into the Docker image per program (README: "the decoder is compiled in, so program_id and the IDL are build inputs"), and one deployment needs 2 vCPU / 4 GiB / 40 GiB (docs/operations.md, "Cost"). One stack per customer program cannot run on the 4 GB VPS.

Status legend: [ ] open  [x] done  [~] in progress  [H] waits on the operator

1. [x] Target sweep (Nov 14): Ghost, stablecoin checkout, hosted OZ Monitor, Defender Deploy, Microscope. Microscope picked.
2. [x] Source read of solana-foundation/solana-microscope @ aa514f1 (Nov 11 2026): config schema, alert kinds event/instruction/multisig, Anchor (spec 0.1.0) and Codama IDLs, Jupiter Lend mainnet example.
3. [x] Brief written: /Volumes/D/specula/BRIEF-specula-phase0-1-20261114.md
4. [x] PHASE 0 (Claude Code): measure ingest cost per program per month for 3 designs. GATE: stop and report if the cheapest design costs more than $3 per program per month at median traffic.
5. [x] PHASE 1 (Claude Code): engine v0 with runtime IDL decoding, multi-program, alerts, tests, Jupiter Lend golden test, 30-min mainnet dry run.
5b. [x] PHASE 1b (Telegram proven 14 Nov, message_id 3): live Helius webhook via cloudflared quick tunnel, real Telegram delivery, Microscope JSON-shape compatibility, Codama attempt, PRICING.md. Brief: /Volumes/D/specula/BRIEF-specula-phase1b-20261114.md
5c. [x] Telegram real-delivery proof: send /start to @speculaDaBot (getUpdates returned 0 updates 14 Nov), then `npx tsx scripts/telegram-prove.ts`.
5d. [x] .env has a duplicate HELIUS_API_KEY line (128 chars, invalid) above the good 36-char one; delete the bad line (not edited by Claude).
5e. [ ] Read the Helius dashboard credit usage for the 14 Nov 08:54-09:54Z window and compare with the derived 797 (LOG.md).
5f. [ ] Give the VPS monthly price so PRICING.md break-even stops using the $10 assumption.
5g. [ ] Webhook multi-day soak (miss rate, retries when the endpoint is down) before trusting design A alone.
6. [H] Free Helius key + Telegram bot token + chat id into .env (his terminal, hidden input; never pasted in chat).
7. [ ] Builder points: register before any deploy (his Nov 12 rule). Candidate: Talent Protocol Builder Score linked to github.com/seekdaseek.
8. [~] PHASE 2 (2a live 14 Nov: specula.ochinimus.app, PM2 specula + specula-tunnel, port 3043; 2b billing open): hosted service on VPS (port + PM2 + Cloudflare tunnel), USDC billing over x402 / Solana Pay, landing card on ochinimus.app.
8a. [x] PHASE 2a: deploy, webhook, self-serve bot, trial, metering, ops (LOG.md 2026-11-14 Phase 2a)
8b. [~] PHASE 2b (code, tests and deploy done 14 Nov; waits on the operator's 0.10 USDC proof payment): USDC billing via Solana Pay reference keys, verified on-chain by specula itself; plan upgrade path; build nothing until the operator starts it
8c. [H] the operator's 3-step Telegram check (/start, /watch <program>, /status), report anything off
8d. [x] DONE 14 Nov (backup /opt/watchdog.sh.bak-20261114): add specula and specula-tunnel to /opt/watchdog.sh (edit outside /opt/specula, not done)
8e. [ ] Flag: item 7 (builder points before any deploy) was still open when specula went live on 14 Nov per the Phase 2a brief
8f. [x] FIXED 14 Nov: pre-0.30 on-chain IDLs (Squads v4) fail to load via /watch; improve converter or document
8g. [x] Plan limits Starter 3, Growth 10, Scale 25 (the operator, Phase 2b brief), in config
8h. [ ] Remove or retire the proof tenant (Jupiter Lend alerts to the owner chat) when no longer wanted
8i. [H] the operator pays the hidden 0.10 USDC `proof` plan from his own wallet (/upgrade proof), then confirms the 2a checklist; after both, remove the Jupiter Lend proof tenant (keep as disabled fixture)
8j. [ ] Devnet end-to-end billing test needs a payer funded at faucet.solana.com (devnet RPC faucet closed): DEVNET_PAYER_KEYFILE
8k. [ ] Refund process is by hand (owner gets REJECTED/EXTRA lines with signatures); decide whether to automate in a later phase
8l. [ ] solwatch-mcp was redeployed at 12:16Z by someone other than specula (report only)
8m. [x] Phase 3 prepared 14 Nov: landing page live at specula.ochinimus.app, repo public-ready (not flipped), LISTINGS.md, site/index.html card, UPGRADE-FEED.md (NO-GO)
8n. [x] DONE 14 Nov: repo recreated public with ONE squashed commit (old SHAs 404 unauthenticated; backup /Volumes/D/specula-history-backup). Was: decide the repo flip: accept history as is (first name, IP, Telegram id, public treasury address appear in old commits) or squash (command in LOG.md); then flip visibility (command in LOG.md)
8o2. [H] Drag the nine files from ~/Desktop/ochinimus-deploy (index.html now 48 products + llms.txt specula entry; index sha e9844ee4a6f8b6d1, llms 49c16be05b920081). Supersedes 8o. Was: upload site/index.html (card now under Open source, links the public repo; sha256 054411f7...7fa3f) to the ochinimus Worker by dashboard (card sits in "Open source": flip the repo first or move it)
8p. [H] Approve or edit LISTINGS.md before anything is submitted; solana.com form requirements need a browser check
8q. [ ] WATCH: Microscope PR #30 (several programs per deployment, open since 12 Nov) narrows the main differentiator; keep the upgrade/silence/hosted/billing angle
8r. [x] Upgrade feed filtered-webhook test 14 Nov: filter does NOT limit billing ($20-43/month), NO-GO, poster not built
8s2. [~] Upstream PR for #31: signed commit 1ecc799 pushed to the fork (verified true), PR text ready in upstream/PR-31-body.md, WAITING for the operator's approval before `gh pr create`. Earlier note:  branch fix/prune-unresolved-idl-types 48bcbe7 rebased on main 549af0d, proof done (6 E0432 before, passes after, 292 files byte-identical, clippy and fmt pass, cargo test blocked by disk). BLOCKED: signing key creation was denied, create ~/.ssh/id_ed25519_gitsign then sign, fork, push, verify; then the operator approves /Volumes/D/specula/upstream/PR-31-body.md (incl. the AI disclosure wording) before gh pr create.
8s. [~] UPSTREAM.md: issue 3 OPENED 14 Nov as solana-microscope#31 (https://github.com/solana-foundation/solana-microscope/issues/31); wait for the `accepted` label before any PR, then rebase the branch onto PR #30's generator and re-sign. Issues 1 and 2 still unopened. Was: open the issues (loader upgrades, silence, generator pruning) when ready; re-sign branch commit e10ccad first
9. [ ] PHASE 3: repo public, README, X post, Solana Foundation public-goods angle (do not file while the x402-wallet application is pending without his call).
10. [ ] Surfaces in sync after ship: repo, README, ochinimus.app card, X post.

Open risks
- Cost measured (COSTS.md): design A ~$0.95/program/month marginal at median traffic; Helius $49 plan fee is fixed; Kamino-size ~$18/month, so pricing must tier by volume.
- Design A (webhook) never run live until Phase 1b; failed-tx delivery by webhook unknown.
- Solana Foundation could ship its own hosted Microscope.
- Market is small: teams that ship Solana programs. Paying demand is a signal, not proof.
