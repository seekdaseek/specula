# Upstream: Microscope (prepared 14 Nov 2026, nothing opened or pushed)

Checked with `gh` on 14 Nov 2026 against solana-foundation/solana-microscope at aa514f1.
Issues: 1 open (#29 configurable metrics and probe bind addresses), 2 closed (#12 resolved notification on activity alerts, #7 health-rule timings).
Pull requests open: #30 several programs per deployment, #28 several Squads multisigs per deployment, #25 fail over between Yellowstone and RPC endpoints. Closed: 24, mostly maintenance, CI, dependency advisories and fixes. None of the three gaps below is covered or requested.

Their CONTRIBUTING.md: open an issue first and wait for the `accepted` label; every pull request must say `Fixes #<issue>`; commits must be signature-verified. So the order is: open the issue, wait, then open the pull request. The local branch is not signed.

Local fork: /Volumes/D/specula/upstream/solana-microscope (remote removed, nothing to push to by accident).

## 1. Program upgrade and authority-change alerts (issue only)

Gap: the example config alerts on a Squads multisig that holds the upgrade authority, but nothing decodes the BPF Upgradeable Loader itself, so a direct `Upgrade` or `SetAuthority` on the program's programdata account raises no alert.
Evidence: no code or docs mention the loader (code search for BPFLoaderUpgradeable: 0 results); the upgrade-authority text in docs/examples/jupiter-lend.md only covers Squads proposals. No issue or pull request asks for it.
Diff summary: none yet. The change is larger than an incidental fix (a loader decoder in the indexer and a new alert kind), so only an issue until a maintainer agrees on the shape.
Issue text:
Title: Alert on BPF Upgradeable Loader upgrades and authority changes
Body: A deployment can alert on the Squads multisig that holds a program's upgrade authority, but an Upgrade or SetAuthority instruction sent straight to the loader for the program's programdata account is not decoded, so no alert fires. For programs whose authority is a plain key, or after a multisig executes the upgrade, the upgrade itself is the event an operator wants. Proposal: a new alert kind for loader Upgrade, SetAuthority and SetAuthorityChecked on the configured program's programdata account, with fields for the buffer and the old and new authority. The programdata address can be read from the program account. I can send a pull request once the shape is agreed.

## 2. No-activity (silence) alert (issue only)

Gap: activity alerts fire on a match; nothing fires when a program goes quiet. docs/examples/jupiter-lend.md says a month of silence followed by one notification is the intended behaviour, and the activity alerts use no-data state OK.
Evidence: alerting.rs generates `noDataState: "OK"` for activity rules and `Alerting` only for the indexer's own freshness and checkpoint rules; no rule type watches a program's own record stream for absence. No issue or pull request covers it.
Diff summary: none yet; depends on the maintainers' preference (per-program `silence_hours` generating a Grafana rule over the program's log stream, with a guard so it does not fire while the indexer itself is stalled).
Issue text:
Title: Optional alert when a monitored program has no activity for N hours
Body: Activity alerts only fire on a match, so a program that stops being called, or an indexer that silently stops seeing it, produces no notification. Proposal: an optional per-deployment `silence_hours` that creates a Grafana rule over the program's records with no-data state Alerting, suppressed while the indexer's own freshness rule is firing so that a broken pipe is not reported as a quiet program. I can send a pull request once the shape is agreed.

## 3. Pre-0.30 IDLs with undefined generic types (issue plus a ready branch)

Gap: `scripts/generate-decoder.sh` passes pre-0.30 Anchor IDLs to carbon-cli as they are. Squads v4's real on-chain IDL contains types built on `SmallVec<u8,Pubkey>` that the IDL never defines; carbon-cli renders them and imports `SmallVecU8Pubkey`, which does not exist.
Evidence (14 Nov 2026): the on-chain Squads v4 IDL (account address from the Anchor PDA, 8,952 bytes) generated with the script's own settings, then `cargo check` on the generated crate: `error[E0432]: unresolved imports crate::types::SmallVecU8CompiledInstruction, SmallVecU8MessageAddressTableLookup, SmallVecU8Pubkey` (3 errors, `could not compile carbon-program-decoder`). The repo's own idl/squads/v4.json does not have those types, so it was edited by hand.
Diff summary (branch fix/prune-unresolved-idl-types, commit e10ccad, 4 files, +106 -1): `scripts/idl_prune.py` drops type definitions that reference undefined types (cascading) and refuses, with a clear message, when an instruction, event or account still needs one; `generate-decoder.sh` calls it for Anchor IDLs and prints what was pruned; `scripts/test_idl_prune.py` has 5 unit tests; the Justfile `test` target runs them. Tests pass on Python 3.9 and 3.12; removing the cascade fails one test; with the pruned on-chain IDL the generated decoder compiles (`cargo check` finished).
Issue text:
Title: generate-decoder.sh emits a decoder that does not compile for pre-0.30 IDLs with undefined generic types
Body: Squads v4's on-chain IDL contains types such as TransactionMessage built on SmallVec<u8,Pubkey>, which the IDL does not define. carbon-cli generates a crate that imports SmallVecU8Pubkey and the build fails with E0432 (three unresolved imports). The repo's idl/squads/v4.json avoids this because those types were removed by hand. Proposal: prune type definitions that reference undefined types before generation, and fail with a clear message if an instruction, event or account needs one. I have a small change with unit tests ready and will open it against this issue once it is labelled accepted.
Pull request text (after the issue is accepted):
Title: fix(generator): prune IDL types that reference undefined types before generation
Body: Fixes #<issue>. Adds scripts/idl_prune.py, called from generate-decoder.sh for Anchor IDLs. Types whose references cannot be resolved are dropped, cascading; if an instruction, event or account depends on one the script exits with an error naming it. Tests: python3 -m unittest in scripts (5 tests, run by just test). Verified on Squads v4's real on-chain IDL: before, cargo check fails with three E0432 errors; after, the generated decoder compiles.

## Notes
- Our own project is a hosted alternative with a different shape (many programs in one process, no Yellowstone endpoint or Terraform); nothing above promotes it. Mention it only if asked.
- Before opening anything: re-sign the branch commit (CONTRIBUTING requires verified signatures) and re-check the three open pull requests, since #30 may change the generator script.
