# Architecture

## Overview

Soroban Safe is a **smart contract wallet** — an **Account Abstraction (AA)** implementation built entirely in Soroban smart contracts on the Stellar network. It enforces programmable spending policies (daily caps, whitelists, emergency freeze, key rotation) that are impossible to implement with Stellar's native multisig accounts.

The system consists of two contracts:

| Contract | Purpose |
|---|---|
| **SafeWallet** (`contracts/safe-wallet`) | Programmable account abstraction wallet with policy enforcement |
| **AirdropContract** (`contracts/airdrop`) | Merkle-tree-based token distribution for rewarding contributors |

---

## Account Abstraction vs. Standard Stellar Multisig

This is the core architectural choice. Here is why it matters:

### Standard Stellar Multisig

Stellar's built-in multisig adds signers and thresholds to a **Stellar account** at the protocol level. Its constraints are fixed by the protocol:

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

The protocol allows changing signers and thresholds but cannot express business logic like "this account can never send more than 100 XLM per day" or "transactions can only go to these three addresses".

### Soroban Safe (Account Abstraction)

SafeWallet moves **all authorization logic** into a Soroban smart contract. The contract is the account. Instead of the Stellar account signers validating a transaction, the contract's `transfer` function validates every outflow against the configured policies before touching a single token.

| Capability | SafeWallet (AA) |
|---|---|
| Require owner signature | ✅ `require_auth()` on owner |
| Daily spending cap (rolling 24h) | ✅ `DailyCap` + `SpentToday` + `LastResetTimestamp` |
| Recipient whitelist (max 50, dedup enforced) | ✅ `Whitelist: Vec<Address>` |
| Emergency freeze by a separate recovery key | ✅ `Frozen` flag + `RecoveryKey` |
| Recovery key cannot spend, only freeze/unfreeze | ✅ Separation of duties enforced in code |
| Rotate recovery key (owner + current recovery key auth) | ✅ `update_recovery_key` |
| CEI ordering (state before external calls) | ✅ `SpentToday` updated before `token::Client::transfer` |
| Storage TTL management (wallet never expires on mainnet) | ✅ `extend_ttl` on init and every transfer |
| Re-initialisation guard | ✅ Checks `DataKey::Owner` before init |
| On-chain programmable error types | ✅ `WalletError` enum (9 variants) |

The recovery key is the most important design decision: it can **halt** the wallet in an emergency but it can never **spend** from it. Separating those two powers drastically reduces the blast radius of any single key compromise.

---

## Contract Storage Layout

