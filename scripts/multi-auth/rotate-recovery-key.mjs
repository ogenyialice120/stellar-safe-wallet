/**
 * rotate-recovery-key.mjs
 *
 * Signs and submits a SafeWallet update_recovery_key transaction with real
 * dual-party Soroban authorization.
 *
 * Background: stellar-cli `stellar tx sign` signs the TRANSACTION ENVELOPE.
 * It does NOT sign Soroban authorization entries for addresses other than the
 * transaction source. update_recovery_key calls require_auth() on BOTH the
 * owner and the current recovery key. The owner's auth is covered because the
 * owner is the transaction source. The recovery key's auth entry must be signed
 * separately using authorizeEntry() from @stellar/stellar-sdk, which signs the
 * auth entry's HashIdPreimage (not the envelope). That is what this script does.
 *
 * Function being called on-chain:
 *   update_recovery_key(env: Env, new_key: Address) -> Result<(), WalletError>
 *   Auth required:
 *     1. owner  — via require_owner() -> owner.require_auth()  [root/source auth]
 *     2. current recovery key — via current_recovery.require_auth()  [non-root auth entry]
 *
 * Inputs (all required):
 *   Environment variables (secrets — never passed as CLI arguments):
 *     OWNER_SECRET      Secret key (S…) of the wallet owner
 *     RECOVERY_SECRET   Secret key (S…) of the CURRENT recovery key
 *   Command-line arguments (or environment variables):
 *     --contract CONTRACT_ID       The SafeWallet contract address (C…)
 *     --new-recovery NEW_ADDR      The new recovery key address (G…)
 *     --rpc-url RPC_URL            Soroban RPC endpoint
 *     --passphrase PASSPHRASE      Network passphrase
 *
 * Output:
 *   On success: exactly one line on stdout: TXHASH=<64-hex-chars>
 *   All other output goes to stderr.
 *   Exit code: 0 on success, 1 on any failure.
 */

import {
  Keypair,
  TransactionBuilder,
  Networks,
  Operation,
  Address,
  nativeToScVal,
  xdr,
  authorizeEntry,
} from '@stellar/stellar-sdk';
import rpcPkg from '@stellar/stellar-sdk/rpc';

const { Server, assembleTransaction } = rpcPkg;

// ---------------------------------------------------------------------------
// Argument / environment parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const val = args[i + 1];
      if (val === undefined || val.startsWith('--')) {
        fatal(`Missing value for --${key}`);
      }
      opts[key] = val;
      i++;
    }
  }
  return opts;
}

function fatal(msg) {
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(1);
}

function log(msg) {
  process.stderr.write(`${msg}\n`);
}

// ---------------------------------------------------------------------------
// Secret handling
// ---------------------------------------------------------------------------

function loadSecrets() {
  const ownerSecret = process.env['OWNER_SECRET'];
  const recoverySecret = process.env['RECOVERY_SECRET'];

  if (!ownerSecret) {
    fatal('OWNER_SECRET environment variable is not set. Refusing to run without it.');
  }
  if (!recoverySecret) {
    fatal('RECOVERY_SECRET environment variable is not set. Refusing to run without it.');
  }

  let ownerKp, recoveryKp;
  try {
    ownerKp = Keypair.fromSecret(ownerSecret);
  } catch {
    fatal('OWNER_SECRET is not a valid Stellar secret key.');
  }
  try {
    recoveryKp = Keypair.fromSecret(recoverySecret);
  } catch {
    fatal('RECOVERY_SECRET is not a valid Stellar secret key.');
  }

  return { ownerKp, recoveryKp };
}

// ---------------------------------------------------------------------------
// Transaction polling — with fallback for SDK parse errors on new XDR
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 3000;
const POLL_DEADLINE_MS = 60_000;

