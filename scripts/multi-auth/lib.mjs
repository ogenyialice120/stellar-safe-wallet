/**
 * lib.mjs — Pure logic shared between rotate-recovery-key.mjs and the tests.
 *
 * All functions are side-effect-free with respect to network and process:
 * no process.exit, no fetch calls (except rawGetTransactionStatus which is
 * called only via pollForResult), no server calls. The pollForResult function
 * accepts an injected RPC object so callers can substitute a fake for testing.
 */

import { Address, Keypair, xdr, authorizeEntry } from '@stellar/stellar-sdk';
import rpcPkg from '@stellar/stellar-sdk/rpc';

const { assembleTransaction } = rpcPkg;

// ---------------------------------------------------------------------------
// Secret validation
// ---------------------------------------------------------------------------

/**
 * Validates secrets from an env-variable map and returns keypairs.
 *
 * @param {Record<string, string|undefined>} env  typically process.env
 * @returns {{ ownerKp: Keypair, recoveryKp: Keypair }}
 * @throws {Error} with a descriptive message on any validation failure
 */
export function validateSecrets(env) {
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
// Auth-entry classification
// ---------------------------------------------------------------------------

/**
 * Classifies a list of SorobanAuthorizationEntry objects by credential type
 * and address.
 *
 * @param {xdr.SorobanAuthorizationEntry[]} entries
 * @param {string} ownerPublicKey   strkey G... form
 * @param {string} recoveryPublicKey   strkey G... form
 * @returns {Array<'source'|'owner'|'recovery'|'unknown'>}
 */
export function classifyEntries(entries, ownerPublicKey, recoveryPublicKey) {
  const sourceAccountCredType =
    xdr.SorobanCredentialsType.sorobanCredentialsSourceAccount().value;

  return entries.map((entry) => {
    const credType = entry.credentials().switch().value;
    if (credType === sourceAccountCredType) {
      return 'source';
    }
    const addr = Address.fromScAddress(
      entry.credentials().address().address(),
    ).toString();
    if (addr === ownerPublicKey) return 'owner';
    if (addr === recoveryPublicKey) return 'recovery';
    return 'unknown';
  });
}

// ---------------------------------------------------------------------------
// Auth-entry signing
// ---------------------------------------------------------------------------

/**
 * Signs auth entries according to their classifications.
 *
 * - 'source' entries are returned unchanged (owner root auth is automatic).
 * - 'recovery' entries are signed with the recovery keypair.
 * - 'owner' entries are signed with the owner keypair (non-root owner auth).
 * - 'unknown' throws, because an unexpected signer is a fatal configuration error.
 *
 * @param {xdr.SorobanAuthorizationEntry[]} authEntries
 * @param {Array<'source'|'owner'|'recovery'|'unknown'>} classifications
 * @param {Keypair} ownerKp
 * @param {Keypair} recoveryKp
 * @param {number} validUntilLedger
 * @param {string} networkPassphrase
 * @returns {Promise<xdr.SorobanAuthorizationEntry[]>}
 */
export async function signAuthEntries(
  authEntries,
  classifications,
  ownerKp,
  recoveryKp,
  validUntilLedger,
  networkPassphrase,
) {
  return Promise.all(
    authEntries.map(async (entry, i) => {
      const kind = classifications[i];
      if (kind === 'source') return entry;
      if (kind === 'recovery') {
        return authorizeEntry(entry, recoveryKp, validUntilLedger, networkPassphrase);
      }
      if (kind === 'owner') {
        return authorizeEntry(entry, ownerKp, validUntilLedger, networkPassphrase);
      }
      throw new Error(
        `Unexpected auth entry classification '${kind}' at index ${i} — ` +
          `expected owner, recovery, or source`,
      );
    }),
  );
}

// ---------------------------------------------------------------------------
// Transaction assembly and envelope signing
// ---------------------------------------------------------------------------

/**
 * Assembles a transaction with simulation resource data, then signs the
 * envelope with the owner key.
 *
 * assembleTransaction() — declared in @stellar/stellar-sdk/rpc —
 * signature: assembleTransaction(raw: Transaction, simulation: SimulateTransactionResponse): TransactionBuilder
 *
 * TransactionBuilder.build() — declared in @stellar/stellar-base —
 * signature: build(): Transaction
 *
 * Transaction.sign() — declared in @stellar/stellar-base —
 * signature: sign(...keypairs: Keypair[]): void
 *
 * Therefore: assembleTransaction(...).build().sign(ownerKp)
 *
 * @param {import('@stellar/stellar-base').Transaction} tx
 *   Transaction whose operation already has signed auth entries
 * @param {import('@stellar/stellar-sdk/rpc').Api.SimulateTransactionResponse} sim
 *   Simulation response (preferably a second, enforcing simulation run against
 *   the already-signed-entry transaction, to get correct footprint and fee)
 * @param {Keypair} ownerKp
 * @returns {import('@stellar/stellar-base').Transaction}  signed, ready to send
 */
export function assembleAndSign(tx, sim, ownerKp) {
  const builder = assembleTransaction(tx, sim);
  const builtTx = builder.build();
  builtTx.sign(ownerKp);
  return builtTx;
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

export const DEFAULT_POLL_INTERVAL_MS = 3_000;
export const DEFAULT_POLL_DEADLINE_MS = 60_000;

/**
 * Polls an RPC object for a transaction's final status.
 *
 * The rpc object must implement:
 *   getTransaction(hash: string): Promise<{ status: string, resultXdr?: any }>
 *
 * On a parse error thrown by getTransaction, the function tries rawGetStatus
 * (if provided) or the built-in rawGetTransactionStatus using rpcUrl. If both
 * fail, the error is logged and the loop waits before retrying. An unknown
 * status is logged and kept waiting until the deadline. The timeout error
 * message includes the last error text seen (no secrets).
 *
 * This function never calls process.exit — it throws on failure.
 *
 * @param {{ getTransaction: (hash: string) => Promise<{ status: string, resultXdr?: any }> }} rpc
 * @param {string} txHash
 * @param {((hash: string) => Promise<{ status: string }>) | undefined} rawGetStatus
 *   Optional raw fallback; if undefined, the built-in fetch-based fallback is
 *   used when rpcUrl is provided.
 * @param {string | undefined} rpcUrl
 *   RPC URL string for the built-in raw fallback (not used when rawGetStatus is provided)
 * @param {{
 *   pollIntervalMs?: number,
 *   pollDeadlineMs?: number,
 *   logFn?: (msg: string) => void,
 * }} [opts]
 * @returns {Promise<{ status: string, raw: object }>}
 * @throws {Error} on FAILED status, deadline exceeded, or unrecoverable error
 */
export async function pollForResult(rpc, txHash, rawGetStatus, rpcUrl, opts = {}) {
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const pollDeadlineMs = opts.pollDeadlineMs ?? DEFAULT_POLL_DEADLINE_MS;
  const logFn = opts.logFn ?? (() => {});

  const deadline = Date.now() + pollDeadlineMs;
  let lastErrText = '';

  const fallback = rawGetStatus ?? (rpcUrl ? makeRawFallback(rpcUrl) : undefined);

  while (Date.now() < deadline) {
    let status = null;
    let raw = null;

    try {
      raw = await rpc.getTransaction(txHash);
      status = raw.status;
    } catch (sdkErr) {
      const errText = sdkErr && sdkErr.message ? sdkErr.message : String(sdkErr);
      lastErrText = errText;
      logFn(`SDK parse error (non-fatal, reading raw status): ${errText}`);

      if (!fallback) {
        // No fallback available — treat as transient and keep waiting
        logFn('No raw fallback available; will retry');
        await sleep(pollIntervalMs);
        continue;
      }

      try {
        raw = await fallback(txHash);
        status = raw.status;
      } catch (rawErr) {
        const rawText = rawErr && rawErr.message ? rawErr.message : String(rawErr);
        lastErrText = rawText;
        logFn(`Raw RPC fallback also failed: ${rawText}`);
        await sleep(pollIntervalMs);
        continue;
      }
    }

    if (status === 'PENDING' || status === 'NOT_FOUND') {
      await sleep(pollIntervalMs);
      continue;
    }

    if (status === 'SUCCESS') {
      return { status, raw };
    }

    if (status === 'FAILED') {
      const detail = raw && raw.resultXdr ? ` resultXdr=${raw.resultXdr}` : '';
      throw new Error(`Transaction FAILED.${detail}`);
    }

    // Unknown status — log and keep waiting until deadline
    logFn(`Unexpected transaction status: ${String(status)} — waiting`);
    await sleep(pollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for transaction ${txHash} after ${pollDeadlineMs / 1000}s` +
      (lastErrText ? `; last error: ${lastErrText}` : ''),
  );
}

/**
 * Returns a raw fallback function that calls getTransaction via fetch,
 * reading only the status field. The function never reads secrets.
 *
 * @param {string} rpcUrl
 * @returns {(hash: string) => Promise<{ status: string }>}
 */
export function makeRawFallback(rpcUrl) {
  return (txHash) => rawGetTransactionStatus(rpcUrl, txHash);
}

/**
 * Fetches transaction status directly via a JSON-RPC POST, bypassing SDK
 * parsing. Only the status field is read from the result.
 *
 * @param {string} rpcUrl
 * @param {string} txHash
 * @returns {Promise<{ status: string }>}
 */
export async function rawGetTransactionStatus(rpcUrl, txHash) {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getTransaction',
    params: { hash: txHash },
  });

  const resp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} from RPC`);
  }

  const json = await resp.json();
  if (json.error) {
    throw new Error(`RPC error: ${json.error.message || JSON.stringify(json.error)}`);
  }

  return json.result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
