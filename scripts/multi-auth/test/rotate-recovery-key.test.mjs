/**
 * Tests for the multi-auth helper (lib.mjs and rotate-recovery-key.mjs).
 *
 * Run with: node --test test/
 *
 * What these tests prove:
 *   - Environment variable validation: validateSecrets refuses absent or
 *     malformed OWNER_SECRET / RECOVERY_SECRET.
 *   - Auth-entry classification: classifyEntries correctly identifies source,
 *     owner, recovery, and unknown entries given real SDK XDR objects.
 *   - Transaction assembly and envelope signing: assembleAndSign calls
 *     assembleTransaction().build().sign() in the correct order, producing a
 *     Transaction (not a TransactionBuilder) whose signatures array is non-empty.
 *   - Polling with an injected RPC: SUCCESS, FAILED, NOT_FOUND→SUCCESS,
 *     SDK parse error with raw fallback reporting SUCCESS, and timeout when
 *     neither path resolves before the deadline.
 *
 * What these tests do NOT prove:
 *   - That the produced transaction is accepted by the network. Acceptance
 *     requires a live Soroban RPC node and funded accounts.
 *   - That the XDR produced by authorizeEntry is valid under the current
 *     network protocol version. Protocol compatibility requires a testnet run.
 *   - That the fee computed by assembleAndSign matches what the network will
 *     actually charge. The fee in these tests is a stub value.
 *   - That the polling / fallback logic handles every real-world RPC error
 *     variant. The fallback path is exercised with a fake throwing function,
 *     not a live call.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  Keypair,
  Address,
  xdr,
  TransactionBuilder,
  Networks,
  Operation,
  Account,
  SorobanDataBuilder,
} from '@stellar/stellar-sdk';
// Import the real implementation — these tests exercise the shipped code.
import {
  validateSecrets,
  classifyEntries,
  assembleAndSign,
  pollForResult,
} from '../lib.mjs';

// ---------------------------------------------------------------------------
// XDR helpers for building test fixtures
// ---------------------------------------------------------------------------

const DUMMY_CONTRACT = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';

/**
 * Build a minimal SorobanAuthorizationEntry with address credentials for a
 * given public key. Uses real SDK xdr types so the classification logic runs
 * against actual XDR objects, not stubs.
 */
function makeAddressAuthEntry(publicKey) {
  const address = new Address(publicKey);
  // xdr.Int64 — construct from a Buffer of 8 zero bytes (nonce = 0)
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
            contractAddress: new Address(DUMMY_CONTRACT).toScAddress(),
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
            contractAddress: new Address(DUMMY_CONTRACT).toScAddress(),
            functionName: 'update_recovery_key',
            args: [],
          }),
        ),
      subInvocations: [],
    }),
  });
}

/**
 * Build a minimal Transaction with an invokeContractFunction operation and
 * fake auth entries attached. Used to test assembleAndSign without a network.
 *
 * @param {xdr.SorobanAuthorizationEntry[]} auth
 * @param {string} sourcePublicKey
 * @returns {import('@stellar/stellar-base').Transaction}
 */
function buildTxWithAuth(auth, sourcePublicKey) {
  const account = new Account(sourcePublicKey, '100');
  return new TransactionBuilder(account, {
    fee: '1000000',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: DUMMY_CONTRACT,
        function: 'update_recovery_key',
        args: [new Address(Keypair.random().publicKey()).toScVal()],
        auth,
      }),
    )
    .setTimeout(300)
    .build();
}

/**
 * Build a fake SimulateTransactionSuccessResponse that assembleTransaction
 * accepts. The auth field is omitted so assembleTransaction preserves the
 * existing auth entries from the transaction.
 *
 * assembleTransaction reads: sim.transactionData (a SorobanDataBuilder),
 * sim.minResourceFee, and sim._parsed. It checks isSimulationSuccess(sim)
 * which requires 'transactionData' in sim.
 *
 * @returns {object} fake SimulateTransactionSuccessResponse
 */
