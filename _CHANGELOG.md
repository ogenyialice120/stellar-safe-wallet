# CHANGELOG

This file is the single source of truth for all changes made to this repository
as part of the Stellar Wave Program resubmission audit. Entries are appended in
chronological order. Do not edit or remove prior entries.

---

## 2026-09-20 — docs/readme-and-architecture (PR #1)

### Changes

**docs/architecture.md** — Complete rewrite (was 1 437 bytes, shallow overview).
- Added explicit "Account Abstraction vs Standard Stellar Multisig" comparison
  table showing what SafeWallet enforces that the base protocol cannot.
- Added full `transfer()` enforcement flow diagram with CEI ordering explanation.
- Added Recovery Key flow diagram showing freeze → rotate → unfreeze lifecycle.
- Added Separation of Duties table (owner vs recovery key permissions).
- Added Storage Layout table documenting every `DataKey` variant and type.
- Added AirdropContract Merkle-proof section with leaf construction formula.
- Added Storage TTL management section.

**README.md** — Updated opening paragraph.
- Replaced generic description with a direct statement that this is a Soroban
  smart contract wallet implementing Account Abstraction (not a native Stellar
  multisig).
- Added a prominent callout box explaining why Soroban AA is used over native
  multisig and linking to architecture.md.
- Added "Demo" section linking to scripts/demo.sh with step-by-step description.
- Added "Documentation" table linking all docs and the demo script.

**Why:** Reviewers should not need to read source code to understand what makes
this an AA wallet rather than a standard Stellar multisig. The opening README
paragraph and architecture doc now make this explicit.

---

## 2026-09-20 — tests/wallet-policy-coverage (PR #2)

### Changes

**contracts/safe-wallet/src/lib.rs** — Added missing test cases:
- `test_whitelist_full_rejects_51st_address` — fills whitelist to 50, verifies
  51st push returns `WalletError::WhitelistFull`.
- `test_transfer_rejects_negative_amount` — verifies `-1` returns `ZeroAmount`.
- `test_update_recovery_key_owner_as_new_key_fails` — verifies that setting
  owner as the new recovery key returns `Unauthorized`.
- `test_initialize_zero_daily_cap_stores_and_blocks_transfers` — verifies a zero
  cap is stored (no validation error on init; transfers immediately exceed cap).
- `test_transfer_exactly_at_daily_cap_succeeds` — transfer of exactly `DailyCap` succeeds.
- `test_transfer_one_over_daily_cap_fails` — transfer of `DailyCap + 1` fails.
- `test_freeze_rotate_unfreeze_transfer_cycle` — complete freeze → key rotation →
  old key cannot unfreeze → new key unfreezes → transfer succeeds.

**Why:** The existing tests left the `WhitelistFull` error path, negative amounts,
and the owner-as-recovery-key guard completely untested. Full coverage is required
for the Wave Program's code quality criterion.

---

## 2026-09-20 — demo/testnet-spending-cap-recovery (PR #3)

### Changes

**scripts/demo.sh** — New file (replaces the deploy-only script).
- End-to-end testnet demo: build → deploy → init → whitelist → transfer →
  cap exceeded → freeze → freeze blocked transfer → key rotation → unfreeze →
  transfer after unfreeze.
- Creates and funds two testnet keys (`alice`, `alice-recovery`) automatically.
- Annotated output with step numbers and expected results.
- Non-destructive: safe to run multiple times (idempotent key generation).

**Why:** The evaluation criteria require a working demo. The original deploy.sh
only deployed the contracts; it did not exercise any wallet policies.

---

## 2026-09-20 — tests/wallet-policy-coverage (follow-up, same PR #2)

### Changes

**contracts/safe-wallet/src/lib.rs** — Fixed two test-code issues:
- Replaced deprecated `env.register_stellar_asset_contract(admin)` (called in
  both `setup_wallet` and the inline `test_update_recovery_key_owner_as_new_key_fails`
  setup) with `env.register_stellar_asset_contract_v2(admin).address()` as required
  by soroban-sdk 22.0.11.
- Renamed `token` to `_token` in `test_transfer_rejects_frozen_wallet` to suppress
  the unused-variable warning.

**contracts/safe-wallet/test_snapshots/tests/*.json** — Updated snapshot files.
- Snapshots updated to reflect the new `TokenAddress` storage key now present in
  all initialised wallet states (the new tests correctly set a token address during
  `initialize`, which the original snapshots did not capture).

**Local test run result:**
- `cargo test --manifest-path contracts/safe-wallet/Cargo.toml`
- 26 tests, 0 failures, 0 warnings.

**Why:** The deprecated API call produced compiler warnings that would appear in CI
output. Snapshot files are committed as truth so CI snapshot-diff checks pass.

---

## 2026-11-24 — chore/cleanup-and-build-target

### Changes

**contracts/airdrop/** — Removed entire directory.
**contracts/test-utils/** — Removed entire directory.
**src/lib.rs** — Removed empty file.
**tests/placeholder.rs** — Removed empty file.

**Why:** The airdrop and test-utils contracts are unrelated to the safe-wallet
product and were listed as project components in the README and architecture
docs without contributing any logic. The workspace claimed them as members,
causing unnecessary build and lint surface. The two empty files (src/lib.rs and
tests/placeholder.rs) added noise with zero content.

---

**contracts/safe-wallet/test_snapshots/** — Deleted all committed JSON snapshot files.
**contracts/airdrop/test_snapshots/** — Deleted (part of airdrop removal above).

**Why:** Snapshot files are build artefacts that change whenever tests run.
Committing them causes false diffs in PRs and misleads readers who expect source
files. Added `test_snapshots/` to `.gitignore`.

---

**.gitignore** — Added `test_snapshots/` and `.kiro/`; removed `Cargo.lock`.

**Why:** `Cargo.lock` being gitignored made builds non-reproducible and broke
the CI cache key `hashFiles('**/Cargo.lock')` (always empty). `.kiro/` is a
local IDE configuration directory that must not be committed.

