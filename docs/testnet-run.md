# Testnet Run — 2026-11-24

## Summary

`scripts/demo.sh` ran to completion on Stellar testnet on **2026-11-24**, all
17 steps passed and all assertions held. The contract exercised was
`CDKAXWO4DF5V3PLW4NGMUTSG4PH66G6VULMX2F4JIHX2IFRLFPI7WMAD`.

---

## Environment

| Item | Value |
|---|---|
| Date | 2026-11-24 |
| Network | Stellar testnet (Test SDF Network ; September 2015) |
| RPC endpoint | https://soroban-testnet.stellar.org |
| stellar-cli | 30.0.1 |
| Node.js | 24.22.2 |
| Rust toolchain | 1.88.0 (pinned by `rust-toolchain.toml`) |
| WASM target | `wasm32v1-none` |
| soroban-sdk | `=22.0.11` with the `ed25519-dalek` patch in `Cargo.toml` |
| Repo commit | `9b2bb03` (merge of `fix/helper-assembly`, PR #43) |

---

## How it was run

```bash
# From the repo root at commit 9b2bb03

# Install and test the multi-party auth helper
npm ci --prefix scripts/multi-auth
node --test scripts/multi-auth/test/*.mjs
# → 26 passed, 0 failed

# Run the demo
./scripts/demo.sh
```

The script generated four throwaway testnet accounts automatically (funding via
Friendbot), deployed a fresh wallet contract, and printed "All assertions
passed" at the end.

---

## Addresses

| Role | Address |
|---|---|
| Owner | `GD3G3UH7RBMTQPNE4FXNLKVIU24K2SJ3Q3AE3LQR2GWASF2L2GLJZ2FN` |
| Recovery key (original) | `GBLO3N2S276454644YG6NVG74VOC5YG44ZE2JUXA67JRAYWYTJZDOVLX` |
| Recipient | `GDJIS4JJMA3CJZEPDZGYCU4DUQ2VK4VOHPF2L3SV7O4ADEP7N7R4XCCX` |
| New recovery key | `GDWTEEGSH3HVRQ2NQ6XIUBGZBZJDH56W7ORNUU2B2YEDLEUQKXYVPJEF` |
| Wallet contract | `CDKAXWO4DF5V3PLW4NGMUTSG4PH66G6VULMX2F4JIHX2IFRLFPI7WMAD` |
| Native token SAC | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |

---

## Full terminal output

```
━━━ Step 0a: Configure Stellar CLI for testnet ━━━
Network 'testnet' added

━━━ Step 0b: Generate and fund throwaway testnet keys ━━━
Key already exists: demo-owner
Funding demo-owner via friendbot
Account GD3G3UH7RBMTQPNE4FXNLKVIU24K2SJ3Q3AE3LQR2GWASF2L2GLJZ2FN funded on "Test SDF Network ; September 2015"
Key already exists: demo-recovery
Funding demo-recovery via friendbot
Account GBLO3N2S276454644YG6NVG74VOC5YG44ZE2JUXA67JRAYWYTJZDOVLX funded on "Test SDF Network ; September 2015"
Key already exists: demo-recipient
Funding demo-recipient via friendbot
Account GDJIS4JJMA3CJZEPDZGYCU4DUQ2VK4VOHPF2L3SV7O4ADEP7N7R4XCCX funded on "Test SDF Network ; September 2015"
Key already exists: demo-recovery-v2
Funding demo-recovery-v2 via friendbot
Account GDWTEEGSH3HVRQ2NQ6XIUBGZBZJDH56W7ORNUU2B2YEDLEUQKXYVPJEF funded on "Test SDF Network ; September 2015"
Owner address: GD3G3UH7RBMTQPNE4FXNLKVIU24K2SJ3Q3AE3LQR2GWASF2L2GLJZ2FN
Recovery address: GBLO3N2S276454644YG6NVG74VOC5YG44ZE2JUXA67JRAYWYTJZDOVLX
Recipient address: GDJIS4JJMA3CJZEPDZGYCU4DUQ2VK4VOHPF2L3SV7O4ADEP7N7R4XCCX
New recovery address: GDWTEEGSH3HVRQ2NQ6XIUBGZBZJDH56W7ORNUU2B2YEDLEUQKXYVPJEF

━━━ Step 0c: Verify Node >= 22.12.0 and install scripts/multi-auth dependencies ━━━
Node.js 24.22.2 (>= 22.12.0)
Node dependencies already present

━━━ Step 1: Build safe-wallet contract (wasm32v1-none) ━━━
Finished `release` profile [optimized] target(s) in 0.13s
Build complete: target/wasm32v1-none/release/safe_wallet.wasm

━━━ Step 2: Deploy SafeWallet contract ━━━
Deployed SafeWallet: CDKAXWO4DF5V3PLW4NGMUTSG4PH66G6VULMX2F4JIHX2IFRLFPI7WMAD

━━━ Step 3: Resolve native (XLM) token contract address ━━━
Native token contract: CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC

━━━ Step 4: Initialize wallet (50 XLM cap, recovery key set, token = native SAC) ━━━
Wallet initialized
Daily cap: 500000000 stroops (50 XLM)
Recovery key: GBLO3N2S276454644YG6NVG74VOC5YG44ZE2JUXA67JRAYWYTJZDOVLX
Token: CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC

━━━ Step 5: Fund wallet contract with 100 XLM via native token contract ━━━
Funded wallet with 100 XLM

━━━ Step 6: Verify wallet contract balance >= 55 XLM (enough for demo) ━━━
Wallet balance: 1000000000 stroops
Balance sufficient: 1000000000 stroops (>= 550000000)

━━━ Step 7: Add recipient to whitelist ━━━
Recipient whitelisted: GDJIS4JJMA3CJZEPDZGYCU4DUQ2VK4VOHPF2L3SV7O4ADEP7N7R4XCCX

━━━ Step 8: Transfer 10 XLM — must succeed (10 spent, 40 XLM remaining in cap) ━━━
Transfer succeeded (10 XLM sent)
spent_today == 100000000
spent_today confirmed: 100000000 stroops (10 XLM)

━━━ Step 9: Transfer 45 XLM + 1 stroop — must fail with DailyCapExceeded (error 2) ━━━
Cap arithmetic: 100_000_000 (spent) + 450_000_001 = 550_000_001 > 500_000_000 cap
Correctly rejected with DailyCapExceeded

━━━ Step 10: Freeze wallet with recovery key ━━━
Wallet frozen

━━━ Step 11: Assert is_frozen == true ━━━
is_frozen == true

━━━ Step 12: Transfer while frozen — must fail with WalletFrozen (error 4) ━━━
Correctly rejected with WalletFrozen

━━━ Step 13: Rotate recovery key — owner + current recovery key both sign ━━━
Calling rotate-recovery-key helper (secrets in env vars only)
Recovery key rotated to: GDWTEEGSH3HVRQ2NQ6XIUBGZBZJDH56W7ORNUU2B2YEDLEUQKXYVPJEF
Transaction hash: e5afa31b3459b4e6c94f0b84b90393a3d5d475a91eba317f7f3b712c08f921af

━━━ Step 13v: Assert on-chain: get_recovery_key returns new address ━━━
get_recovery_key == GDWTEEGSH3HVRQ2NQ6XIUBGZBZJDH56W7ORNUU2B2YEDLEUQKXYVPJEF
Recovery key confirmed on-chain: GDWTEEGSH3HVRQ2NQ6XIUBGZBZJDH56W7ORNUU2B2YEDLEUQKXYVPJEF

━━━ Step 14: Unfreeze with OLD recovery key — must fail with Unauthorized (error 1) ━━━
Correctly rejected old recovery key with Unauthorized

━━━ Step 15: Unfreeze with new recovery key — must succeed ━━━
Wallet unfrozen

━━━ Step 16: Assert is_frozen == false ━━━
is_frozen == false

━━━ Step 17: Transfer 5 XLM after unfreeze — must succeed ━━━
Transfer succeeded (5 XLM sent)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Demo complete
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Contract ID: CDKAXWO4DF5V3PLW4NGMUTSG4PH66G6VULMX2F4JIHX2IFRLFPI7WMAD
Network: testnet
Owner: GD3G3UH7RBMTQPNE4FXNLKVIU24K2SJ3Q3AE3LQR2GWASF2L2GLJZ2FN
Recovery (new): GDWTEEGSH3HVRQ2NQ6XIUBGZBZJDH56W7ORNUU2B2YEDLEUQKXYVPJEF
Recipient: GDJIS4JJMA3CJZEPDZGYCU4DUQ2VK4VOHPF2L3SV7O4ADEP7N7R4XCCX
Native token: CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC

Step | Expected                             | Result   | Tx hash
-----+--------------------------------------+----------+-----------------------------------------------------------------
2    | deploy succeeds                      | OK       | e6107155641125c26dcb1516fe3ffc547aee7b9cabb003a7a12522f02d9cd698
3    | native token resolved                | OK       | -
4    | initialize succeeds                  | OK       | 307a72d0d5442a967818800883558b6e6b2896b5d7071d3a7842c276d59ca7e7
5    | fund contract succeeds               | OK       | 578375deb73dcf354431c65316f1e328255cfa76d083bfdf59a1f8a79dd755c2
6    | balance >= 55 XLM                    | OK       | -
7    | add_whitelist succeeds               | OK       | 059ce288cea5b7f1cd2ed59ab3ba2f17ec5ca61b3d21cb2be1461abb7ec1ec9c
8    | transfer 10 XLM succeeds             | OK       | 0c4426ed378139ce6192876dad185e82e05f2232464913a7309bef045e560088
9    | DailyCapExceeded (error 2)           | OK       | -
10   | freeze succeeds                      | OK       | 14ceae711f1510081acc0cc086e3578398fe44386dbbdd372a7048efb27a45e6
11   | is_frozen == true                    | OK       | -
12   | WalletFrozen (error 4)               | OK       | -
13   | key rotation (dual-auth)             | OK       | e5afa31b3459b4e6c94f0b84b90393a3d5d475a91eba317f7f3b712c08f921af
13v  | recovery key == new addr            | OK       | -
14   | Unauthorized (error 1)               | OK       | -
15   | unfreeze (new key) succeeds          | OK       | 248b8d8ca924a068a6ef1ca41390a3e716f848366c826d89e7b46a5ec67b9fb1
16   | is_frozen == false                   | OK       | -
17   | transfer 5 XLM succeeds             | OK       | 57e7ba7f3af8280f119e1e6f7e9e402e171a6502d40dc69402bfabf94608a30a

All assertions passed.
```

---

## Step-by-step results with Stellar Expert links

Steps 9, 12, and 14 were rejected by the CLI's simulation before submission.
They have no transaction hash and do not appear on-chain as transactions.

| Step | Expected | Result | Tx hash | Explorer |
|---|---|---|---|---|
| 2 | deploy succeeds | OK | `e6107155641125c26dcb1516fe3ffc547aee7b9cabb003a7a12522f02d9cd698` | [view](https://stellar.expert/explorer/testnet/tx/e6107155641125c26dcb1516fe3ffc547aee7b9cabb003a7a12522f02d9cd698) |
| 3 | native token resolved | OK | — (read-only) | — |
| 4 | initialize succeeds | OK | `307a72d0d5442a967818800883558b6e6b2896b5d7071d3a7842c276d59ca7e7` | [view](https://stellar.expert/explorer/testnet/tx/307a72d0d5442a967818800883558b6e6b2896b5d7071d3a7842c276d59ca7e7) |
| 5 | fund contract succeeds | OK | `578375deb73dcf354431c65316f1e328255cfa76d083bfdf59a1f8a79dd755c2` | [view](https://stellar.expert/explorer/testnet/tx/578375deb73dcf354431c65316f1e328255cfa76d083bfdf59a1f8a79dd755c2) |
| 6 | balance >= 55 XLM | OK | — (read-only) | — |
| 7 | add\_whitelist succeeds | OK | `059ce288cea5b7f1cd2ed59ab3ba2f17ec5ca61b3d21cb2be1461abb7ec1ec9c` | [view](https://stellar.expert/explorer/testnet/tx/059ce288cea5b7f1cd2ed59ab3ba2f17ec5ca61b3d21cb2be1461abb7ec1ec9c) |
| 8 | transfer 10 XLM succeeds | OK | `0c4426ed378139ce6192876dad185e82e05f2232464913a7309bef045e560088` | [view](https://stellar.expert/explorer/testnet/tx/0c4426ed378139ce6192876dad185e82e05f2232464913a7309bef045e560088) |
| 9 | DailyCapExceeded (error 2) | OK | — (simulation rejected; no on-chain tx) | — |
| 10 | freeze succeeds | OK | `14ceae711f1510081acc0cc086e3578398fe44386dbbdd372a7048efb27a45e6` | [view](https://stellar.expert/explorer/testnet/tx/14ceae711f1510081acc0cc086e3578398fe44386dbbdd372a7048efb27a45e6) |
| 11 | is\_frozen == true | OK | — (read-only) | — |
| 12 | WalletFrozen (error 4) | OK | — (simulation rejected; no on-chain tx) | — |
| 13 | key rotation (dual-auth) | OK | `e5afa31b3459b4e6c94f0b84b90393a3d5d475a91eba317f7f3b712c08f921af` | [view](https://stellar.expert/explorer/testnet/tx/e5afa31b3459b4e6c94f0b84b90393a3d5d475a91eba317f7f3b712c08f921af) |
| 13v | recovery key == new addr | OK | — (read-only) | — |
| 14 | Unauthorized (error 1) | OK | — (simulation rejected; no on-chain tx) | — |
| 15 | unfreeze (new key) succeeds | OK | `248b8d8ca924a068a6ef1ca41390a3e716f848366c826d89e7b46a5ec67b9fb1` | [view](https://stellar.expert/explorer/testnet/tx/248b8d8ca924a068a6ef1ca41390a3e716f848366c826d89e7b46a5ec67b9fb1) |
| 16 | is\_frozen == false | OK | — (read-only) | — |
| 17 | transfer 5 XLM succeeds | OK | `57e7ba7f3af8280f119e1e6f7e9e402e171a6502d40dc69402bfabf94608a30a` | [view](https://stellar.expert/explorer/testnet/tx/57e7ba7f3af8280f119e1e6f7e9e402e171a6502d40dc69402bfabf94608a30a) |

Contract page: https://lab.stellar.org/r/testnet/contract/CDKAXWO4DF5V3PLW4NGMUTSG4PH66G6VULMX2F4JIHX2IFRLFPI7WMAD

---

## Earlier runs on the same day

Two earlier runs on 2026-11-24 found real bugs, both fixed and merged before
this run:

**Run 1** (contract `CASPY7BHTYBE77EELEPZRFMJJV3WN4B7SA4HWRL6YDOCDP72JCYH5VBX`): steps
0–12 passed. Step 13 then failed with TxMalformed because `stellar tx sign`
signs the transaction envelope but not the Soroban authorization entry the
recovery key needs. Fix: the `scripts/multi-auth/rotate-recovery-key.mjs`
helper, which calls `authorizeEntry()` from `@stellar/stellar-sdk`. The failed
transaction `c599c663271d026c8bfa9560af9dd7c75ba2ca0825e09a5338058a29e5558fea`
from that run is not evidence of correct behaviour.

**Run 2** (contract `CB3HSYHEVLFCFQJDJMBS52CH5S67FOBRTZTQT3O7JDHUF6CHQ72FNBM4`): steps
0–12 passed. The helper then crashed with
`FATAL: assembled.sign is not a function` because `assembleTransaction()`
returns a `TransactionBuilder`, which must be `.build()`-ed before `.sign()` is
called. A missing re-simulation step was fixed at the same time. Both fixes are
in PR #43 (`fix/helper-assembly`), merged at commit `9b2bb03`.

---

## What this run proves

- `initialize` with a 50 XLM cap and the native token SAC address succeeds.
- Funding the wallet contract via the native SAC `transfer` function succeeds.
- A whitelisted recipient can be added.
- A 10 XLM transfer succeeds and `get_spent_today` returns 100 000 000 stroops.
- A transfer that would bring `spent_today` to 550 000 001 (over the 500 000 000
  cap) is rejected with `DailyCapExceeded` before submission.
- The recovery key can freeze the wallet; `is_frozen` returns `true`.
- A transfer while frozen is rejected with `WalletFrozen` before submission.
- Recovery-key rotation signed by **both** the owner and the current recovery
  key succeeds (dual Soroban authorization, tx
  `e5afa31b3459b4e6c94f0b84b90393a3d5d475a91eba317f7f3b712c08f921af`).
- `get_recovery_key` returns the new address immediately after rotation.
- The old recovery key is rejected with `Unauthorized` when it tries to unfreeze.
- The new recovery key successfully unfreezes the wallet; `is_frozen` returns
  `false`.
- A 5 XLM transfer after unfreeze succeeds (40 XLM remaining in the cap window).

## What this run does NOT prove

- **50-address whitelist limit.** Only one address was whitelisted in this run.
- **TTL extension behaviour.** The Soroban test harness does not expose TTL
  values; on-chain TTL was not read back.
- **Event contents on-chain.** Events were emitted (no contract panic) but their
  XDR values were not decoded and verified.
- **Fixed 24-hour window reset and the up-to-2× cap around a reset.** Only one
  transfer window was used; the reset boundary was not crossed.
- **Tokens other than native XLM.** Only the native token SAC was used.
- **Mainnet behaviour.** This was a testnet-only run with throwaway funded
  accounts.
- **Load, concurrency, or adversarial conditions.**
- **Security audit.** This contract has not been professionally audited.
- **On-chain accuracy of rejected calls.** Steps 9, 12, and 14 were rejected by
  the CLI's simulation layer. They did not reach the network as transactions.
  The contract's error codes (`DailyCapExceeded = 2`, `WalletFrozen = 4`,
  `Unauthorized = 1`) were confirmed by simulation, not by on-chain execution.