async function pollForResult(server, txHash) {
  const deadline = Date.now() + POLL_DEADLINE_MS;
  while (Date.now() < deadline) {
    let status = null;
    let raw = null;

    try {
      const result = await server.getTransaction(txHash);
      status = result.status;
      raw = result;
    } catch (sdkErr) {
      // The SDK can throw on newer protocol metadata it cannot parse
      // (e.g. "Bad union switch: 4"). Fall back to a raw JSON-RPC call
      // to read the status field only.
      const errText = sdkErr && sdkErr.message ? sdkErr.message : String(sdkErr);
      log(`SDK parse error (non-fatal, reading raw status): ${errText}`);

      try {
        raw = await rawGetTransactionStatus(server, txHash);
        status = raw.status;
      } catch (rawErr) {
        const rawText = rawErr && rawErr.message ? rawErr.message : String(rawErr);
        log(`Raw RPC fallback also failed: ${rawText}`);
        // Keep waiting — transient network issue
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
    }

    if (status === 'PENDING' || status === 'NOT_FOUND') {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (status === 'SUCCESS') {
      return { status, raw };
    }

    if (status === 'FAILED') {
      const detail = raw && raw.resultXdr ? ` resultXdr=${raw.resultXdr}` : '';
      fatal(`Transaction FAILED.${detail}`);
    }

    // Unknown status — log and keep waiting until deadline
    log(`Unexpected transaction status: ${String(status)} — waiting`);
    await sleep(POLL_INTERVAL_MS);
  }

  fatal(`Timed out waiting for transaction ${txHash} after ${POLL_DEADLINE_MS / 1000}s`);
}

async function rawGetTransactionStatus(server, txHash) {
  // Access the underlying HTTP client via the server's RPC URL.
  // The Server stores its rpcUrl — reach it through the internal _serverUrl.
  const rpcUrl = server._serverUrl
    ? server._serverUrl.href
    : server.serverURL
      ? server.serverURL.href
      : null;

  if (!rpcUrl) {
    throw new Error('Cannot determine RPC URL from server instance for raw fallback');
  }

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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // ── 1. Parse inputs ──────────────────────────────────────────────────────
  const opts = parseArgs();

  const contractId = opts['contract'] || process.env['CONTRACT_ID'];
  const newRecoveryAddr = opts['new-recovery'] || process.env['NEW_RECOVERY_ADDR'];
  const rpcUrl = opts['rpc-url'] || process.env['RPC_URL'] || 'https://soroban-testnet.stellar.org';
  const passphrase =
    opts['passphrase'] || process.env['PASSPHRASE'] || Networks.TESTNET;

  if (!contractId) fatal('--contract (or CONTRACT_ID env var) is required');
  if (!newRecoveryAddr) fatal('--new-recovery (or NEW_RECOVERY_ADDR env var) is required');

  const { ownerKp, recoveryKp } = loadSecrets();

  log(`Contract:     ${contractId}`);
  log(`New recovery: ${newRecoveryAddr}`);
  log(`RPC URL:      ${rpcUrl}`);
  log(`Owner:        ${ownerKp.publicKey()}`);
  log(`Current recovery: ${recoveryKp.publicKey()}`);

  // ── 2. Set up RPC server ─────────────────────────────────────────────────
  const server = new Server(rpcUrl, { allowHttp: false });

  // ── 3. Load owner account and latest ledger ──────────────────────────────
  log('Loading owner account from RPC...');
  const ownerAccount = await server.getAccount(ownerKp.publicKey());

  log('Getting latest ledger...');
  const ledgerInfo = await server.getLatestLedger();
  const latestLedger = ledgerInfo.sequence;
  const validUntilLedger = latestLedger + 60;
  log(`Latest ledger: ${latestLedger}, auth valid until: ${validUntilLedger}`);

  // ── 4. Build the transaction ─────────────────────────────────────────────
  // update_recovery_key(env: Env, new_key: Address) -> Result<(), WalletError>
  // The function takes exactly one argument: new_key (an Address).
  const newKeyScVal = new Address(newRecoveryAddr).toScVal();

  const contract = new Address(contractId);

  const invokeOp = Operation.invokeContractFunction({
    contract: contractId,
    function: 'update_recovery_key',
    args: [newKeyScVal],
  });

  const tx = new TransactionBuilder(ownerAccount, {
    fee: '1000000', // 0.1 XLM max fee; actual fee is set after simulation
    networkPassphrase: passphrase,
  })
    .addOperation(invokeOp)
    .setTimeout(300)
    .build();

  // ── 5. First simulation (recording mode) ─────────────────────────────────
  log('Simulating transaction (recording auth entries)...');
  const sim = await server.simulateTransaction(tx);

  if (sim.error) {
    fatal(`Simulation failed: ${sim.error}`);
  }

  if (!sim.result) {
    fatal('Simulation returned no result');
  }

  // Check for auth entries in the simulation result
  const authEntries = sim.result.auth || [];
  log(`Simulation returned ${authEntries.length} auth entry/entries`);

  if (authEntries.length === 0) {
    fatal('No auth entries returned from simulation — expected at least one for the recovery key');
  }

  // ── 6. Sign the recovery key's auth entry ────────────────────────────────
  // The owner's auth is covered by the transaction source (root auth).
  // We must sign entries whose credential address matches the current recovery key.
  const signedEntries = await Promise.all(
    authEntries.map(async (entry) => {
      // Skip source-account credentials (the owner's root auth is automatic)
      const credType = entry.credentials().switch().value;
      const sourceAccountCredType =
        xdr.SorobanCredentialsType.sorobanCredentialsSourceAccount().value;

      if (credType === sourceAccountCredType) {
        log('  Auth entry: source-account credential (owner root auth — no extra signing needed)');
        return entry;
      }

      // For address credentials, check if this entry is for the recovery key
      const entryAddr = Address.fromScAddress(
        entry.credentials().address().address(),
      ).toString();

      log(`  Auth entry: address credential for ${entryAddr}`);

      if (entryAddr === recoveryKp.publicKey()) {
        log('  → Signing this entry with the recovery key');
        return authorizeEntry(entry, recoveryKp, validUntilLedger, passphrase);
      }

      if (entryAddr === ownerKp.publicKey()) {
        // Owner's non-root auth entry — sign with owner key
        log('  → Signing this entry with the owner key');
        return authorizeEntry(entry, ownerKp, validUntilLedger, passphrase);
      }

      fatal(
        `Unexpected auth entry for address ${entryAddr} — ` +
          `expected owner (${ownerKp.publicKey()}) or recovery (${recoveryKp.publicKey()})`,
      );
    }),
  );

  // ── 7. Assemble with signed auth entries ─────────────────────────────────
  // assembleTransaction merges simulation resource data and sets the fee.
  // We pass the signed auth entries via the transaction operation.
  log('Assembling transaction with signed auth entries...');

  // Clone the transaction and attach signed auth entries to its operation
  const txWithAuth = new TransactionBuilder(
    await server.getAccount(ownerKp.publicKey()),
    {
      fee: '1000000',
      networkPassphrase: passphrase,
    },
  )
    .addOperation(
      Operation.invokeContractFunction({
        contract: contractId,
        function: 'update_recovery_key',
        args: [newKeyScVal],
        auth: signedEntries,
      }),
    )
    .setTimeout(300)
    .build();

  // Let assembleTransaction set resources and fee from the simulation result
  const assembled = assembleTransaction(txWithAuth, sim);

  // ── 8. Sign the transaction envelope with the owner key ──────────────────
  assembled.sign(ownerKp);
  log('Transaction envelope signed by owner');

  // ── 9. Submit ─────────────────────────────────────────────────────────────
  log('Sending transaction...');
  let sendResult;
  try {
    sendResult = await server.sendTransaction(assembled);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    fatal(`sendTransaction failed: ${msg}`);
  }

  if (sendResult.status === 'ERROR') {
    fatal(
      `Transaction rejected immediately: ${sendResult.errorResult ? sendResult.errorResult.toXDR('base64') : 'unknown error'}`,
    );
  }

  const txHash = sendResult.hash;
  log(`Submitted. Hash: ${txHash}. Status: ${sendResult.status}`);

  // ── 10. Poll for final result ─────────────────────────────────────────────
  log('Polling for transaction result...');
  await pollForResult(server, txHash);

  // ── 11. Emit the machine-readable success line to stdout ──────────────────
  process.stdout.write(`TXHASH=${txHash}\n`);
}

main().catch((err) => {
  const msg = err && err.message ? err.message : String(err);
  process.stderr.write(`FATAL: ${msg}\n`);
  process.exit(1);
});
