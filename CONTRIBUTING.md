# Contributing to Stellar Safe Wallet

First off, thank you for checking out the project and taking the time to contribute! 🎉 

`stellar-safe-wallet` introduces programmable Account Abstraction to Stellar using Soroban. Because this contract handles asset custody, security policies, and key recovery routines, community code reviews, optimizations, and additions are critical to keeping the system robust.

Please take a moment to review this document before submitting your first Pull Request (PR) to ensure a smooth review and integration process.

---

## 🗺️ Code of Conduct

By participating in this project, you agree to uphold our `CODE_OF_CONDUCT.md`. We expect all communication to be professional, constructive, and inclusive. Harassment or exclusionary behavior will not be tolerated.

---

## 🛠️ Development Workspace Setup

This repository is set up as a multi-contract Cargo workspace. You will need your environment configured for Soroban development before diving in.

### Prerequisites
* **Rust**: Version 1.74+
* **Stellar CLI**: Version v22+
* **Target**: `wasm32-unknown-unknown` target installed via rustup

### Local Project Setup
1. **Fork and clone** the repository:
   ```bash
   git clone https://github.com
   cd stellar-safe-wallet
   ```
2. **Add the WASM target**:
   ```bash
   rustup target add wasm32-unknown-unknown
   ```
3. **Build the entire workspace** (builds core wallet, testing utilities, and airdrop modules):
   ```bash
   cargo build --target wasm32-unknown-unknown --release
   ```
4. **Run the test suite** to ensure your environment is working cleanly:
   ```bash
   cargo test
   ```

---

## 💡 How to Contribute

### 1. Reporting Bugs & Security Flaws
Because this is a smart contract wallet managing real assets, security is our top priority. 
* **Critical Vulnerabilities**: If you spot a critical flaw (e.g., policy bypasses, re-entrancy issues, storage exploits), **do not open a public issue**. Please contact the maintainer directly via the security channels listed in the project root.
* **Standard Bugs**: For non-security bugs (e.g., client script errors, CLI issues), open a standard GitHub Issue with explicit steps to reproduce the behavior.

### 2. Proposing Enhancements
Have ideas for webauthn passkey support, multi-token allowance matrices, or gasless meta-transactions? 
* Open an **Issue** to discuss your proposed changes before writing code. This saves you time by ensuring your architecture lines up with the project's strategic roadmap.

### 3. Writing Code & Policies
When building your branch:
* **Branch Strategy**: Branch off `main` using descriptive naming conventions (`feature/merkle-airdrop-logic` or `fix/ttl-extension-bug`).
* **Rust Cleanliness**: Ensure your code passes standard styling checks cleanly. Run `cargo fmt` and verify that `cargo clippy` flags zero warnings.
* **Coverage Mandate**: Any modification to wallet policies, limits, or whitelisting structures must include corresponding test scenarios inside the `tests/` directory or `lib.rs` file.

---

## 🧪 Testing Guidelines (Crucial)

Since the wallet enforces **daily spending caps** and **Storage TTL expansions**, standard tests must mock ledger states accurately. When adding tests, make sure to simulate:
1. **Ledger Time Rollbacks**: Verify that rolling 24-hour caps correctly reset or cascade after the appropriate ledger sequence or timestamp has passed.
2. **Auth Failures**: Explicitly test that unauthorized addresses attempting to invoke admin, owner, or recovery keys throw precise contract errors.

---

## 📑 Pull Request Checklists

Before opening your pull request, double-check that your work ticks all of these boxes:

* [ ] Code compiles perfectly against the `wasm32-unknown-unknown` target.
* [ ] All unit and integration tests pass successfully (`cargo test`).
* [ ] The code is neatly formatted using `cargo fmt`.
* [ ] Code changes do not introduce new `clippy` compiler warnings.
* [ ] Documentation in `docs/` or the primary `README.md` has been updated to reflect any API alterations.

---

## 📜 License

By contributing to `stellar-safe-wallet`, you agree that your code and documentation contributions will be licensed under the repository's open-source **MIT License**.
