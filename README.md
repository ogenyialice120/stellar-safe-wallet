# 🔐 Soroban Safe — Account Abstraction Wallet on Stellar

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Stellar](https://img.shields.io/badge/Built%20on-Stellar-blue)](https://stellar.org)
[![Soroban](https://img.shields.io/badge/Smart%20Contracts-Soroban-purple)](https://soroban.stellar.org)
[![good first issues](https://img.shields.io/github/issues/ogenyialice120/stellar-safe-wallet/good%20first%20issue)](https://github.com/ogenyialice120/stellar-safe-wallet/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
[![CI](https://github.com/ogenyialice120/stellar-safe-wallet/actions/workflows/ci.yml/badge.svg)](https://github.com/ogenyialice120/stellar-safe-wallet/actions/workflows/ci.yml)

A programmable smart contract wallet built on **Stellar's Soroban** platform, implementing full **Account Abstraction** logic — going far beyond basic multisig into a flexible, policy-driven wallet engine.

---

## ✨ Features

| Feature | Description |
|---|---|
| 💰 **Daily Spending Caps** | Set maximum spend limits per 24-hour rolling window |
| 📋 **Whitelisted Addresses** | Restrict transfers to pre-approved recipients (max 50, dedup enforced) |
| 🔑 **Recovery Keys** | Designate a recovery signer to freeze, unfreeze, and rotate keys |
| 🔒 **Emergency Freeze / Unfreeze** | Instantly freeze or unfreeze wallet activity via recovery key |
| 🛡️ **Re-initialisation Guard** | Contract can only be initialised once; subsequent calls are rejected |
| ♻️ **Key Rotation** | Recovery key can be rotated with dual owner + recovery-key auth |
| 📦 **Storage TTL Management** | Instance storage TTL is extended on init and every transfer |
| 🗑️ **Whitelist Removal** | Owner can remove addresses from the whitelist at any time |

---

## 🏗️ Architecture

```
stellar-safe-wallet/
├── contracts/
│   ├── safe-wallet/          # Core wallet smart contract (Rust/Soroban)
│   │   ├── src/
│   │   │   └── lib.rs        # Contract entry point, all wallet logic & tests
│   │   └── Cargo.toml
│   ├── airdrop/              # Token airdrop contract with Merkle-proof claims
│   │   ├── src/
│   │   │   └── lib.rs
│   │   └── Cargo.toml
│   └── test-utils/           # Shared test utilities
│       ├── src/
│       │   └── lib.rs
│       └── Cargo.toml
├── src/
│   └── lib.rs                # Workspace-level helpers
├── tests/
│   └── placeholder.rs        # Integration test scaffold
├── docs/
│   ├── architecture.md       # Deep-dive architecture docs
│   ├── policies.md           # Spending policy guide
│   └── deployment.md         # Deployment guide
├── scripts/
│   └── deploy.sh             # Deployment scripts
├── Cargo.toml                # Workspace manifest
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites

- [Rust](https://rustup.rs/) (1.74+)
- [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/stellar-cli) (`stellar` v22+)

### Installation

```bash
# Clone the repository
git clone https://github.com/ogenyialice120/stellar-safe-wallet.git
cd stellar-safe-wallet

# Install Rust Soroban target
rustup target add wasm32-unknown-unknown

# Build the smart contract
cd contracts/safe-wallet
cargo build --target wasm32-unknown-unknown --release
```

### Running Tests

```bash
# Run all unit tests
cargo test
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
  --wasm target/wasm32-unknown-unknown/release/safe_wallet.wasm \
  --source alice \
  --network testnet
```

---

## 📖 Usage Example

```rust
// Initialize the wallet (owner, daily cap in stroops, recovery key, token address)
client.initialize(
    &owner_address,
    &1_000_000_000_i128, // 100 XLM (1 XLM = 10_000_000 stroops, so 100 XLM = 1_000_000_000)
    &recovery_address,
    &token_contract_address,
);

// Add a whitelisted recipient (owner only; max 50 addresses, no duplicates)
client.add_whitelist(&recipient_address);

// Transfer tokens — enforces whitelist, daily cap, and freeze state automatically
// Note: token address is set at initialize() time, not passed here
client.transfer(&recipient_address, &100_000_000_i128);

// Emergency freeze via recovery key
client.freeze(&recovery_address);

// Unfreeze via recovery key
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
| `freeze` | Emergency freeze — halts all transfers | Recovery key |
| `unfreeze` | Lift a freeze | Recovery key |
| `is_frozen` | Returns `true` if wallet is frozen | Read-only |
| `update_recovery_key` | Rotate recovery key | Owner + current recovery key |

---

## 🤝 Contributing

We welcome contributions! This project participates in the **[Stellar Wave Program](https://www.drips.network/wave/stellar)** — a monthly contribution sprint where you can earn rewards for your work.

See [CONTRIBUTING.md](CONTRIBUTING.md) for full guidelines.

**Quick start for Wave contributors:**
1. Browse [open issues](https://github.com/ogenyialice120/stellar-safe-wallet/issues) labeled `good first issue` or `Stellar Wave`
2. Comment on the issue to apply
3. Fork → branch → PR

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 🌊 Stellar Wave Program

This repository is submitted to the **[Stellar Wave Program](https://www.drips.network/wave/stellar)** by Drips Network. Contributors who resolve issues during an active Wave earn Points that translate to real rewards from the Stellar Development Foundation.

**Fix. Merge. Earn. 🌊**
