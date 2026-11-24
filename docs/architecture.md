# Architecture

## Overview

Soroban Safe is a **policy-enforcing smart-contract wallet** built on Stellar
using Soroban smart contracts. It enforces programmable spending policies
(daily caps, whitelists, emergency freeze, key rotation) that are impossible to
implement with Stellar's native multisig accounts.

> **Note on "Account Abstraction":** The README and other docs refer to this
> contract as an "Account Abstraction" wallet. That term is accurate in a broad
> sense — authorization logic lives in a Soroban contract rather than in
> Stellar's native multisig layer. However, this contract does **not** implement
> Soroban's custom-account interface (`__check_auth`). It is a policy-enforcing
> contract that the owner calls directly. It has **no upgrade function**.

---

## Contract Abstraction vs. Standard Stellar Multisig

This is the core architectural choice. Here is why it matters:

### Standard Stellar Multisig

Stellar's built-in multisig adds signers and thresholds to a **Stellar account**
at the protocol level. Its constraints are fixed by the protocol:

| Capability | Stellar Multisig |
|---|---|
| Require multiple signatures | ✅ Yes |
| Enforce a daily spending cap | ❌ No |
| Restrict outbound addresses (whitelist) | ❌ No |
| Emergency circuit breaker (freeze) | ❌ No |
| Recovery key with no spend permissions | ❌ No |
| Rotate a "recovery" key without touching the owner key | ❌ No |
| Enforce CEI ordering to prevent re-entrancy | ❌ No |
| Custom error types surfaced on-chain | ❌ No |

### SafeWallet (Soroban policy wallet)

SafeWallet moves **all authorization logic** into a Soroban smart contract. The
contract holds the tokens and validates every outflow against the configured
policies before executing a transfer.

| Capability | SafeWallet |
|---|---|
| Require owner signature | ✅ `require_auth()` on owner |
| Daily spending cap (fixed 24 h window, resets on transfer) | ✅ `DailyCap` + `SpentToday` + `LastResetTimestamp` |
| Recipient whitelist (max 50, dedup enforced) | ✅ `Whitelist: Vec<Address>` |
| Emergency freeze by a separate recovery key | ✅ `Frozen` flag + `RecoveryKey` |
| Recovery key cannot spend, only freeze/unfreeze | ✅ Separation of duties enforced in code |
| Rotate recovery key (owner + current recovery key both sign) | ✅ `update_recovery_key` |
| CEI ordering (state before external calls) | ✅ `SpentToday` updated before `token::Client::transfer` |
| Storage TTL management | ✅ `extend_ttl` on every state-changing call |
| Re-initialisation guard | ✅ Checks `DataKey::Owner` before init |
| On-chain programmable error types | ✅ `WalletError` enum (12 variants) |
| Implements Soroban custom-account (`__check_auth`) | ❌ No |
| Upgrade mechanism | ❌ No |

The recovery key is the most important design decision: it can **halt** the
wallet in an emergency but can never **spend** from it. Separating those two
powers limits the blast radius of any single key compromise.

---

## Contract Storage Layout

All state is in Soroban **instance storage**:

| Key (`DataKey`) | Type | Description |
|---|---|---|
| `Owner` | `Address` | Primary controller. Required for `transfer`, `add_whitelist`, `remove_whitelist`, `update_recovery_key`. Set once at init. |
| `DailyCap` | `i128` | Maximum tokens transferable per 24-hour window, in stroops. Must be > 0. Set once at init. |
| `SpentToday` | `i128` | Accumulated spend within the current 24 h window. |
| `LastResetTimestamp` | `u64` | Ledger UNIX timestamp at which the current 24 h window started. |
| `Whitelist` | `Vec<Address>` | Approved outbound recipients. Max 50 entries, deduplication enforced. |
| `RecoveryKey` | `Address` | Can call `freeze` and `unfreeze`. Cannot spend. Must differ from `Owner`. |
| `Frozen` | `bool` | If `true`, all `transfer` calls revert with `WalletFrozen`. |
| `TokenAddress` | `Address` | Token contract address. Set once at init; not changeable. |

---

## Policy Enforcement: Transfer Flow

Every call to `transfer(to, amount)` passes through these checks in order.
**Failing any single check reverts the entire call.**