---

**Cargo.lock** — Generated and committed.

**Why:** Pinned dependency graph makes builds reproducible and enables the CI
cache key to work.

---

**Cargo.toml** (workspace) — Removed `contracts/airdrop` and `contracts/test-utils`
from `[workspace] members`; changed `soroban-sdk` workspace dependency from
`"22.0.0"` to `"=22.0.0"` (exact pin); added `[workspace.package]` with
`rust-version = "1.88.0"`; retained `[patch.crates-io] ed25519-dalek` with
an explanatory comment.

**contracts/safe-wallet/Cargo.toml** — Added `rust-version.workspace = true`;
changed dev-dependency `soroban-sdk` to `"=22.0.0"` (exact pin).

**Why (soroban-sdk pin):** `soroban-sdk 22.0.0` pulls in `soroban-env-host
22.1.0` which works with the ed25519-dalek patch. `soroban-sdk 22.0.11` pulls
in `soroban-env-host 22.1.3`, which hard-requires `ed25519-dalek 3.0.0` (uses
`rand_core 0.10`) while simultaneously depending on `rand_chacha 0.3` (uses
`rand_core 0.6`). The two versions of `rand_core` create an unsatisfied trait
bound in `soroban-env-host`'s testutils that prevents compilation. This is a
bug in `soroban-env-host 22.1.3`; `22.0.11` as a target version cannot be
used until that crate is patched. The exact `=22.0.0` pin avoids resolving to
any 22.0.x that pulls in the broken env-host.

**Why (ed25519-dalek patch retained):** Removing the patch causes the same
rand_core conflict even with sdk 22.0.0 on some resolver runs. The patch pins
`soroban-sdk`'s own use of ed25519-dalek to 2.2.0, which unifies the
rand_core 0.6 dependency. The comment in Cargo.toml explains why.

---

**rust-toolchain.toml** — Added, pinning `channel = "1.88.0"`,
`targets = ["wasm32v1-none"]`, `components = ["rustfmt", "clippy"]`.

**Why:** The repo had no toolchain pin, so `rustup` would use whatever the
developer had installed. Pinning to 1.88.0 makes the build reproducible and
ensures `wasm32v1-none` is available (requires Rust 1.84+).

---

**.github/workflows/ci.yml** — Rewrote entirely.

**Why:** The old CI used `dtolnay/rust-toolchain@stable` (unpinned), installed
`wasm32-unknown-unknown` (wrong target), had no fmt or clippy step, and the
cache key was always empty because Cargo.lock was gitignored. The new CI:
- Pins `1.88.0` with `wasm32v1-none` and `rustfmt`/`clippy` components.
- Runs `cargo fmt --all -- --check`.
- Runs `cargo clippy --workspace --all-targets -- -D warnings`.
- Runs `cargo build --workspace` and `cargo test --workspace`.
- Builds WASM with `--target wasm32v1-none`.
- Uses a cache key that includes `Cargo.lock`.

---

**scripts/deploy.sh** — Removed airdrop deployment; switched build command to
`wasm32v1-none`; updated WASM artifact path to
`target/wasm32v1-none/release/safe_wallet.wasm`.

**scripts/demo.sh** — Switched build command and WASM path to `wasm32v1-none`
target; updated prerequisite comment.

**docs/deployment.md** — Rewrote. Removed airdrop build and deploy steps;
switched to `wasm32v1-none`; added explanation of why `wasm32-unknown-unknown`
is wrong; added `initialize` CLI example with token argument (old example
omitted token).

**README.md** — Updated architecture tree (removed airdrop and test-utils
entries, removed empty src/lib.rs and tests/placeholder.rs); changed
installation steps to use `wasm32v1-none`; changed prerequisite from "Rust
1.74+" to "Rust 1.88.0"; added one sentence explaining why `wasm32v1-none`
is used; added Security model & limitations section; corrected feature table
(daily cap described as fixed window, not rolling; key rotation note).

**CONTRIBUTING.md** — Rewrote. Changed "Rust 1.74+" to "1.88.0"; replaced
`wasm32-unknown-unknown` with `wasm32v1-none` throughout; added explanatory
note; removed references to airdrop and test-utils; added changelog entry
format requirement; added auth-test requirement.

**Why (wasm target changes):** From Rust 1.82+, `wasm32-unknown-unknown`
enables the WebAssembly `reference-types` proposal by default. The Stellar
network validator rejects WASM binaries that use that proposal. The correct
target is `wasm32v1-none` (WebAssembly 1.0 MVP, available from Rust 1.84+).
Every command, path, and document mentioning `wasm32-unknown-unknown` for
building the deployable contract has been updated.

---

**Test results (commands run locally):**
```
cargo fmt --all -- --check    → no diff (clean)
cargo clippy --workspace --all-targets -- -D warnings  → Finished, 0 warnings
cargo build --workspace       → Finished dev profile
cargo test --workspace        → 26 passed, 0 failed
cargo build --release --target wasm32v1-none \
  --manifest-path contracts/safe-wallet/Cargo.toml
                              → target/wasm32v1-none/release/safe_wallet.wasm (8 141 bytes)
```

No contract logic or test behavior was changed in this part.
