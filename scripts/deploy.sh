#!/usr/bin/env bash
# deploy.sh — Deploy the SafeWallet contract to a Stellar network.
#
# Usage:
#   ./scripts/deploy.sh [--network NETWORK]
#
# Defaults:
#   NETWORK=testnet
#
# Prerequisites:
#   - Rust 1.88.0 with wasm32v1-none target — rust-toolchain.toml pins this
#       automatically; or run:
#       rustup toolchain install 1.88.0
#       rustup target add wasm32v1-none --toolchain 1.88.0
#   - Stellar CLI v22+, installed with:
#       curl -fsSL https://github.com/stellar/stellar-cli/raw/main/install.sh | sh
#   - Internet access (testnet RPC + friendbot)

set -euo pipefail

NETWORK="testnet"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --network)      NETWORK="$2"; shift 2 ;;
    --network=*)    NETWORK="${1#*=}"; shift ;;
    -h|--help)
      echo "Usage: $0 [--network NETWORK]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: $0 [--network NETWORK]" >&2
      exit 1
      ;;
  esac
done

# Testnet defaults; export RPC_URL and PASSPHRASE to override for custom networks.
RPC_URL="${RPC_URL:-https://soroban-testnet.stellar.org}"
PASSPHRASE="${PASSPHRASE:-Test SDF Network ; September 2015}"

DEPLOYER_KEY="deployer"
SAFE_WALLET_WASM="target/wasm32v1-none/release/safe_wallet.wasm"

echo "==> Target network: $NETWORK"

# Configure the target network. Treat "already exists" as success; any other
# non-zero exit is a real failure and will stop the script.
if ! stellar network add "$NETWORK" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$PASSPHRASE" 2>&1; then
  if stellar network ls 2>/dev/null | grep -q "^$NETWORK\\b"; then
    echo "Network '$NETWORK' already configured."
  else
    echo "ERROR: failed to configure network '$NETWORK'." >&2
    exit 1
  fi
fi

# Generate a deployer key if it does not already exist.
if ! stellar keys address "$DEPLOYER_KEY" >/dev/null 2>&1; then
  echo "==> Generating deployer key '$DEPLOYER_KEY'"
  stellar keys generate "$DEPLOYER_KEY" --network "$NETWORK"
fi

# Fund the deployer account via friendbot.
echo "==> Funding deployer account (friendbot)"
if ! stellar keys fund "$DEPLOYER_KEY" --network "$NETWORK" 2>&1; then
  echo "WARNING: Friendbot funding failed. This is normal for already-funded accounts." >&2
  echo "         If this is a fresh key, check network connectivity before continuing." >&2
fi

echo "==> Building safe-wallet contract (wasm32v1-none)"
cargo build --release --target wasm32v1-none \
  --manifest-path contracts/safe-wallet/Cargo.toml

if [[ ! -f "$SAFE_WALLET_WASM" ]]; then
  echo "ERROR: WASM artifact not found: $SAFE_WALLET_WASM" >&2
  exit 1
fi

echo "==> Deploying SafeWallet"
SAFE_WALLET_ID=$(stellar contract deploy \
  --wasm "$SAFE_WALLET_WASM" \
  --source "$DEPLOYER_KEY" \
  --network "$NETWORK")

if [[ -z "$SAFE_WALLET_ID" ]]; then
  echo "ERROR: deploy returned an empty contract ID." >&2
  exit 1
fi

echo "SafeWallet contract ID: $SAFE_WALLET_ID"
echo ""
echo "Deployment complete!"
echo "  Network:       $NETWORK"
echo "  SafeWallet ID: $SAFE_WALLET_ID"
echo ""
echo "Next: call 'initialize' on contract $SAFE_WALLET_ID."
echo "See docs/deployment.md for the full initialize command."