```
Client calls transfer(to, amount)
         │
         ▼
┌─────────────────────────────────────────────────┐
│  1. Require owner auth                           │
│     owner.require_auth()                        │
│     → Err(Unauthorized) if not signed by owner  │
└────────────────────┬────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────┐
│  2. Zero-amount guard                            │
│     amount <= 0 → Err(ZeroAmount)               │
└────────────────────┬────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────┐
│  3. Freeze check                                 │
│     Frozen == true → Err(WalletFrozen)          │
└────────────────────┬────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────┐
│  4. Whitelist check                              │
│     to ∉ Whitelist → Err(AddressNotWhitelisted) │
└────────────────────┬────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────┐
│  5. Daily window reset (if 24 h elapsed)         │
│     now >= LastResetTimestamp + 86400 s          │
│     → SpentToday = 0, LastResetTimestamp = now  │
└────────────────────┬────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────┐
│  6. Overflow guard                               │
│     SpentToday.checked_add(amount) is None      │
│     → Err(Overflow)                             │
└────────────────────┬────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────┐
│  7. Daily cap enforcement                        │
│     new_total > DailyCap → Err(DailyCapExceeded)│
└────────────────────┬────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────┐
│  8. CEI: update state BEFORE external call       │
│     SpentToday = new_total                      │
│     extend_ttl(TTL_MIN, TTL_MAX)                │
│     emit ("transfer","out") event               │
└────────────────────┬────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────┐
│  9. External call (last)                         │
│     token::Client::transfer(contract, to, amt)  │
└─────────────────────────────────────────────────┘
```

Steps 1–7 are **checks**. Step 8 is **effects** (state updates). Step 9 is
the **interaction** (external call). This CEI ordering means a re-entrant call
to `transfer` sees the already-updated `SpentToday` and correctly enforces the
cap.

---

## Recovery Key Flow

```
┌────────────────────────────────────────────────────────┐
│  Normal operation                                       │
│  Owner ──► transfer()          ── tokens move          │
│  Owner ──► add_whitelist()                             │
│  Owner ──► remove_whitelist()                          │
└────────────────────────┬───────────────────────────────┘
                         │  Suspected compromise
                         ▼
┌────────────────────────────────────────────────────────┐
│  RecoveryKey ──► freeze()  → Frozen = true             │
│                                                        │
│  All transfer() calls now return WalletFrozen          │
│  Owner key is effectively neutralised                  │
└────────────────────────┬───────────────────────────────┘
                         │  After incident resolved
                         ▼
┌────────────────────────────────────────────────────────┐
│  Owner + RecoveryKey ──► update_recovery_key(new_key)  │
│  RecoveryKey (new) ──► unfreeze()  → Frozen = false    │
│                                                        │
│  Wallet resumes normal operation                       │
└────────────────────────────────────────────────────────┘
```

Note the dual-auth requirement on `update_recovery_key`: **both** the owner
and the current recovery key must sign. This prevents either key from
unilaterally replacing the other.

---

## Separation of Duties

| Action | Owner | Recovery Key |
|---|---|---|
| Transfer tokens | ✅ | ❌ |
| Add to whitelist | ✅ | ❌ |
| Remove from whitelist | ✅ | ❌ |
| Freeze wallet | ❌ | ✅ |
| Unfreeze wallet | ❌ | ✅ |
| Rotate recovery key | ✅ (+ recovery key co-signs) | co-signer only |
| Read frozen state | read-only | read-only |

The recovery key has **zero spend authority**. Its only power is to halt and
resume operations.

---

## Storage TTL Management

Soroban contracts have storage TTLs — entries expire after a configurable
number of ledgers. SafeWallet extends TTL (`TTL_MIN = 518_400`,
`TTL_MAX = 1_036_800` ledgers, ≈ 30/60 days at 5 s/ledger) on every
state-changing call: `initialize`, `add_whitelist`, `remove_whitelist`,
`transfer`, `freeze`, `unfreeze`, `update_recovery_key`.

If a wallet goes unused for >60 days, instance storage will be archived. It
can be restored with `stellar contract restore` before any new call.

---

## Error Codes

| Code | Variant | Meaning |
|---|---|---|
| 1 | `Unauthorized` | Caller is not the required signer |
| 2 | `DailyCapExceeded` | Transfer would exceed the daily cap |
| 3 | `AddressNotWhitelisted` | Recipient is not on the whitelist |
| 4 | `WalletFrozen` | Wallet is frozen; no transfers allowed |
| 5 | `ZeroAmount` | Amount is zero or negative |
| 6 | `NotInitialised` | Wallet has not been initialised |
| 7 | `AlreadyInitialized` | Wallet has already been initialised |
| 8 | `AlreadyWhitelisted` | Address is already on the whitelist |
| 9 | `WhitelistFull` | Whitelist has reached the 50-address cap |
| 10 | `RecoveryKeyIsOwner` | Recovery key must differ from owner |
| 11 | `InvalidDailyCap` | Daily cap must be positive (> 0) |
| 12 | `Overflow` | `spent_today + amount` would overflow `i128` |

---

## See Also

- [`policies.md`](policies.md) — detailed spending policy guide with CLI examples
- [`deployment.md`](deployment.md) — how to deploy SafeWallet to testnet or mainnet
- [`scripts/demo.sh`](../scripts/demo.sh) — end-to-end demo
- `contracts/safe-wallet/src/lib.rs` — annotated contract source