function makeFakeSim() {
  return {
    id: 'fake',
    latestLedger: 1000,
    events: [],
    _parsed: true,
    transactionData: new SorobanDataBuilder(),
    minResourceFee: '100',
    result: {
      auth: [],
      retval: xdr.ScVal.scvVoid(),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests: validateSecrets
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

// ---------------------------------------------------------------------------
// Tests: classifyEntries
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests: assembleAndSign
//
// These tests prove that assembleAndSign produces a Transaction (not a
// TransactionBuilder) whose signatures array contains the owner's signature.
// The key pre-condition for the original FATAL bug was that
// assembleTransaction returns a TransactionBuilder, which does not have .sign;
// these tests would fail with "builtTx.sign is not a function" on the old code.
// ---------------------------------------------------------------------------

describe('assembleAndSign', () => {
  it('returns a Transaction (not a TransactionBuilder)', () => {
    const ownerKp = Keypair.random();
    const recoveryKp = Keypair.random();
    const auth = [makeAddressAuthEntry(recoveryKp.publicKey())];
    const tx = buildTxWithAuth(auth, ownerKp.publicKey());
    const sim = makeFakeSim();

    const result = assembleAndSign(tx, sim, ownerKp);

    // A Transaction has .sign(), .hash(), .toEnvelope(); a TransactionBuilder has .build()
    assert.equal(typeof result.sign, 'function', 'result must be a Transaction with .sign()');
    assert.equal(typeof result.build, 'undefined', 'result must not be a TransactionBuilder');
  });

  it('signs the envelope with the owner key (signatures array is non-empty)', () => {
    const ownerKp = Keypair.random();
    const auth = [makeSourceAccountAuthEntry()];
    const tx = buildTxWithAuth(auth, ownerKp.publicKey());
    const sim = makeFakeSim();

    const result = assembleAndSign(tx, sim, ownerKp);

    assert.ok(result.signatures.length > 0, 'envelope should have at least one signature');
  });

  it('signature verifies against the owner public key', () => {
    const ownerKp = Keypair.random();
    const auth = [makeSourceAccountAuthEntry()];
    const tx = buildTxWithAuth(auth, ownerKp.publicKey());
    const sim = makeFakeSim();

    const result = assembleAndSign(tx, sim, ownerKp);

    // Verify that the transaction hash is what was signed
    const txHash = result.hash();
    const sig = result.signatures[0];
    // sig is a DecoratedSignature; .signature() is the raw Buffer
    assert.ok(
      ownerKp.verify(txHash, sig.signature()),
      'signature must verify against the owner public key',
    );
  });

  it('preserves auth entries from the operation', () => {
    const ownerKp = Keypair.random();
    const recoveryKp = Keypair.random();
    const auth = [makeAddressAuthEntry(recoveryKp.publicKey())];
    const tx = buildTxWithAuth(auth, ownerKp.publicKey());
    const sim = makeFakeSim();

    const result = assembleAndSign(tx, sim, ownerKp);

    // The operation in the assembled transaction should still have the auth entry
    const op = result.operations[0];
    assert.ok(Array.isArray(op.auth), 'operation should have auth array');
    assert.equal(op.auth.length, 1, 'auth entry should be preserved');
  });
});

// ---------------------------------------------------------------------------
// Tests: pollForResult with injected RPC
// ---------------------------------------------------------------------------

describe('pollForResult', () => {
  /** Build a fake RPC that returns statuses in sequence. */
  function makeFakeRpc(statuses) {
    let i = 0;
    return {
      getTransaction: async (_hash) => {
        const s = statuses[i < statuses.length ? i++ : statuses.length - 1];
        if (s instanceof Error) throw s;
        return { status: s };
      },
    };
  }

  const FAST_OPTS = { pollIntervalMs: 0, pollDeadlineMs: 1_000, logFn: () => {} };

  it('resolves immediately on SUCCESS', async () => {
    const rpc = makeFakeRpc(['SUCCESS']);
    const result = await pollForResult(rpc, 'fakehash', undefined, undefined, FAST_OPTS);
    assert.equal(result.status, 'SUCCESS');
  });

  it('resolves after NOT_FOUND then SUCCESS', async () => {
    const rpc = makeFakeRpc(['NOT_FOUND', 'NOT_FOUND', 'SUCCESS']);
    const result = await pollForResult(rpc, 'fakehash', undefined, undefined, FAST_OPTS);
    assert.equal(result.status, 'SUCCESS');
  });

  it('resolves after PENDING then SUCCESS', async () => {
    const rpc = makeFakeRpc(['PENDING', 'SUCCESS']);
    const result = await pollForResult(rpc, 'fakehash', undefined, undefined, FAST_OPTS);
    assert.equal(result.status, 'SUCCESS');
  });

  it('throws on FAILED status', async () => {
    const rpc = makeFakeRpc(['FAILED']);
    await assert.rejects(
      () => pollForResult(rpc, 'fakehash', undefined, undefined, FAST_OPTS),
      /Transaction FAILED/,
    );
  });

  it('SDK parse error with raw fallback reporting SUCCESS', async () => {
    // The main SDK getTransaction throws a parse error; the raw fallback returns SUCCESS.
    const rpc = {
      getTransaction: async () => {
        throw new Error('Bad union switch: 4');
      },
    };
    const rawFallback = async (_hash) => ({ status: 'SUCCESS' });

    const result = await pollForResult(rpc, 'fakehash', rawFallback, undefined, FAST_OPTS);
    assert.equal(result.status, 'SUCCESS');
  });

  it('SDK parse error with raw fallback reporting FAILED throws', async () => {
    const rpc = {
      getTransaction: async () => {
        throw new Error('Bad union switch: 4');
      },
    };
    const rawFallback = async (_hash) => ({ status: 'FAILED' });

    await assert.rejects(
      () => pollForResult(rpc, 'fakehash', rawFallback, undefined, FAST_OPTS),
      /Transaction FAILED/,
    );
  });

  it('times out when both SDK and raw fallback keep failing, and error message contains last error', async () => {
    const rpc = {
      getTransaction: async () => {
        throw new Error('parse error from SDK');
      },
    };
    const rawFallback = async (_hash) => {
      throw new Error('raw fallback network error');
    };

    // Very short deadline so the test doesn't take long
    const opts = { pollIntervalMs: 0, pollDeadlineMs: 50, logFn: () => {} };

    await assert.rejects(
      () => pollForResult(rpc, 'fakehash', rawFallback, undefined, opts),
      (err) => {
        assert.match(err.message, /Timed out/);
        assert.match(err.message, /raw fallback network error/);
        return true;
      },
    );
  });

  it('times out when status stays NOT_FOUND until deadline, and error message mentions timeout', async () => {
    const rpc = makeFakeRpc(['NOT_FOUND']);
    const opts = { pollIntervalMs: 0, pollDeadlineMs: 50, logFn: () => {} };

    await assert.rejects(
      () => pollForResult(rpc, 'fakehash', undefined, undefined, opts),
      /Timed out/,
    );
  });
});
