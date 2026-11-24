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
