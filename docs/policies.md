# Spending Policies

This guide explains how SafeWallet's spending policies work and how to configure
them. All policy logic lives in `contracts/safe-wallet/src/lib.rs`.

---

## Overview

A SafeWallet is governed by four interlocking policies:

| Policy | Purpose | Controlled By |
|---|---|---|
| **Daily cap** | Limits total outflows per 24-hour window | Set at initialize; not changeable afterward |
| **Whitelist** | Restricts transfers to approved recipient addresses (max 50) | Owner |
| **Freeze/unfreeze** | Emergency circuit breaker | Recovery key only |
| **Recovery key** | Secondary signer that can freeze/unfreeze but cannot spend | Set at initialize; rotatable by owner + current recovery key |

All policy state lives in Soroban instance storage. The daily cap and owner
address are set once at `initialize` and **cannot be changed** afterward.

---

## Daily Cap

The daily cap limits how much value can leave the wallet per window. It is
stored as an `i128` in **stroops** (1 XLM = 10 000 000 stroops). The cap must
be positive; `initialize` rejects zero and negative values.

### How the window works

The window is **fixed**, not rolling:

1. `DailyCap` is set when the wallet is initialised.
2. When a transfer is attempted, the contract compares the current ledger
   timestamp against `LastResetTimestamp`.
3. If `now >= LastResetTimestamp + 86400`, `SpentToday` is reset to `0` and
   `LastResetTimestamp` is updated to `now`.
4. `SpentToday + amount` is checked against `DailyCap`. If it would exceed
   the cap, the transfer fails with `DailyCapExceeded`.

**Important limitation:** Because the window resets only when a transfer is
attempted, an attacker with the owner key can spend up to the cap at the very
end of one window and again immediately after the next transfer triggers a
reset, spending up to 2× the cap in a short period.

### Example: initialise a wallet with a 100 XLM daily cap

Using the Stellar CLI:

```bash
stellar contract invoke \
  --id <SAFE_WALLET_CONTRACT_ID> \
  --source-account <OWNER_KEY> \
  --network testnet \
  -- \
  initialize \
  --owner <OWNER_ADDRESS> \
  --daily_cap 1000000000 \
  --recovery_key <RECOVERY_ADDRESS> \
  --token <TOKEN_CONTRACT_ADDRESS>
```

`daily_cap` is in stroops, so `1000000000` = 100 XLM.

---

## Whitelist

The whitelist restricts outgoing transfers to a known set of recipient
addresses. A transfer to any address not on the list fails with
`AddressNotWhitelisted`.

### How it works

1. The whitelist is stored as a `Vec<Address>` in instance storage.
2. The owner can add addresses with `add_whitelist` (max 50 entries, no
   duplicates).
3. The owner can remove addresses with `remove_whitelist`.
4. Before executing a transfer, the contract verifies `to ∈ whitelist`.

> **Limit:** The whitelist cap is 50 addresses. Adding a 51st fails with
> `WhitelistFull`.

### Example: add a recipient to the whitelist

```bash
stellar contract invoke \
  --id <SAFE_WALLET_CONTRACT_ID> \
  --source-account <OWNER_KEY> \
  --network testnet \
  -- \
  add_whitelist \
  --address <RECIPIENT_ADDRESS>
```

---

## Freeze and Unfreeze

The freeze flag is an emergency circuit breaker. When `Frozen` is `true`, all
transfers are blocked until the wallet is unfrozen.

### When to use it

- **Compromised owner key:** Freeze immediately to stop outflows.
- **Suspicious activity:** Freeze first, investigate second.

### How it works

1. `Frozen` defaults to `false` at initialization.
2. Only the address stored in `RecoveryKey` can call `freeze` or `unfreeze`.
   The owner has no freeze or unfreeze power.
3. While frozen, any `transfer` call fails with `WalletFrozen`.

### Example: freeze the wallet in an emergency

```bash
stellar contract invoke \
  --id <SAFE_WALLET_CONTRACT_ID> \
  --source-account <RECOVERY_KEY> \
  --network testnet \
  -- \
  freeze \
  --caller <RECOVERY_ADDRESS>
```

To check the current freeze status:

```bash
stellar contract invoke \
  --id <SAFE_WALLET_CONTRACT_ID> \
  --network testnet \
  -- \
  is_frozen
```

---

## Recovery Key

The recovery key is a secondary address set during initialization. It exists
to reduce the blast radius of a compromised owner key.

### Responsibilities

- **Can freeze** the wallet at any time.
- **Can unfreeze** the wallet.
- **Cannot spend** from the wallet.
- **Cannot change** the daily cap, whitelist, or owner.

### Key rotation

Both the owner and the **current** recovery key must sign
`update_recovery_key`. Neither can rotate unilaterally.

### Best practices

- Store the recovery key on a different device or custodian than the owner key.
- If the recovery key is lost and the wallet is frozen, it can never be
  unfrozen — there is no backup path.
- Do not make the recovery key the same address as the owner; `initialize`
  rejects that configuration.

### Example: initialise with a recovery key

See the [initialize example](#example-initialise-a-wallet-with-a-100-xlm-daily-cap)
above. The `--token` argument is required.

---

## Policy Interaction

Checks during a transfer call, in order:

```
transfer(to, amount)
  │
  ├─ require owner auth
  ├─ amount > 0                            ← ZeroAmount guard
  ├─ check !frozen                         ← freeze policy
  ├─ check to ∈ whitelist                  ← whitelist policy
  ├─ maybe reset daily window              ← fixed 24 h window
  ├─ checked_add(spent, amount)            ← overflow guard
  ├─ check new_total ≤ daily_cap           ← daily cap policy
  └─ update SpentToday; extend TTL; emit event; call token
```

A transfer must satisfy every check. Failing any single check reverts the
entire call.

---

## See Also

- [`architecture.md`](architecture.md) — contract layout and storage keys
- [`deployment.md`](deployment.md) — how to deploy SafeWallet
- `contracts/safe-wallet/src/lib.rs` — contract source code
