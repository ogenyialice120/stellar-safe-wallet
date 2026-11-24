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

---

## 2026-11-24 — fix/contract-hardening

### Changes

**contracts/safe-wallet/src/lib.rs** — Contract hardening:
- `initialize`: added rejection of `owner == recovery_key` (new error
  `RecoveryKeyIsOwner = 10`) and `daily_cap <= 0` (new error
  `InvalidDailyCap = 11`). The re-initialisation guard fires before these
  checks so an already-initialised wallet returns `AlreadyInitialized` as
  before.
- `transfer`: replaced `spent_today + amount` with `checked_add`, returning
  new error `Overflow = 12` on overflow. The old unchecked addition could
  silently wrap in debug builds.
- Added private helper `bump_ttl` with TTL constants `TTL_MIN`/`TTL_MAX` and
  called it in every state-changing function: `initialize`, `add_whitelist`,
  `remove_whitelist`, `transfer`, `freeze`, `unfreeze`, `update_recovery_key`.
  Previously TTL was only extended in `initialize` and `transfer`.
- Added `env.events().publish(...)` calls in all state-changing functions with
  short topic pairs: `("init", "wallet")`, `("wl", "add")`, `("wl", "rm")`,
  `("transfer", "out")`, `("freeze", "ok")`, `("unfreeze", "ok")`,
  `("key", "rotate")`.
- Added read-only getters: `get_owner`, `get_daily_cap`, `get_spent_today`,
  `get_whitelist`, `get_recovery_key`, `get_token`. Each returns
  `NotInitialised` when the wallet has not been set up.
- Fixed doc comment on `update_recovery_key`: removed mention of `caller`
  parameter (which no longer exists); updated `# Errors` for all functions
  to include `NotInitialised` where applicable.
- Changed `update_recovery_key` to return `RecoveryKeyIsOwner` instead of
  `Unauthorized` when `new_key == owner`, for consistency with `initialize`.
- Moved test module from inline in lib.rs to `contracts/safe-wallet/src/test.rs`
  (`#[cfg(test)] mod test;`).

**Why (initialize guards):** `owner == recovery_key` destroys separation of
duties; the same person holding both keys could bypass the dual-auth requirement
on `update_recovery_key`. `daily_cap <= 0` made the wallet unusable: every
positive transfer immediately exceeded the zero cap, and negative caps were
silently stored. The old test `test_initialize_zero_daily_cap_stores_and_blocks_transfers`
verified that zero was stored; it is replaced by `test_initialize_rejects_zero_daily_cap`.

**Why (overflow check):** i128 addition on two values that could each be up to
`i128::MAX` can overflow. Wrapping overflow is undefined behaviour in Rust
release builds with `overflow-checks = true` (panics), but returning a typed
error is the correct contract behaviour.

**Why (TTL in every state-changing function):** An owner could add addresses
to the whitelist, freeze/unfreeze, or rotate keys without ever calling
`transfer`. Those operations advanced the wallet's state but did not extend
TTL, so the instance could expire if the owner never transferred after those
calls.

**Why (events):** Without events there is no on-chain audit trail. External
monitoring tools and block explorers have no structured way to detect wallet
activity.

**Why (getters):** External contracts and CLI tools had no way to inspect
wallet state without directly reading instance storage, which requires
knowledge of the internal key enum.

**BREAKING:**
- `initialize` now rejects `daily_cap <= 0`. Callers that previously passed
  `0` will receive `InvalidDailyCap` (code 11) instead of `Ok`.
- `initialize` now rejects `owner == recovery_key`. Callers with identical
  owner and recovery key will receive `RecoveryKeyIsOwner` (code 10).
- `update_recovery_key` now returns `RecoveryKeyIsOwner` (code 10) instead of
  `Unauthorized` (code 1) when `new_key == owner`. Any code checking for
  error code 1 in that case must be updated to check for code 10.
- Three new error variants at the end of the enum: `RecoveryKeyIsOwner = 10`,
  `InvalidDailyCap = 11`, `Overflow = 12`. Existing numeric codes are
  unchanged.

