# Deployment Guide

## Prerequisites

- Rust 1.88+ with the `wasm32v1-none` target. The `rust-toolchain.toml` in the
  repository root pins the toolchain and target automatically when you run any
  `cargo` command. If you install Rust manually:
  ```bash
  rustup toolchain install 1.88.0
  rustup target add wasm32v1-none --toolchain 1.88.0
  ```
  > **Why `wasm32v1-none` and not `wasm32-unknown-unknown`?**  
  > From Rust 1.82+, `wasm32-unknown-unknown` enables the `reference-types`
  > WebAssembly proposal by default. The Stellar network rejects WASM binaries
  > compiled with that proposal enabled. `wasm32v1-none` targets WebAssembly
  > 1.0 (MVP) and produces binaries the network accepts.
- Stellar CLI v22+: https://developers.stellar.org/docs/tools/developer-tools/stellar-cli

## Build

```bash
# Build the safe-wallet contract for deployment
cargo build --release --target wasm32v1-none \
  --manifest-path contracts/safe-wallet/Cargo.toml

# Artifact location:
# target/wasm32v1-none/release/safe_wallet.wasm
```

## Testnet

```bash
# Configure network
stellar network add testnet \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"

# Generate and fund account
stellar keys generate deployer --network testnet
stellar keys fund deployer --network testnet

# Deploy SafeWallet
stellar contract deploy \
  --wasm target/wasm32v1-none/release/safe_wallet.wasm \
  --source deployer \
  --network testnet
```

## Initialize after deployment

After deploying, call `initialize` to set the owner, daily cap, recovery key,
and token address. The wallet is inert until `initialize` is called once.

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <OWNER_KEY> \
  --network testnet \
  -- initialize \
  --owner <OWNER_ADDRESS> \
  --daily_cap 1000000000 \
  --recovery_key <RECOVERY_ADDRESS> \
  --token <TOKEN_CONTRACT_ADDRESS>
```

`daily_cap` is in stroops (1 XLM = 10 000 000 stroops), so `1000000000` = 100 XLM.

The `--token` argument must be the **contract address** of the Stellar Asset
Contract (SAC) for the token you want the wallet to manage — not the asset
string "native". To find the native XLM contract address on testnet:

```bash
stellar contract id asset --asset native --network testnet
```

Pass the resulting contract ID (a `C…` address) as `--token`.

## End-to-end demo

`scripts/demo.sh` deploys a fresh wallet, funds it, and runs the full policy
lifecycle. Each step is asserted: unexpected successes and unexpected errors
both fail the script immediately. All 17 steps were confirmed on Stellar
testnet on 2026-11-24 (contract
`CDKAXWO4DF5V3PLW4NGMUTSG4PH66G6VULMX2F4JIHX2IFRLFPI7WMAD`). Full output
and all transaction hashes are in
[`docs/testnet-run.md`](testnet-run.md).

```bash
./scripts/demo.sh
```

Prerequisites: Stellar CLI v22+, Rust 1.88.0 (from `rust-toolchain.toml`), and
Node.js >= 22.12.0 (for step 13's multi-party auth helper).

**Why Node.js is required for step 13:** `stellar tx sign` signs the transaction
*envelope*. It cannot sign the Soroban authorization entries that non-source
addresses need. `update_recovery_key` calls `require_auth()` on both the owner
and the current recovery key; the recovery key's auth entry must be signed with
`authorizeEntry()` from `@stellar/stellar-sdk`. The helper in
`scripts/multi-auth/rotate-recovery-key.mjs` does this correctly.

## Stellar CLI installation

The recommended way to install Stellar CLI:

```bash
curl -fsSL https://github.com/stellar/stellar-cli/raw/main/install.sh | sh
```

This installs the latest release. The demo and deploy scripts have been written
against v22+.
