#!/usr/bin/env bash
# check_claims.sh — Validate docs/claims-audit.md against test.rs.
#
# Checks:
#   1. Every VERIFIED row must have a test name (not blank, not "N/A").
#   2. Every named test must exist as `fn <name>` (whole word) in test.rs.
#   3. Every status must be one of: VERIFIED, REWORDED, REMOVED.
#
# This script proves that a named test exists in the source file.
# It does NOT prove that the test covers the specific claim.
#
# Usage: ./scripts/check_claims.sh
# Exit code: 0 on success, 1 on any failure.

set -euo pipefail

AUDIT="docs/claims-audit.md"
TEST_FILE="contracts/safe-wallet/src/test.rs"
FAILURES=0

if [[ ! -f "$AUDIT" ]]; then
  echo "ERROR: $AUDIT not found" >&2
  exit 1
fi

if [[ ! -f "$TEST_FILE" ]]; then
  echo "ERROR: $TEST_FILE not found" >&2
  exit 1
fi

# Parse table rows: lines that start with | <number> |
while IFS='|' read -r _ num claim source fn_name test_name status _; do
  # Skip header, separator, and non-data lines.
  num=$(echo "$num" | tr -d ' ')
  [[ "$num" =~ ^[0-9]+$ ]] || continue

  status=$(echo "$status" | tr -d ' ')
  test_name=$(echo "$test_name" | tr -d ' ' | tr -d '`')

  # Check 3: status must be one of the three allowed values.
  case "$status" in
    VERIFIED|REWORDED|REMOVED) ;;
    *)
      echo "FAILED [row $num]: unknown status '$status' (must be VERIFIED, REWORDED, or REMOVED)" >&2
      FAILURES=$((FAILURES + 1))
      continue
      ;;
  esac

  # Only VERIFIED rows need a test name.
  [[ "$status" == "VERIFIED" ]] || continue

  # Check 1: VERIFIED row must have a non-empty, non-N/A test name.
  if [[ -z "$test_name" || "$test_name" == "N/A" ]]; then
    echo "FAILED [row $num]: VERIFIED row has no test name" >&2
    FAILURES=$((FAILURES + 1))
    continue
  fi

  # Check 2: the named test must exist as `fn <name>` in test.rs (whole word).
  if ! grep -qwF "fn ${test_name}" "$TEST_FILE"; then
    echo "FAILED [row $num]: test 'fn ${test_name}' not found in $TEST_FILE" >&2
    FAILURES=$((FAILURES + 1))
  fi

done < "$AUDIT"

if [[ $FAILURES -eq 0 ]]; then
  echo "check_claims: all rows passed."
  exit 0
else
  echo "check_claims: $FAILURES failure(s) found." >&2
  exit 1
fi