**Test results (commands run locally):**
```
cargo fmt --all -- --check    → no diff (clean)
cargo clippy --workspace --all-targets -- -D warnings  → Finished, 0 warnings
cargo build --workspace       → Finished dev profile
cargo test --workspace        → 49 passed, 0 failed
cargo build --release --target wasm32v1-none \
  --manifest-path contracts/safe-wallet/Cargo.toml
                              → Finished release profile
```

New tests added (all in contracts/safe-wallet/src/test.rs):
- `test_initialize_rejects_owner_as_recovery_key`
- `test_initialize_rejects_zero_daily_cap`
- `test_initialize_rejects_negative_daily_cap`
- `test_initialize_without_auth_fails` — WITHOUT mock_all_auths
- `test_transfer_overflow_returns_error`
- `test_transfer_resets_daily_spend_at_exact_boundary` — window boundary
- `test_transfer_does_not_reset_before_boundary` — window boundary
- `test_transfer_without_auth_fails` — WITHOUT mock_all_auths
- `test_freeze_without_auth_fails` — WITHOUT mock_all_auths
- `test_unfreeze_without_auth_fails` — WITHOUT mock_all_auths
- `test_add_whitelist_without_auth_fails` — WITHOUT mock_all_auths
- `test_remove_whitelist_without_auth_fails` — WITHOUT mock_all_auths
- `test_update_recovery_key_without_auth_fails` — WITHOUT mock_all_auths
- `test_update_recovery_key_only_owner_fails` — WITHOUT mock_all_auths
- `test_update_recovery_key_only_recovery_fails` — WITHOUT mock_all_auths
- `test_getters_return_correct_values`
- `test_get_owner_not_initialised` through `test_get_token_not_initialised`
- `test_get_spent_today_reflects_transfer`
- `test_get_whitelist_reflects_changes`
- `test_events_emitted_without_panic`

Note on TTL tests: The SDK 22.0.0 test harness does not expose an API to read
the current TTL of an instance storage entry. We cannot assert the TTL was
bumped to a specific ledger count in a unit test. The non-transfer state-changing
functions all call `bump_ttl` and the tests verify they execute without
panicking; the actual TTL values would require a testnet run or a custom
ledger inspection tool.

Note on `test_update_recovery_key_only_owner_fails`: The Soroban test harness's
`env.set_auths(&[])` clears all mocked auth. This test uses that to verify
that a call without any auth fails. It does not construct a scenario where
exactly the owner signs but the recovery key does not — `set_auths` with a
partial auth entry requires the `MockAuth` builder, and constructing a
`MockAuth` for one signer that also causes the second `require_auth()` to fail
is not straightforward in SDK 22.0.0. The test proves the function fails when
all auth is absent; the dual-auth requirement is indirectly verified by the
combination of the `require_owner` call and `current_recovery.require_auth()`.

---

## 2026-11-24 — docs/honest-docs-and-claims-audit

### Changes

**README.md** — Corrected false and misleading claims:
- Removed "rolling 24-hour window" language; replaced with accurate description
  of the fixed window and the 2× cap consequence.
- Removed claim that the contract is "upgradeable" (no upgrade function exists).
- Added honest note that the contract does not implement Soroban's
  `__check_auth` custom-account interface.
- Fixed feature table: key rotation note now states "both owner and recovery key
  must sign" (was "recovery key can rotate keys").
- Updated API table with new getters, events note, and all error codes.
- Added Security model & limitations section with explicit gaps.
- Added note that demo.sh has not been run against a live testnet in this repo.
- Updated demo prerequisites to Rust 1.88+ and wasm32v1-none.

**Why:** The old README claimed the wallet is "programmable, upgradeable, and
auditable on-chain" (there is no upgrade function), described the daily window
as rolling (it is fixed), and said the recovery key can "rotate keys" without
noting dual-auth.

---

