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
  TransactionBuilder,
  Networks,
  Operation,
  Address,
} from '@stellar/stellar-sdk';
import rpcPkg from '@stellar/stellar-sdk/rpc';

const { Server } = rpcPkg;

import {
  validateSecrets,
  classifyEntries,
  signAuthEntries,
  assembleAndSign,
  pollForResult,
  makeRawFallback,
} from './lib.mjs';

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
// Main
// ---------------------------------------------------------------------------

async function main() {
  // ── 1. Parse inputs ──────────────────────────────────────────────────────
  const opts = parseArgs();

  const contractId = opts['contract'] || process.env['CONTRACT_ID'];
  const newRecoveryAddr = opts['new-recovery'] || process.env['NEW_RECOVERY_ADDR'];
  const rpcUrl =
    opts['rpc-url'] || process.env['RPC_URL'] || 'https://soroban-testnet.stellar.org';
  const passphrase =
    opts['passphrase'] || process.env['PASSPHRASE'] || Networks.TESTNET;

  if (!contractId) fatal('--contract (or CONTRACT_ID env var) is required');
  if (!newRecoveryAddr) fatal('--new-recovery (or NEW_RECOVERY_ADDR env var) is required');

  let ownerKp, recoveryKp;
  try {
    ({ ownerKp, recoveryKp } = validateSecrets(process.env));
  } catch (err) {
    fatal(err.message);
  }

  log(`Contract:         ${contractId}`);
  log(`New recovery:     ${newRecoveryAddr}`);
  log(`RPC URL:          ${rpcUrl}`);
  log(`Owner:            ${ownerKp.publicKey()}`);
  log(`Current recovery: ${recoveryKp.publicKey()}`);

  // ── 2. Set up RPC server ─────────────────────────────────────────────────
  const server = new Server(rpcUrl, { allowHttp: false });

  // ── 3. Load owner account and latest ledger ──────────────────────────────
  log('Loading owner account from RPC...');
  const ownerAccount = await server.getAccount(ownerKp.publicKey());

  const ledgerInfo = await server.getLatestLedger();
  const latestLedger = ledgerInfo.sequence;
  const validUntilLedger = latestLedger + 60;
  log(`Latest ledger: ${latestLedger}, auth valid until: ${validUntilLedger}`);

  // ── 4. Build the unsigned transaction ────────────────────────────────────
  const newKeyScVal = new Address(newRecoveryAddr).toScVal();

  const tx = new TransactionBuilder(ownerAccount, {
    fee: '1000000', // 0.1 XLM max fee; actual fee is set after re-simulation
    networkPassphrase: passphrase,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: contractId,
        function: 'update_recovery_key',
        args: [newKeyScVal],
      }),
    )
    .setTimeout(300)
    .build();

  // ── 5. First simulation (recording mode) ─────────────────────────────────
  log('Simulating transaction (recording auth entries)...');
  const sim1 = await server.simulateTransaction(tx);

  if (sim1.error) {
    fatal(`Simulation failed: ${sim1.error}`);
  }
  if (!sim1.result) {
    fatal('Simulation returned no result object');
  }

  const authEntries = sim1.result.auth ?? [];
  log(`Simulation returned ${authEntries.length} auth entry/entries`);

  if (authEntries.length === 0) {
    fatal(
      'No auth entries returned from simulation — expected at least one for the recovery key',
    );
  }

  // ── 6. Classify and sign auth entries ────────────────────────────────────
  const classifications = classifyEntries(
    authEntries,
    ownerKp.publicKey(),
    recoveryKp.publicKey(),
  );

  for (let i = 0; i < authEntries.length; i++) {
    const kind = classifications[i];
    if (kind === 'source') {
      log('  Auth entry: source-account credential (owner root auth — no extra signing needed)');
    } else if (kind === 'recovery') {
      log(`  Auth entry: address credential for ${recoveryKp.publicKey()}`);
      log('  → Signing this entry with the recovery key');
    } else if (kind === 'owner') {
      log(`  Auth entry: address credential for ${ownerKp.publicKey()} (non-root)`);
      log('  → Signing this entry with the owner key');
    } else {
      const addr = Address.fromScAddress(
        authEntries[i].credentials().address().address(),
      ).toString();
      fatal(
        `Unexpected auth entry for address ${addr} — ` +
          `expected owner (${ownerKp.publicKey()}) or recovery (${recoveryKp.publicKey()})`,
      );
    }
  }

  const signedEntries = await signAuthEntries(
    authEntries,
    classifications,
    ownerKp,
    recoveryKp,
    validUntilLedger,
    passphrase,
  );

  // ── 7. Rebuild transaction with signed auth entries ───────────────────────
  // Re-fetch the account to get a fresh sequence number for the second build.
  const ownerAccount2 = await server.getAccount(ownerKp.publicKey());

  const txWithAuth = new TransactionBuilder(ownerAccount2, {
    fee: '1000000',
    networkPassphrase: passphrase,
  })
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

  // ── 8. Second simulation (enforcing mode) ────────────────────────────────
  // The signed auth entries are attached to the operation. assembleTransaction
  // preserves existing auth entries and fills in the correct footprint and fee.
  // Running a second simulation with the signed entries yields the real fee
  // and footprint for the final transaction.
  log('Re-simulating with signed auth entries (enforcing)...');
  const sim2 = await server.simulateTransaction(txWithAuth);

  if (sim2.error) {
    fatal(`Re-simulation failed: ${sim2.error}`);
  }

  // ── 9. Assemble, build, and sign the envelope ────────────────────────────
  // assembleTransaction() returns TransactionBuilder — must call .build()
  // before calling .sign() (which is on Transaction, not TransactionBuilder).
  log('Assembling transaction with signed auth entries...');
  let assembled;
  try {
    assembled = assembleAndSign(txWithAuth, sim2, ownerKp);
  } catch (err) {
    fatal(`Assembly failed: ${err.message}`);
  }
  log('Transaction envelope signed by owner');

  // ── 10. Submit ────────────────────────────────────────────────────────────
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
      `Transaction rejected immediately: ${
        sendResult.errorResult ? sendResult.errorResult.toXDR('base64') : 'unknown error'
      }`,
    );
  }

  const txHash = sendResult.hash;
  log(`Submitted. Hash: ${txHash}. Status: ${sendResult.status}`);

  // ── 11. Poll for final result ─────────────────────────────────────────────
  log('Polling for transaction result...');
  // server.serverURL is a public URI object (not a private field).
  // .toString() gives the full URL string needed for the raw fallback.
  const rawFallback = makeRawFallback(server.serverURL.toString());

  try {
    await pollForResult(server, txHash, rawFallback, undefined, { logFn: log });
  } catch (err) {
    fatal(err.message);
  }

  // ── 12. Emit the machine-readable success line to stdout ──────────────────
  process.stdout.write(`TXHASH=${txHash}\n`);
}

main().catch((err) => {
  const msg = err && err.message ? err.message : String(err);
  process.stderr.write(`FATAL: ${msg}\n`);
  process.exit(1);
});
