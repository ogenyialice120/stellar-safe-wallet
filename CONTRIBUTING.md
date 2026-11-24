# Contributing to Stellar Safe Wallet

Thank you for taking the time to contribute.

`stellar-safe-wallet` is a Soroban policy wallet. It enforces spending caps,
address whitelists, emergency freeze, and recovery-key rotation entirely within
a Soroban contract. Because this contract handles asset custody, security
reviews and correctness improvements are especially valuable.

Please read this guide before opening your first pull request.

---

## Code of Conduct

By participating you agree to uphold `CODE_OF_CONDUCT.md`. All communication
must be professional, constructive, and inclusive.

---

## Development Setup

### Prerequisites

- **Rust 1.88.0** — the `rust-toolchain.toml` in the repository root pins the
  toolchain automatically. After installing `rustup`, run any `cargo` command
  and it will download the correct toolchain.
- **Stellar CLI v22+**: https://developers.stellar.org/docs/tools/developer-tools/stellar-cli

### Clone and build

```bash
git clone https://github.com/ogenyialice120/stellar-safe-wallet.git
cd stellar-safe-wallet

# Build (native, for tests)
cargo build --workspace

# Build WASM for deployment — wasm32v1-none produces network-compatible output.
# (wasm32-unknown-unknown enables reference-types from Rust 1.82+, which the
#  Stellar network rejects.)
cargo build --release --target wasm32v1-none \
  --manifest-path contracts/safe-wallet/Cargo.toml
```

### Run the test suite

```bash
cargo test --workspace
```

### Lint and format

```bash
cargo fmt --all
cargo clippy --workspace --all-targets -- -D warnings
```

CI enforces both. A PR that introduces a clippy warning or a formatting diff
will not be merged.

---

## How to Contribute

### Reporting security vulnerabilities

Do **not** open a public issue for security bugs. See `SECURITY.md` for the
private reporting process.

### Reporting other bugs

Open a GitHub issue with steps to reproduce.

### Proposing changes

Open an issue to discuss the change before writing code. This prevents wasted
effort if the change conflicts with the project's design constraints.

---

## Coding Guidelines

- Branch off `main` with a descriptive name (`fix/ttl-extension-bug`).
- Do not add features that are not part of the product definition (no cap
  setter, owner change, upgrade function, whitelist delay, new roles). List
  ideas in the issue tracker instead.
- Contract logic must include tests. Any new policy, limit, or error path needs
  a corresponding test in `contracts/safe-wallet/src/test.rs`.
- Auth checks must be tested WITHOUT `mock_all_auths` to prove that
  unauthenticated calls fail. See existing auth tests in `test.rs` for the
  pattern.

---

## Pull Request Checklist

Before opening a PR:

- [ ] `cargo fmt --all` produces no diff.
- [ ] `cargo clippy --workspace --all-targets -- -D warnings` is clean.
- [ ] `cargo test --workspace` passes.
- [ ] `cargo build --release --target wasm32v1-none --manifest-path contracts/safe-wallet/Cargo.toml` succeeds.
- [ ] A new dated entry has been appended to `_CHANGELOG.md` (see format below).
- [ ] `docs/` updated if any public API, error code, or behavior changed.

### Changelog entry format

Append (never edit old entries) a new block at the **end** of `_CHANGELOG.md`:

```
## YYYY-MM-DD — <branch-name>

### Changes

**<file>** — what changed and why.

**Why:** The concrete bug or inaccuracy this fixes.

**BREAKING** (if callers or behavior change): describe what breaks.

**Test results:**
- Command run: `cargo test --workspace`
- Result: N tests, 0 failures.
```

---

## License

By contributing you agree that your work will be licensed under the MIT License.