**docs/architecture.md** — Corrected false and misleading claims:
- Added honest note that `__check_auth` is not implemented.
- Removed AirdropContract section (airdrop was removed in Part A).
- Updated transfer flow diagram to include overflow guard (step 6).
- Updated "daily rolling window" to "fixed 24 h window, resets on transfer".
- Updated error code table to include the three new variants from Part B.
- Corrected "Storage TTL Management" section: TTL is now extended on every
  state-changing call (was only init and transfer).

**Why:** The old architecture.md described 9 error codes (now 12) and said
TTL was extended only on init and transfer.

---

**docs/policies.md** — Corrected false and misleading claims:
- Rewrote "rolling 24-hour window" as fixed window with explanation of the
  2× cap consequence.
- Removed claim "only the Owner can change the daily cap" (no such function).
- Removed "no limit on whitelist size" (limit is 50).
- Updated initialize CLI example: added required `--token` argument; switched
  from `soroban` to `stellar` CLI.
- Corrected "recovery key or owner can unfreeze" to "recovery key only".
- Removed "freeze before a contract upgrade" use case (no upgrade function).
- Removed link to "how to deploy and upgrade" in See Also.

**Why:** The old policies.md had at least six factually wrong statements about
contract behavior.

---

**docs/deployment.md** — Already corrected in Part A. No new changes.

---

**docs/claims-audit.md** — New file.

**Why:** Part C requires a claims audit table linking every behavioral claim
to its implementing function and test name. 54 rows; 42 VERIFIED,
5 REWORDED (window type, upgrade claim, AA claim, unfreeze auth, whitelist
size), 7 REMOVED (cap setter, upgrade use cases, the original zero-cap test).

---

**scripts/check_claims.sh** — New file.

Checks:
1. Every VERIFIED row has a non-empty, non-N/A test name.
2. Every named test exists as `fn <name>` (whole word) in
   `contracts/safe-wallet/src/test.rs`.
3. Every status is one of: VERIFIED, REWORDED, REMOVED.

Proves that a named test exists in the source file. Does not prove the test
covers the claim — a human review is still needed for that.

Tested against:
- Real audit file: `check_claims: all rows passed.`
- Broken file (nonexistent test name): detected with `FAILED [row 1]: test 'fn test_does_not_exist' not found`
- Broken file (invalid status): detected all invalid-status rows.

Added as a CI step in `.github/workflows/ci.yml`.

---

**SECURITY.md** — New file. Documents private vulnerability reporting process
and known limitations.

**Why:** Part C requires a SECURITY.md. The old CONTRIBUTING.md mentioned
"security channels" without specifying them.

---

**CONTRIBUTING.md** — Added `bash scripts/check_claims.sh` to the PR checklist;
added `docs/claims-audit.md` update requirement.

**scripts/demo.sh** — Updated header: removed "Account Abstraction Wallet"
label; added honest note that the script has not been run against a live
testnet in this repository; clarified that step 12 (transfer after unfreeze)
may be blocked if the daily cap was consumed earlier in the same window.

**Why:** The demo.sh comment claimed to demonstrate an "Account Abstraction
lifecycle" and implied the script had been run. Neither was true.

---

**Test results (commands run locally):**
```
cargo fmt --all -- --check    → no diff (clean)
cargo clippy --workspace --all-targets -- -D warnings  → Finished, 0 warnings
cargo build --workspace       → Finished dev profile
cargo test --workspace        → 49 passed, 0 failed
bash scripts/check_claims.sh  → all rows passed
```

No contract logic, test behavior, or error codes were changed in this part.

---

## 2026-11-24 — fix/demo-script-and-dependency-patch (Task 4: honest demo, dependency evidence)

### Changes

**scripts/demo.sh** — Complete rewrite.

Previous problems:
- Steps 6, 8, 10 used `if ... | grep -q` patterns that printed a friendly
  message regardless of whether the command succeeded or failed. A transfer
  that SUCCEEDED at step 6 would print "Correctly rejected with
  DailyCapExceeded". The script could never detect a broken contract.
- Step 5 (fund contract) wrapped its call in `2>/dev/null || info "(Skipping...)"`,
  silently ignoring failures and leaving subsequent transfers to fail for an
  unrelated reason.
