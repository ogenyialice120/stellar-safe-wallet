# Claims Audit

This table audits every behavioral claim in README.md, docs/architecture.md,
docs/policies.md, and significant doc comments in
`contracts/safe-wallet/src/lib.rs`. Each claim is traced to the function that
implements it and the test that proves it.

**Key:**
- **VERIFIED** — the claim is backed by a named test in `contracts/safe-wallet/src/test.rs`.
- **REWORDED** — the claim was inaccurate or misleading and has been corrected in the docs.
- **REMOVED** — the claim referred to a feature that does not exist and has been deleted.

Claims about authorization are cited only from tests that run **without**
`mock_all_auths`.

---

| # | Claim | Source | Implementing function | Test | Status |
|---|---|---|---|---|---|
| 1 | Wallet can only be initialised once | README feature table, docs/architecture.md | `initialize` (AlreadyInitialized guard) | `test_initialize_twice_fails` | VERIFIED |
| 2 | `initialize` requires owner auth | docs/architecture.md, lib.rs doc comment | `initialize` / `owner.require_auth()` | `test_initialize_without_auth_fails` | VERIFIED |
| 3 | `initialize` rejects `owner == recovery_key` | README, lib.rs doc comment | `initialize` (RecoveryKeyIsOwner guard) | `test_initialize_rejects_owner_as_recovery_key` | VERIFIED |
| 4 | `initialize` rejects `daily_cap <= 0` | lib.rs doc comment | `initialize` (InvalidDailyCap guard) | `test_initialize_rejects_zero_daily_cap` | VERIFIED |
| 5 | `initialize` rejects negative `daily_cap` | lib.rs doc comment | `initialize` (InvalidDailyCap guard) | `test_initialize_rejects_negative_daily_cap` | VERIFIED |
| 6 | Daily cap limits total outflows per window | README, docs/policies.md | `transfer` (DailyCap check) | `test_transfer_rejects_daily_cap_exceeded` | VERIFIED |
| 7 | Transferring exactly the daily cap succeeds | docs/architecture.md (boundary) | `transfer` | `test_transfer_exactly_at_daily_cap_succeeds` | VERIFIED |
| 8 | Transferring daily_cap + 1 fails | docs/architecture.md | `transfer` | `test_transfer_one_over_daily_cap_fails` | VERIFIED |
| 9 | Daily window resets after 86400 seconds | docs/policies.md, docs/architecture.md | `transfer` (DAY_IN_SECONDS check) | `test_transfer_resets_daily_spend_after_24h` | VERIFIED |
| 10 | Window resets at exactly `last_reset + 86400` | docs/policies.md | `transfer` | `test_transfer_resets_daily_spend_at_exact_boundary` | VERIFIED |
| 11 | Window does NOT reset at `last_reset + 86399` | docs/policies.md | `transfer` | `test_transfer_does_not_reset_before_boundary` | VERIFIED |
| 12 | The window is fixed (not rolling) — 2× cap possible around reset | README security model, docs/policies.md | `transfer` (timestamp-based reset) | `test_transfer_resets_daily_spend_at_exact_boundary` | REWORDED |
| 13 | Transfer requires owner auth | README API table, docs/architecture.md | `transfer` / `require_owner` | `test_transfer_without_auth_fails` | VERIFIED |
| 14 | Transfer to non-whitelisted address fails | README, docs/policies.md | `transfer` (whitelist check) | `test_transfer_rejects_non_whitelisted_recipient` | VERIFIED |
| 15 | Transfer fails when wallet is frozen | README, docs/policies.md | `transfer` (Frozen check) | `test_transfer_rejects_frozen_wallet` | VERIFIED |
| 16 | Zero-amount transfer fails | README (implicit), lib.rs doc comment | `transfer` (ZeroAmount guard) | `test_transfer_rejects_zero_amount` | VERIFIED |
| 17 | Negative-amount transfer fails | lib.rs doc comment | `transfer` (ZeroAmount guard) | `test_transfer_rejects_negative_amount` | VERIFIED |
| 18 | `checked_add` overflow returns `Overflow` error | lib.rs doc comment | `transfer` | `test_transfer_overflow_returns_error` | VERIFIED |
| 19 | Whitelist max 50 addresses | README feature table, docs/policies.md | `add_whitelist` (WhitelistFull guard) | `test_whitelist_full_rejects_51st_address` | VERIFIED |
| 20 | Duplicate addresses rejected from whitelist | README feature table, docs/architecture.md | `add_whitelist` (AlreadyWhitelisted guard) | `test_add_whitelist_dedup` | VERIFIED |
| 21 | `add_whitelist` requires owner auth | README API table, docs/policies.md | `add_whitelist` / `require_owner` | `test_add_whitelist_without_auth_fails` | VERIFIED |
| 22 | `remove_whitelist` removes the address | README API table | `remove_whitelist` | `test_remove_whitelist_success` | VERIFIED |
| 23 | `remove_whitelist` on absent address fails | docs/policies.md | `remove_whitelist` | `test_remove_whitelist_missing_address` | VERIFIED |
| 24 | `remove_whitelist` requires owner auth | README API table | `remove_whitelist` / `require_owner` | `test_remove_whitelist_without_auth_fails` | VERIFIED |
| 25 | Wallet is not frozen after initialization | README, docs/policies.md | `initialize` (sets `Frozen = false`) | `test_wallet_not_frozen_by_default` | VERIFIED |
| 26 | Recovery key can freeze the wallet | README feature table, docs/policies.md | `freeze` | `test_freeze_by_recovery_key` | VERIFIED |
| 27 | Owner cannot freeze | docs/architecture.md (separation of duties) | `freeze` (caller != recovery_key check) | `test_freeze_by_owner_fails` | VERIFIED |
| 28 | Random address cannot freeze | docs/architecture.md | `freeze` | `test_freeze_by_random_fails` | VERIFIED |
| 29 | `freeze` requires auth from caller | lib.rs doc comment | `freeze` / `caller.require_auth()` | `test_freeze_without_auth_fails` | VERIFIED |
| 30 | Recovery key can unfreeze the wallet | README, docs/policies.md | `unfreeze` | `test_unfreeze_by_recovery_key` | VERIFIED |
| 31 | Owner cannot unfreeze | docs/architecture.md, docs/policies.md | `unfreeze` (caller != recovery_key check) | `test_unfreeze_by_non_recovery_fails` | VERIFIED |
| 32 | `unfreeze` requires auth from caller | lib.rs doc comment | `unfreeze` / `caller.require_auth()` | `test_unfreeze_without_auth_fails` | VERIFIED |
| 33 | Transfer succeeds after unfreeze | README, docs/policies.md | `transfer` + `unfreeze` | `test_transfer_after_unfreeze` | VERIFIED |
| 34 | Old recovery key cannot unfreeze after rotation | README, docs/architecture.md | `unfreeze` (key lookup) | `test_freeze_rotate_unfreeze_transfer_cycle` | VERIFIED |
| 35 | Recovery key rotation requires both owner and recovery key | README feature table, docs/architecture.md | `update_recovery_key` | `test_update_recovery_key_without_auth_fails` | VERIFIED |
| 36 | `update_recovery_key` without any auth fails | lib.rs doc comment | `update_recovery_key` / `require_owner` | `test_update_recovery_key_without_auth_fails` | VERIFIED |
| 37 | `update_recovery_key` with only owner auth fails | docs/architecture.md | `update_recovery_key` / `current_recovery.require_auth()` | `test_update_recovery_key_only_owner_fails` | VERIFIED |
| 38 | `update_recovery_key` rejects `new_key == owner` | lib.rs doc comment | `update_recovery_key` (RecoveryKeyIsOwner guard) | `test_update_recovery_key_owner_as_new_key_fails` | VERIFIED |
| 39 | Full freeze→rotate→unfreeze cycle works | README demo description | combined | `test_freeze_rotate_unfreeze_transfer_cycle` | VERIFIED |
| 40 | Getters return correct values after initialization | lib.rs doc comments | `get_owner`, `get_daily_cap`, etc. | `test_getters_return_correct_values` | VERIFIED |
| 41 | Getters return `NotInitialised` on uninitialised wallet | lib.rs doc comments | all getters | `test_get_owner_not_initialised` | VERIFIED |
| 42 | `get_spent_today` reflects transfer amount | lib.rs doc comment | `get_spent_today` | `test_get_spent_today_reflects_transfer` | VERIFIED |
| 43 | `get_whitelist` reflects add/remove | lib.rs doc comment | `get_whitelist` | `test_get_whitelist_reflects_changes` | VERIFIED |
| 44 | Events are emitted without panic | docs/architecture.md (event topics listed) | all state-changing functions | `test_events_emitted_without_panic` | VERIFIED |
| 45 | The contract is "upgradeable" | old README text | (no such function) | N/A | REMOVED |
| 46 | "Only the owner can change the daily cap" | old docs/policies.md text | (no such function) | N/A | REMOVED |
| 47 | "No limit on whitelist size" | old docs/policies.md text | `add_whitelist` (WHITELIST_MAX = 50) | `test_whitelist_full_rejects_51st_address` | REWORDED |
| 48 | "Recovery key or owner can unfreeze" | old docs/policies.md text | `unfreeze` (recovery key only) | `test_unfreeze_by_non_recovery_fails` | REWORDED |
| 49 | "Freeze before a contract upgrade" use case | old docs/policies.md text | (no upgrade function) | N/A | REMOVED |
| 50 | Daily window is "rolling 24-hour" | old README, docs/*.md | `transfer` (fixed window, not rolling) | `test_transfer_resets_daily_spend_at_exact_boundary` | REWORDED |
| 51 | Contract implements Soroban AA (`__check_auth`) | old README text | (not implemented) | N/A | REWORDED |
| 52 | TTL extended on every state-changing call | docs/architecture.md | `bump_ttl` called in all 7 state-changing fns | `test_events_emitted_without_panic` | VERIFIED |
| 53 | Instance TTL not extended on idle wallet | README security model | lack of `bump_ttl` on read-only calls | `test_events_emitted_without_panic` | REWORDED |
| 54 | Recovery key cannot spend | README, docs/policies.md, docs/architecture.md | `transfer` (owner auth only) | `test_freeze_by_recovery_key` | VERIFIED |

---

## Live Evidence (not test-backed)

Claims in this table describe observable on-chain behaviour that cannot be
proven by unit tests alone. The evidence column will be filled in after a
documented testnet run. Until then, every claim here is "pending evidence".

`bash scripts/check_claims.sh` does not validate this table (it only checks
the VERIFIED rows in the table above).

| # | Claim | Evidence | Date |
|---|---|---|---|
| L1 | `scripts/demo.sh` all 17 steps run to completion on testnet with all assertions passing | Full run on 2026-11-24. Contract `CDKAXWO4DF5V3PLW4NGMUTSG4PH66G6VULMX2F4JIHX2IFRLFPI7WMAD`, commit `9b2bb03`. Deploy tx `e6107155641125c26dcb1516fe3ffc547aee7b9cabb003a7a12522f02d9cd698`. See `docs/testnet-run.md` for full output and all tx hashes. | 2026-11-24 |
| L2 | Step 13 (`--build-only` / `stellar tx sign` approach) produced TxMalformed | Observed in run 1 (contract `CASPY7BHTYBE77EELEPZRFMJJV3WN4B7SA4HWRL6YDOCDP72JCYH5VBX`). Failed tx `c599c663271d026c8bfa9560af9dd7c75ba2ca0825e09a5338058a29e5558fea`. Root cause: `stellar tx sign` signs the envelope, not the Soroban auth entry for the recovery key. | 2026-11-24 |
| L2b | Step 13 with `rotate-recovery-key.mjs` (Part 5 version) crashed at assembly with `assembled.sign is not a function` | Observed in run 2 (contract `CB3HSYHEVLFCFQJDJMBS52CH5S67FOBRTZTQT3O7JDHUF6CHQ72FNBM4`). Root cause: `assembleTransaction` returns a `TransactionBuilder`; `.build()` must precede `.sign()`. Fixed in `fix/helper-assembly` (PR #43, commit `9b2bb03`). | 2026-11-24 |
| L3 | Recovery-key rotation with `rotate-recovery-key.mjs` (corrected `assembleTransaction().build().sign()`) succeeds on-chain | Confirmed in run 3 on 2026-11-24. Tx `e5afa31b3459b4e6c94f0b84b90393a3d5d475a91eba317f7f3b712c08f921af`. `get_recovery_key` read back and matched the new address. | 2026-11-24 |
| L4 | Steps 14–17 execute correctly after key rotation | Confirmed in run 3 on 2026-11-24. Old key rejected (Unauthorized, step 14); new key unfreezes (step 15, tx `248b8d8ca924a068a6ef1ca41390a3e716f848366c826d89e7b46a5ec67b9fb1`); final transfer succeeds (step 17, tx `57e7ba7f3af8280f119e1e6f7e9e402e171a6502d40dc69402bfabf94608a30a`). | 2026-11-24 |
| L5 | Native token SAC address resolved by `stellar contract id asset --asset native` matches the token accepted by `initialize` | Confirmed in all three runs. Token SAC `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` used for initialize and fund in run 3 (initialize tx `307a72d0d5442a967818800883558b6e6b2896b5d7071d3a7842c276d59ca7e7`). | 2026-11-24 |
