# specula

Telegram alerts for your Solana program, decoded from its IDL, from one lightweight Node process.

- **Hosted:** <https://specula.ochinimus.app/> - open [@speculaDaBot](https://t.me/speculaDaBot), send `/watch PROGRAM_ID`, tap the alerts you want. 14-day free trial, then USDC on Solana. No account, no install.
- **Self-hosted:** this repository, MIT licensed. Instructions below.

What it alerts on:

- **Program upgrades and upgrade-authority changes** (BPF Upgradeable Loader `Upgrade`, `SetAuthority`, `SetAuthorityChecked`). A gap in Microscope.
- **Silence**: no decoded activity for N hours, suppressed while specula's own ingest is down.
- **Any instruction or event in your IDL**, with Microscope-compatible `[[alerts]]` rules (conditions on decoded fields, failed transactions included).
- Delivery to **Telegram**, **Discord** or an **HMAC-signed webhook**.

## Credit

specula is a lighter, multi-tenant take on the Solana Foundation's
[Microscope](https://github.com/solana-foundation/solana-microscope) (MIT licence, copyright the Solana Foundation).
We read Microscope's source (commit `aa514f1`) to match its alert-rule schema, operator semantics, instruction/event
naming and decoded JSON shapes. No Microscope code is copied; its licence text is kept in `fixtures/idl/MICROSCOPE-LICENSE`
because the test fixtures include IDLs from its repository (`lending.json`, Squads `v3.json`/`v4.json`). The Jupiter Lend and
Squads programs are third-party; nothing here is affiliated with them or with the Solana Foundation.

## How it differs from Microscope

| | Microscope | specula |
|---|---|---|
| Programs per deployment | one (decoder compiled into the image) | many, in one Node process |
| IDL | build input (Rust codegen) | loaded at runtime |
| Footprint | 2 vCPU / 4 GiB / 40 GiB per program (its docs) | one Node process + SQLite (about 100 MB RSS in our deployment) |
| Pipeline | Carbon + Loki + Grafana alerting | SQLite + in-process rule engine |
| Alert rules | `[[alerts]]` TOML | the same schema for kinds `event` and `instruction`, paste-compatible |
| Program upgrade / authority change | not decoded (reported gap) | yes |
| Silence (no activity for N hours) | no | yes, per program |
| Pipeline-stall alert | datasource health rules | yes |
| Multisig (Squads) alerts | yes | **no** (not in v0) |
| IDLs | Anchor 0.1.0, Codama | Anchor (0.1.0 and pre-0.30), Codama with numeric u8 discriminators |
| Channels | Slack, Telegram, PagerDuty | Telegram, Discord, HMAC-signed webhook |

## Self-hosting quickstart

Requirements: Node 20 or newer, a Helius API key (the free plan works), a Telegram bot token from [@BotFather](https://t.me/BotFather).

```bash
git clone https://github.com/seekdaseek/specula && cd specula
npm install
npm test                      # 145+ tests, no network
```

### A. Library / headless mode: a config file, polling only

```bash
npx tsx src/main.ts run specula.toml
```

```toml
rpc_url = "https://api.mainnet-beta.solana.com"   # or any provider; pruned history breaks replay
db_path = "specula.db"
poll_interval_seconds = 15
stall_seconds = 300            # no successful poll for this long => pipeline alert

[tenants.acme.webhook]
url = "https://example.com/hooks/specula"
secret = "change-me"           # HMAC-SHA256 key, header: x-specula-signature: sha256=<hex>

[tenants.acme.telegram]
chat_id = "-100123456"         # the bot token is read from env TELEGRAM_BOT_TOKEN, never from this file

[[programs]]
tenant = "acme"
program_id = "jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9"
idl_path = "lending.json"      # Anchor spec 0.1.0, pre-0.30 Anchor, or Codama rootNode
silence_hours = 6              # optional
upgrade_alerts = true          # default true

[[programs.alerts]]            # exactly Microscope's [[alerts]] fields
kind = "event"
name = "log_deposit"
match = "all"
conditions = [
  { field = "data.assets", operator = "gt", value = 1000000 },
  { field = "failed", operator = "eq", value = false },
]
severity = "warning"
channels = ["telegram", "webhook"]
```

A Microscope `[[alerts]]` block pasted as-is works; `slack` and `pagerduty` channel names are accepted and reported as
unsupported (not delivered).

### B. Service mode: your own self-serve Telegram bot

This is what runs the hosted version: Helius webhook receiver, 5-minute polling reconciler, Telegram bot with trial, quota
metering and USDC billing, in one process.

```bash
cp deploy/service.example.toml service.toml   # set public_url and [billing] recipient (a public address you control)
cat > .env <<'EOF'
HELIUS_API_KEY=...            # mainnet RPC and the webhook API
TELEGRAM_BOT_TOKEN=...        # from @BotFather
OWNER_CHAT_ID=...             # your Telegram user id: operator alerts, /support, hidden plans
WEBHOOK_TOKEN=...             # a long random string; Helius sends it as the Authorization header
EOF
npm run build
node --env-file=.env dist/main.js serve service.toml
```

- The service listens on `127.0.0.1:<port>` and needs a public HTTPS URL for Helius (for example a Cloudflare tunnel). It
  serves `/webhook/helius` (token required), `/health`, and the landing page at `/`; everything else is 404.
- It creates one raw Helius webhook itself and batches address-list edits to at most one per 5 minutes (each edit costs
  100 Helius credits).
- Keep the repository layout: the landing page assets are read from `public/` next to `data/`.
- Plans, trial and billing settings live in `service.toml`, not in code. specula only ever receives USDC: put a public
  address in `[billing] recipient`; no private key is needed anywhere.
- A daily SQLite backup (`sqlite3 .backup`, 7 files kept) is written to `backup_dir`; the `sqlite3` binary must be installed.

Bot commands: `/start`, `/watch PROGRAM_ID`, `/rules PROGRAM_ID` (paste a Microscope `[[alerts]]` block under it), `/list`,
`/remove`, `/status`, `/plans`, `/upgrade PLAN`, `/billing`, `/support TEXT`, `/help`.

## Record shape and rules

Each decoded instruction or event is stored and evaluated as the same JSON Microscope logs: `kind`, `name` (snake_case),
`program_id`, `signature`, `slot`, `block_time`, `failed`, `instruction_path`, `data`. Instruction `data` is
`{ program_id, data: { <args> }, accounts: { <name>: <pubkey> } }`, so an argument is `data.data.assets` and an event field is
`data.assets`.

JSON shapes follow Microscope's generated Rust decoder (serde_json), read from its source and compared on real
transactions (`scripts/msdiff.ts`): `u64`/`u128`/`i128` are exact bare numbers even above 2^53, `Pubkey` and
`Option<Pubkey>` are base58 strings, `Option` is the value or `null`, `Vec<u8>`/`[u8; N]` are number arrays, a unit enum
variant is `"Variant"`, a struct variant is `{"Variant": {...}}`, a tuple variant is `{"Variant": x}` or `{"Variant": [..]}`.
Rule conditions reject integers above 2^53, as Microscope does (quote the value to compare it as an exact string).

Operators: `exists`, `contains`, `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, with Microscope's edge cases: `exists` and `contains`
need a non-empty value; a missing field, `null` and `""` never match; `ne` on a string or boolean also requires the field to be
present; numeric comparisons drop non-numeric values. One alert per rule per signature.

## How ingest works

A provider webhook is the primary feed and a polling reconciler is the correctness fallback (`COSTS.md` has the cost
model, `PRICING.md` the pricing). Records are keyed on `(program_id, signature, instruction key)`, so overlap between the two
feeds is a no-op, and a signature the webhook already delivered is not fetched again. Polling keeps a durable per-address
checkpoint so a restart replays what was missed.

Measured on 14 Nov 2026 (60 min, Jupiter Lend + Squads v4, Helius raw webhook): 270 of 270 transactions delivered after the
webhook became active (it took about a minute), p50 1.2 s and p95 1.8 s after block time, failed transactions included (7 of
7). Details in `PRICING.md` section 5; real payloads are in `fixtures/helius/`.

## Honest limits

- **Codama IDLs need numeric u8 instruction discriminators and event-CPI events tagged at offset 8** (the shape of
  Microscope's example IDL). Other Codama discriminator schemes throw at load time. Codama option/enum shapes are not compared
  with Microscope on real data.
- **No multisig (Squads) alerts** in v0.
- **Compared with Microscope's decoder on 7 Jupiter Lend transactions only** (its generated Rust decoder, harness in
  `tools/ms-harness`): all 8 instructions and 12 events agree. u128, tuple enums and nested `Vec<Pubkey>` are checked against
  its source and unit tests, not against its output. Instruction records omit Microscope's `remaining` accounts array.
- **Event attribution is simplified.** Log events are attributed to the top-level instruction frame whose invoke stack has
  your program on top; only `Program data:` lines are trusted. Instruction paths are `top.innerPosition`.
- **Webhook feed tested for one hour on two programs**, not over days.
- **Upgrade detection** sees `Upgrade`, `SetAuthority`, `SetAuthorityChecked`; not `Close`, `ExtendProgram` or redeploys by
  other loaders.
- **Billing verification:** `@solana/pay` cannot read version-1 transactions or v0 transactions with lookup tables; for those
  specula applies its own strict check (no error, finalized, exact owner+mint balance change, reference present).
- **Not high availability:** SQLite, single process. High-traffic programs (hundreds of thousands of tx/day) are expensive on
  any provider (`COSTS.md`).
- A transaction that stays unretrievable stalls that address (the stall alert fires); there is no skip-after-N policy yet.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

MIT. See `LICENSE` and `fixtures/idl/MICROSCOPE-LICENSE`.