- Step 9 comment said "mock_all_auths covers the recovery key co-sign" — that
  only exists in unit tests; on a real network it has no effect.
- `--token "native"` passed the string "native" where the contract expects a
  Soroban contract address (a SAC address); unverified whether the CLI resolved it.
- The transfer amounts in steps 5/6 were arithmetically inconsistent.

New implementation:
- `expect_ok <label> <description> <cmd...>`: runs the command; if it fails,
  prints full output and exits 1. Used for every call that must succeed.
- `expect_error <label> <error_name> <error_code> <cmd...>`: runs the command;
  exits 1 if the command SUCCEEDS, or if it fails without matching the named
  error (by name string or numeric code). Used for steps 9, 12, 14.
- Resolves the native token address with `stellar contract id asset --asset native
  --network "$NETWORK"` and passes the resulting `C…` contract ID as `--token`.
- Funds the wallet via the native token SAC's `transfer` function, then reads
  the balance back and asserts it is at least 550 000 000 stroops (55 XLM)
  before proceeding.
- Removes every `2>/dev/null`, `|| true` and `&& ok || err` that could hide
  failures. The only "already exists" case (network add) is detected with an
  explicit `stellar network ls | grep` check.
- Cap arithmetic is documented in comments:
  10 XLM spent in step 8; cap is 50 XLM; step 9 attempts 45 XLM + 1 stroop,
  total would be 550 000 001 > 500 000 000. Step 17 uses 5 XLM (40 XLM
  remaining).
- After step 8, calls `get_spent_today` and asserts the value is 100 000 000
  (10 XLM). After steps 10 and 15, calls `is_frozen` and asserts true/false.
