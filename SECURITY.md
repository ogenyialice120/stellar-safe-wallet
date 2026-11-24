# Security Policy

## Supported Versions

This repository contains a **single Soroban smart contract** (`contracts/safe-wallet`).
It has not been professionally audited. Deploy to mainnet at your own risk.

| Version | Supported |
|---|---|
| Latest commit on `main` | ✅ Receives fixes |
| Any prior release | ❌ No backports |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security bugs.** Public disclosure of
a vulnerability before it is fixed could put deployed wallets at risk.

To report a vulnerability privately:

1. Email the maintainer at the address in the repository's GitHub profile, or
2. Use [GitHub's private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
   if enabled for this repository.

Include:
- A description of the vulnerability and affected code paths.
- Steps to reproduce or a proof-of-concept (can be shared as a private Gist).
- The impact you assess (e.g. funds at risk, auth bypass, DoS).

You will receive an acknowledgement within 7 days. If the issue is confirmed,
a fix will be developed privately and disclosed after deployment.

## Known Limitations

The following are known design constraints, not bugs. See the README security
model section for full details.

- **Owner key compromise**: a compromised owner can whitelist any address
  instantly and drain up to the daily cap per window.
- **Window reset**: up to 2× the daily cap can be spent around a window reset.
- **Lost recovery key**: if the recovery key is lost and the wallet is frozen,
  it cannot be unfrozen.
- **No upgrade mechanism**: contract logic cannot be changed after deployment.
- **Unaudited**: this code has not been professionally audited.