All state is in Soroban **instance storage** (shared across the contract's lifetime, automatically archived with the contract):

| Key (`DataKey`) | Type | Description |
|---|---|---|
| `Owner` | `Address` | Primary controller. Required for `transfer`, `add_whitelist`, `remove_whitelist`, `update_recovery_key`. |
| `DailyCap` | `i128` | Maximum tokens transferable per 24-hour rolling window, in stroops. |
| `SpentToday` | `i128` | Accumulated spend within the current 24h window. |
| `LastResetTimestamp` | `u64` | Ledger UNIX timestamp at which the current 24h window started. |
| `Whitelist` | `Vec<Address>` | Approved outbound recipients. Max 50 entries, deduplication enforced. |
| `RecoveryKey` | `Address` | Can call `freeze` and `unfreeze`. Cannot spend. |
| `Frozen` | `bool` | If `true`, all `transfer` calls revert with `WalletFrozen`. |
| `TokenAddress` | `Address` | Token contract address; set once at init, not changeable. |

---

## Policy Enforcement: Transfer Flow

Every call to `transfer(to, amount)` passes through the following checks in order. **Failing any single check reverts the entire call** — no partial state changes.

```
Client calls transfer(to, amount)
         │
         ▼
┌─────────────────────────────────────────────────┐
│  1. require_owner auth                           │
│     owner.require_auth()                        │
│     → Err(Unauthorized) if not signed by owner  │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│  2. Zero-amount guard                            │
│     amount <= 0 → Err(ZeroAmount)               │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│  3. Freeze check                                 │
│     Frozen == true → Err(WalletFrozen)          │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│  4. Whitelist check                              │
│     to ∉ Whitelist → Err(AddressNotWhitelisted) │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│  5. Daily window reset (if 24h elapsed)          │
│     now >= LastResetTimestamp + 86400 s          │
│     → SpentToday = 0, LastResetTimestamp = now  │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│  6. Daily cap enforcement                        │
│     SpentToday + amount > DailyCap              │
│     → Err(DailyCapExceeded)                     │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│  7. CEI: update state BEFORE external call       │
│     SpentToday += amount                        │
│     extend_ttl(TTL_MIN, TTL_MAX)                │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│  8. External call (last)                         │
│     token::Client::transfer(contract, to, amt)  │
└─────────────────────────────────────────────────┘
```

Steps 1–6 are **checks**. Step 7 is **effects** (state updates). Step 8 is the **interaction** (external call). This CEI ordering is the standard re-entrancy defence: by the time the token contract executes, the wallet's state is already updated, so a re-entrant call into `transfer` would see the updated `SpentToday` and correctly enforce the cap.

---

## Recovery Key Flow

```
┌────────────────────────────────────────────────────────┐
│                 Normal operation                        │
│  Owner ──► transfer() ──► token moves                  │
│  Owner ──► add_whitelist() / remove_whitelist()        │
└────────────────────────┬───────────────────────────────┘
                         │  Suspected compromise
                         ▼
┌────────────────────────────────────────────────────────┐
│  RecoveryKey ──► freeze()  → Frozen = true             │
│                                                        │
│  All transfer() calls now return WalletFrozen          │
│  Owner key is effectively neutralised                  │
└────────────────────────┬───────────────────────────────┘
                         │  After key rotation / incident resolved
                         ▼
┌────────────────────────────────────────────────────────┐
│  Owner + RecoveryKey ──► update_recovery_key(new_key)  │
│  RecoveryKey ──► unfreeze()  → Frozen = false          │
│                                                        │
│  Wallet resumes normal operation with new keys         │
└────────────────────────────────────────────────────────┘
```

Note the dual-auth requirement on `update_recovery_key`: **both** the owner and the current recovery key must sign. This prevents either key from unilaterally replacing the other — the attacker who compromises only the owner key cannot silently swap in their own recovery key.

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
| View frozen state | read-only | read-only |

The recovery key has **zero spend authority**. It cannot drain the wallet, modify the whitelist, or change the daily cap. Its only power is to halt and resume operations. This design means that even if an attacker obtains the recovery key, the worst they can do is temporarily freeze the wallet — they cannot steal funds.

---

## AirdropContract

A companion contract for distributing tokens to contributors using Merkle proofs.

### Leaf construction

```
leaf = SHA-256(to_xdr(claimant) || amount.to_le_bytes())
```

### Proof verification

Siblings are combined in lexicographic order (smaller hash on left) to produce a deterministic tree regardless of insertion order. This is the standard approach used by OpenZeppelin's MerkleProof and Uniswap's airdrop contracts.

### Why Merkle proofs?

Rather than storing the full recipient list on-chain (expensive), only the root hash is stored. Each claimer provides their proof at claim time. This makes the airdrop O(log n) in gas per claim regardless of list size.

---

## Storage TTL Management

Soroban contracts have **storage TTLs** — entries expire after a configurable number of ledgers. SafeWallet manages TTLs explicitly:

- On `initialize`: `extend_ttl(TTL_MIN=518_400, TTL_MAX=1_036_800)` (~30 days min, ~60 days max at 5 s/ledger)
- On every `transfer`: TTL is bumped again so an active wallet never expires

If a wallet goes unused for >60 days, the instance storage will be archived. It can be restored via `stellar contract restore` before any new call, at which point the TTL is bumped again automatically.

---

## See Also

- [`policies.md`](policies.md) — detailed spending policy guide with CLI examples
- [`deployment.md`](deployment.md) — how to deploy SafeWallet to testnet or mainnet
- [`scripts/demo.sh`](../scripts/demo.sh) — end-to-end demo: deploy, spending cap, freeze, recovery
- `contracts/safe-wallet/src/lib.rs` — annotated contract source
