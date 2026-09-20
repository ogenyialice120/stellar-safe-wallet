# EMMY_CHANGELOG

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
- `test_initialize_accepts_zero_daily_cap` — verifies a zero cap is stored (no
  validation error on init; transfers immediately exceed cap).
- `test_transfer_exactly_at_daily_cap` — transfer of exactly `DailyCap` succeeds.
- `test_transfer_one_over_daily_cap_fails` — transfer of `DailyCap + 1` fails.
- `test_freeze_then_unfreeze_then_transfer_succeeds` — complete freeze/unfreeze
  cycle followed by a successful transfer.

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
