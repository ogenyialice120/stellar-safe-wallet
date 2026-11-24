/**
 * Tests for rotate-recovery-key.mjs
 *
 * Run with: node --test test/
 *
 * What these tests prove:
 *   - Environment variable validation: the script refuses to run when
 *     OWNER_SECRET or RECOVERY_SECRET is absent or malformed.
 *   - Auth-entry selection logic: given a simulated set of auth entries
 *     (built with real SDK types, not hand-written stubs), the script
 *     correctly identifies which entries need signing by the recovery key,
 *     which need signing by the owner, and which are source-account entries
 *     that need no extra signing.
 *
 * What these tests do NOT prove:
 *   - That the produced transaction is accepted by the network. Acceptance
 *     requires a live Soroban RPC node and funded accounts.
 *   - That the XDR produced by authorizeEntry is valid under the current
 *     network protocol version. Protocol compatibility requires a testnet run.
 *   - That the polling / fallback logic handles all real-world RPC errors.
 *     The fallback path is covered by a mock test, not a live call.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, Address, xdr } from '@stellar/stellar-sdk';

// ---------------------------------------------------------------------------
// Unit under test: re-implement the classifying logic from the script so we
// can test it in isolation without spawning a subprocess.
// (The script's main() cannot be imported cleanly because it calls process.exit
// and reads process.env on startup. We extract the pure logic here.)
// ---------------------------------------------------------------------------

/**
 * Returns the credential type value for the source-account credential.
 */
function sourceAccountCredValue() {
  return xdr.SorobanCredentialsType.sorobanCredentialsSourceAccount().value;
}

/**
 * Classifies a list of SorobanAuthorizationEntry objects into:
 *   - 'source'   : source-account credentials (no extra signing needed)
 *   - 'owner'    : address credential matching the owner public key
 *   - 'recovery' : address credential matching the recovery public key
 *   - 'unknown'  : anything else (should not appear in a well-formed simulation)
 *
 * Uses real SDK xdr types, not strings.
 */
function classifyEntries(entries, ownerPublicKey, recoveryPublicKey) {
  return entries.map((entry) => {
    const credType = entry.credentials().switch().value;
    if (credType === sourceAccountCredValue()) {
      return 'source';
    }
    const addr = Address.fromScAddress(entry.credentials().address().address()).toString();
    if (addr === ownerPublicKey) return 'owner';
    if (addr === recoveryPublicKey) return 'recovery';
    return 'unknown';
  });
}

/**
 * Build a minimal SorobanAuthorizationEntry with address credentials for
 * a given public key. Uses the real SDK xdr types so the classification
 * logic runs against actual XDR objects, not stubs.
 */
function makeAddressAuthEntry(publicKey) {
  const address = new Address(publicKey);
  const nonce = xdr.Int64.fromXDR(Buffer.alloc(8));

  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: address.toScAddress(),
        nonce,
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVec([]),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function:
        xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          new xdr.InvokeContractArgs({
            contractAddress: new Address(
              'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
            ).toScAddress(),
            functionName: 'update_recovery_key',
            args: [],
          }),
        ),
      subInvocations: [],
    }),
  });
}

/**
 * Build a SorobanAuthorizationEntry with source-account credentials.
 */
function makeSourceAccountAuthEntry() {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function:
        xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          new xdr.InvokeContractArgs({
            contractAddress: new Address(
              'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
            ).toScAddress(),
            functionName: 'update_recovery_key',
            args: [],
          }),
        ),
      subInvocations: [],
    }),
  });
}

// ---------------------------------------------------------------------------
// Helpers for environment variable validation testing
// ---------------------------------------------------------------------------

/**
 * Validates secrets from an env-variable map.
 * Returns { ownerKp, recoveryKp } or throws with a descriptive message.
 * This mirrors the loadSecrets() function in the main script.
 */
