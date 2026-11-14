# Contributing

Small, focused pull requests are welcome.

- `npm install && npm test` must pass (no network needed; the Codama/Helius/devnet end-to-end tests are opt-in).
- Add a test for every behaviour change. Prefer real transaction fixtures (`fixtures/`) over hand-built ones.
- Alert-rule semantics follow Microscope's documented behaviour; if you change them, say which Microscope behaviour you matched.
- Never commit secrets, `.env`, keypairs or provider API keys. The tests must not need any.
- Keep the service small: one process, no new daemons. Avoid adding heavy dependencies; the process is meant to stay near 100 MB RSS.
- Bugs and ideas: open an issue. Security problems: see [SECURITY.md](SECURITY.md), not an issue.

By contributing you agree your work is released under the MIT licence of this repository.
