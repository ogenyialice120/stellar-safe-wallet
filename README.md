# 🔐 Soroban Safe — Policy Wallet on Stellar

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Stellar](https://img.shields.io/badge/Built%20on-Stellar-blue)](https://stellar.org)
[![Soroban](https://img.shields.io/badge/Smart%20Contracts-Soroban-purple)](https://soroban.stellar.org)
[![CI](https://github.com/ogenyialice120/stellar-safe-wallet/actions/workflows/ci.yml/badge.svg)](https://github.com/ogenyialice120/stellar-safe-wallet/actions/workflows/ci.yml)

A Soroban smart contract wallet that enforces spending rules the base protocol
cannot express. The contract is the custodian: it holds one token and releases
it only when all configured policies pass. Policy logic runs entirely on-chain.

> **Why not native Stellar multisig?**  
> Stellar's built-in multisig can require N-of-M signers, but it cannot express
> "never send more than 100 XLM per day" or "only send to these three
> addresses". SafeWallet encodes those rules in a Soroban contract. See
> [`docs/architecture.md`](docs/architecture.md) for a detailed comparison.

---

## ✨ Features

| Feature | Description |
|---|---|
| 💰 **Daily Spending Cap** | Limits total outflows per window (fixed 24 h window that resets after a transfer, not a rolling window; see Security model) |
| 📋 **Whitelisted Addresses** | Restricts transfers to pre-approved recipients (max 50, dedup enforced) |
| 🔑 **Recovery Key** | A secondary signer that can freeze and unfreeze, but cannot spend |
| 🔒 **Emergency Freeze / Unfreeze** | Recovery key can halt or resume transfers instantly |
| 🛡️ **Re-initialisation Guard** | Contract can only be initialised once |
| ♻️ **Key Rotation** | Recovery key can be rotated — requires both owner and current recovery key to sign |
| 📦 **Storage TTL Management** | Instance TTL is extended on every state-changing call |

---

## 🏗️ Architecture

```
stellar-safe-wallet/
├── contracts/
│   └── safe-wallet/          # Policy wallet smart contract (Rust/Soroban)
│       ├── src/
│       │   └── lib.rs        # Contract logic
│       └── Cargo.toml
├── docs/
│   ├── architecture.md       # Design, storage layout, AA vs multisig comparison
│   ├── policies.md           # Spending policy guide
│   └── deployment.md         # Deployment guide
├── scripts/
│   ├── deploy.sh             # Deploy safe-wallet to a Stellar network
│   └── demo.sh               # End-to-end testnet demo
├── rust-toolchain.toml       # Pins Rust 1.88.0 + wasm32v1-none target
├── Cargo.toml                # Workspace manifest
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites

- [Rust](https://rustup.rs/) 1.88.0 — `rust-toolchain.toml` pins this automatically
- [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/stellar-cli) v22+

### Installation

```bash
git clone https://github.com/ogenyialice120/stellar-safe-wallet.git
cd stellar-safe-wallet

# Build the smart contract for deployment.
# wasm32v1-none produces WebAssembly 1.0 (MVP) output that the Stellar network
# accepts. wasm32-unknown-unknown enables the reference-types proposal from
# Rust 1.82+ and the network rejects that output.
cargo build --release --target wasm32v1-none \
  --manifest-path contracts/safe-wallet/Cargo.toml
```

### Running Tests

```bash
cargo test --workspace
```

### Deploy to Testnet

```bash
# Configure Stellar CLI for testnet
stellar network add testnet \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"

# Generate & fund a test account
stellar keys generate alice --network testnet
stellar keys fund alice --network testnet

# Deploy the contract
stellar contract deploy \
  --wasm target/wasm32v1-none/release/safe_wallet.wasm \
  --source alice \
  --network testnet
```

---

## 📖 Usage Example

```rust
// Initialize the wallet (owner, daily cap in stroops, recovery key, token address)
// 1 XLM = 10_000_000 stroops; 100 XLM = 1_000_000_000
client.initialize(
    &owner_address,
    &1_000_000_000_i128,
    &recovery_address,
    &token_contract_address,
);

// Add a whitelisted recipient (owner only; max 50 addresses, no duplicates)
client.add_whitelist(&recipient_address);

// Transfer tokens — enforces whitelist, daily cap, and freeze state
client.transfer(&recipient_address, &100_000_000_i128);

// Emergency freeze (recovery key only)
client.freeze(&recovery_address);

// Unfreeze (recovery key only)
client.unfreeze(&recovery_address);

// Remove an address from the whitelist (owner only)
client.remove_whitelist(&recipient_address);

// Rotate the recovery key (requires both owner + current recovery key auth)
client.update_recovery_key(&new_recovery_address);
```

---

## 📋 Contract API

| Function | Description | Auth |
|---|---|---|
| `initialize` | Set owner, daily cap, recovery key, token address | Owner (once only) |
| `add_whitelist` | Add address to transfer whitelist (max 50) | Owner |
| `remove_whitelist` | Remove address from whitelist | Owner |
| `transfer` | Transfer tokens enforcing all policies | Owner |
| `freeze` | Halt all transfers | Recovery key |
| `unfreeze` | Resume transfers | Recovery key |
| `is_frozen` | Returns `true` if frozen | Read-only |
| `update_recovery_key` | Rotate recovery key | Owner + current recovery key (both) |

---

## 🔒 Security Model & Limitations

**What the policies protect against:**

- Owner key compromise is limited: the attacker can only send up to the daily
  cap per window, only to whitelisted addresses. The recovery key can freeze
  the wallet immediately to stop further outflows.
- The recovery key cannot spend. Its only power is to halt and resume
  operations, so a compromised recovery key cannot drain the wallet.

**Gaps and limitations you must understand before deploying:**

- **Owner can whitelist instantly.** A compromised owner key can add any
  address to the whitelist and drain up to the daily cap in the same window —
  no delay is enforced.
- **Window reset doubles the cap.** The daily cap window is fixed (not
  rolling): it resets 24 h after `LastResetTimestamp`, but only when a
  transfer is attempted. An attacker with the owner key can spend up to the
  cap at the end of one window and again immediately after reset, spending up
  to 2× the cap in a short period.
- **Lost recovery key is permanent.** If the recovery key is lost and the
  wallet is frozen, it can never be unfrozen and the recovery key cannot be
  rotated. There is no backup path.
- **Owner and daily cap are immutable.** They are set at `initialize` and
  cannot be changed. If you set a wrong cap, you must redeploy.
- **Single token only.** The token address is set at `initialize` and is
  permanent. The wallet can only move that one token.
- **No upgrade mechanism.** There is no upgrade function. Redeploy to change
  contract logic.
- **TTL-based expiry.** An idle wallet (no state-changing calls for >60 days)
  will have its instance storage archived by the network. It can be restored
  with `stellar contract restore`, after which normal operation resumes.
- **Unaudited.** This contract has not been professionally audited.

**Possible future work** (not in this release): whitelist activation delay,
daily cap setter, owner rotation, rolling window implementation.

---

## 🎬 Demo: Spending Cap & Recovery Flow on Testnet

The [`scripts/demo.sh`](scripts/demo.sh) script exercises the full policy
lifecycle on Stellar testnet:

1. Build the WASM
2. Deploy the contract
3. Initialise with a 50 XLM daily cap and a recovery key
4. Add a whitelisted recipient
5. Make a valid transfer (enforcing the daily cap)
6. Attempt to exceed the daily cap (shows `DailyCapExceeded` error)
7. Freeze the wallet with the recovery key (shows `WalletFrozen` error on transfer)
8. Rotate the recovery key (requires both owner + old recovery key auth)
9. Unfreeze with the new recovery key

```bash
# Prerequisites: Stellar CLI v22+, Rust 1.88+ (rust-toolchain.toml pins it)
./scripts/demo.sh
```

The script creates funded testnet keys, deploys a fresh wallet, and runs each
step with annotated output. The script has not been run against a live testnet
in this repository; a documented testnet run will be added in a future update.

---

## 📚 Documentation

| Document | Description |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | AA vs Stellar multisig, contract design, CEI pattern, storage layout |
| [`docs/policies.md`](docs/policies.md) | Spending policies guide with CLI examples |
| [`docs/deployment.md`](docs/deployment.md) | Deploy to testnet or mainnet |
| [`scripts/demo.sh`](scripts/demo.sh) | End-to-end testnet demo script |

---

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for full guidelines.

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.