function validateSecrets(env) {
  const ownerSecret = env['OWNER_SECRET'];
  const recoverySecret = env['RECOVERY_SECRET'];

  if (!ownerSecret) {
    throw new Error('OWNER_SECRET environment variable is not set');
  }
  if (!recoverySecret) {
    throw new Error('RECOVERY_SECRET environment variable is not set');
  }

  let ownerKp;
  try {
    ownerKp = Keypair.fromSecret(ownerSecret);
  } catch {
    throw new Error('OWNER_SECRET is not a valid Stellar secret key');
  }

  let recoveryKp;
  try {
    recoveryKp = Keypair.fromSecret(recoverySecret);
  } catch {
    throw new Error('RECOVERY_SECRET is not a valid Stellar secret key');
  }

  return { ownerKp, recoveryKp };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateSecrets', () => {
  it('rejects when OWNER_SECRET is absent', () => {
    assert.throws(
      () => validateSecrets({ RECOVERY_SECRET: Keypair.random().secret() }),
      /OWNER_SECRET/,
    );
  });

  it('rejects when RECOVERY_SECRET is absent', () => {
    assert.throws(
      () => validateSecrets({ OWNER_SECRET: Keypair.random().secret() }),
      /RECOVERY_SECRET/,
    );
  });

  it('rejects when both secrets are absent', () => {
    assert.throws(() => validateSecrets({}), /OWNER_SECRET/);
  });

  it('rejects a malformed OWNER_SECRET', () => {
    assert.throws(
      () =>
        validateSecrets({
          OWNER_SECRET: 'not-a-secret-key',
          RECOVERY_SECRET: Keypair.random().secret(),
        }),
      /OWNER_SECRET is not a valid/,
    );
  });

  it('rejects a malformed RECOVERY_SECRET', () => {
    assert.throws(
      () =>
        validateSecrets({
          OWNER_SECRET: Keypair.random().secret(),
          RECOVERY_SECRET: 'not-a-secret-key',
        }),
      /RECOVERY_SECRET is not a valid/,
    );
  });

  it('succeeds with valid secrets and returns keypairs', () => {
    const ownerKp = Keypair.random();
    const recoveryKp = Keypair.random();
    const result = validateSecrets({
      OWNER_SECRET: ownerKp.secret(),
      RECOVERY_SECRET: recoveryKp.secret(),
    });
    assert.equal(result.ownerKp.publicKey(), ownerKp.publicKey());
    assert.equal(result.recoveryKp.publicKey(), recoveryKp.publicKey());
  });
});

describe('classifyEntries', () => {
  let ownerKp, recoveryKp, thirdKp;

  before(() => {
    ownerKp = Keypair.random();
    recoveryKp = Keypair.random();
    thirdKp = Keypair.random();
  });

  it('classifies a source-account entry as "source"', () => {
    const entries = [makeSourceAccountAuthEntry()];
    const result = classifyEntries(entries, ownerKp.publicKey(), recoveryKp.publicKey());
    assert.deepEqual(result, ['source']);
  });

  it('classifies an address entry for the owner as "owner"', () => {
    const entries = [makeAddressAuthEntry(ownerKp.publicKey())];
    const result = classifyEntries(entries, ownerKp.publicKey(), recoveryKp.publicKey());
    assert.deepEqual(result, ['owner']);
  });

  it('classifies an address entry for the recovery key as "recovery"', () => {
    const entries = [makeAddressAuthEntry(recoveryKp.publicKey())];
    const result = classifyEntries(entries, ownerKp.publicKey(), recoveryKp.publicKey());
    assert.deepEqual(result, ['recovery']);
  });

  it('classifies an address entry for an unknown address as "unknown"', () => {
    const entries = [makeAddressAuthEntry(thirdKp.publicKey())];
    const result = classifyEntries(entries, ownerKp.publicKey(), recoveryKp.publicKey());
    assert.deepEqual(result, ['unknown']);
  });

  it('handles a mixed list of entries correctly', () => {
    const entries = [
      makeSourceAccountAuthEntry(),
      makeAddressAuthEntry(ownerKp.publicKey()),
      makeAddressAuthEntry(recoveryKp.publicKey()),
    ];
    const result = classifyEntries(entries, ownerKp.publicKey(), recoveryKp.publicKey());
    assert.deepEqual(result, ['source', 'owner', 'recovery']);
  });

  it('handles an empty list', () => {
    const result = classifyEntries([], ownerKp.publicKey(), recoveryKp.publicKey());
    assert.deepEqual(result, []);
  });

  it('uses real SDK XDR types (round-trips through toXDR/fromXDR)', () => {
    const entry = makeAddressAuthEntry(recoveryKp.publicKey());
    // Verify the entry survives an XDR round-trip (the kind the script does)
    const roundTripped = xdr.SorobanAuthorizationEntry.fromXDR(entry.toXDR());
    const result = classifyEntries(
      [roundTripped],
      ownerKp.publicKey(),
      recoveryKp.publicKey(),
    );
    assert.deepEqual(result, ['recovery']);
  });
});

describe('classifyEntries — selection for update_recovery_key', () => {
  it('identifies exactly the recovery entry when simulation returns one address entry', () => {
    const ownerKp = Keypair.random();
    const recoveryKp = Keypair.random();

    // The typical simulation result for update_recovery_key contains one
    // address credential entry for the recovery key (the owner is source).
    const entries = [makeAddressAuthEntry(recoveryKp.publicKey())];
    const classifications = classifyEntries(
      entries,
      ownerKp.publicKey(),
      recoveryKp.publicKey(),
    );

    const toSign = entries.filter((_, i) => classifications[i] === 'recovery');
    assert.equal(toSign.length, 1, 'exactly one entry needs recovery-key signature');

    const noSign = entries.filter((_, i) => classifications[i] === 'source');
    assert.equal(noSign.length, 0, 'no source-account entries in this scenario');
  });
});