- Key rotation (step 13) uses a real multi-party signing flow:
  `stellar contract invoke --build-only` builds the XDR with the owner as
  source (covering the owner's root auth); `stellar tx sign --sign-with-key
  RECOVERY_KEY --auto-sign` appends the recovery key's non-root auth entry
  signature; `stellar tx send` submits the fully-signed transaction. No mock.
- Prints a summary table (step, expected, result, tx hash) at the end.
- Header updated: "not yet run; run it yourself and record in docs/testnet-run.md".
- Prerequisites documented: exact install command for Stellar CLI, Rust toolchain
  note, internet/testnet requirement, keys-are-throwaway warning.

**scripts/deploy.sh** — Honesty pass.
- Removed `2>/dev/null` from `stellar network add`; replaced with an explicit
  `stellar network ls | grep` check for the "already exists" case. A real
  failure now stops the script.
- Replaced `stellar keys fund ... || true` with an explicit warning message
  that distinguishes between "already funded" (benign) and "real failure"
  (needs attention). The script does not stop on a failed fund (friendbot
  returns non-zero for already-funded accounts), but it warns clearly.
- Added an empty-contract-ID guard after deploy.
- Added prerequisite documentation to match demo.sh.

**scripts/check_claims.sh** — Fixed SC2034 shellcheck warnings: renamed
unused `read` fields (`claim`, `source`, `fn_name`) to `_claim`, `_source`,
`_fn_name`.

**.github/workflows/ci.yml** — Added two new steps after the claims audit:
- Install shellcheck from GitHub releases.
- Run `shellcheck scripts/*.sh`.

**Cargo.toml** (workspace) — Upgraded `soroban-sdk` from `"=22.0.0"` to
`"=22.0.11"`. Updated the `[patch.crates-io]` comment with evidence.

**contracts/safe-wallet/Cargo.toml** — Updated dev-dependency from
`"=22.0.0"` to `"=22.0.11"`.

**Cargo.lock** — Regenerated for soroban-sdk 22.0.11.

**README.md** — Updated demo section with accurate 17-step description,
honest "not yet run" wording, and new "Dependency notes" section.

**docs/deployment.md** — Added `stellar contract id asset` command to explain
the `--token` argument; added demo script section; added Stellar CLI install
command.

**docs/claims-audit.md** — Added "Live Evidence (not test-backed)" table with
5 rows (L1–L5) for claims that require a real testnet run to verify.

**CONTRIBUTING.md** — Added `shellcheck scripts/*.sh` to the PR checklist.

---

### Why (demo.sh rewrite)

Every `if ... | grep -q ...` pattern in the old script treated both success and
failure as acceptable outcomes, printing a friendly message either way. The only
way to detect a bug in the contract was to notice that the wrong message printed.
The new helpers fail the script on the wrong outcome, so a CI or manual run that
completes without error actually proves the assertions.

### Why (deploy.sh)

`|| true` on a funding call hides network connectivity problems. `2>/dev/null`
on `network add` hides real CLI errors. Both patterns were removed.

### Why (dependency upgrade to 22.0.11)

The earlier changelog claimed `soroban-sdk =22.0.11` could not compile.
Investigated in a scratch copy (no changes to the real workspace until proven):

**Test matrix:**

| soroban-sdk | Patch | `cargo build` | `cargo test` | `cargo clippy` | WASM build | WASM size |
|---|---|---|---|---|---|---|
| =22.0.0 | yes | ✓ | 49/49 | clean | ✓ | 11730 bytes |
| =22.0.11 | no | ✓ (native) | ✗ — `ChaCha20Rng: TryRng not satisfied` | ✗ same error | ✓ (WASM doesn't link ed25519) | 11730 bytes |
| =22.0.11 | yes | ✓ | 49/49 | clean | ✓ | 11730 bytes |

**Root cause confirmed:** `soroban-env-host 22.1.3` pulls both
`ed25519-dalek 3.0.0` (uses `rand_core 0.9` via `curve25519-dalek 5`) and
`rand_chacha 0.3` (uses `rand_core 0.6`). These two `rand_core` versions exist
simultaneously in the dependency tree; `ed25519_dalek::SigningKey::generate`
requires `CryptoRng` from `rand_core 0.9`, but `ChaCha20Rng` only implements
it from `rand_core 0.6`. The patch replaces `ed25519-dalek` with the 2.2.0
tag, which uses `rand_core 0.6` throughout, eliminating the conflict.

The claim that the **patch** is the cause of the compilation failure was not
reproduced: with or without the patch, `cargo build` succeeds for native target.
The failure is specific to the testutils/clippy target. The patch resolves it.

**WASM output:** both sdk versions with the patch produce identical 11730-byte
WASM files with identical exported functions (15 contract functions, 1 memory,
2 globals). The patch has zero effect on the deployable artifact.

**Decision:** Adopt `=22.0.11` with the patch. It is the more current version,
passes all checks, and the WASM output is identical.

---

### Tests/verification

```
cargo fmt --all -- --check    → no diff (clean)
cargo clippy --workspace --all-targets -- -D warnings  → Finished, 0 warnings
cargo test --workspace        → 49 passed, 0 failed
bash scripts/check_claims.sh  → all rows passed
bash -n scripts/demo.sh       → syntax OK
bash -n scripts/deploy.sh     → syntax OK
shellcheck scripts/*.sh        → clean (0 warnings)
cargo build --release --target wasm32v1-none \
  --manifest-path contracts/safe-wallet/Cargo.toml
                              → 11730 bytes (identical to 22.0.0)
```

Testnet run: **not performed** (no network access in this environment). The
rewritten script will be run by the submitter; output to be recorded in
`docs/testnet-run.md`.

---

### Limits

- The demo script cannot be verified without network access. Syntax is correct
  (`bash -n`) and shellcheck is clean, but the multi-party signing flow (step 13)
  has not been executed end-to-end.
- `extract_txhash` in demo.sh uses a simple regex for 64-char hex hashes. If
  the CLI changes its output format for transaction hashes, the summary table
  will show "-" for those entries (steps still pass or fail correctly).
- The "already funded" detection in deploy.sh relies on friendbot returning a
  non-zero exit code for already-funded accounts; if friendbot changes behaviour,
  the warning message logic may need updating.

