'use strict';

require('dotenv').config();

const { wrapFetchWithPayment, x402Client } = require('@x402/fetch');
const { ExactEvmScheme, toClientEvmSigner } = require('@x402/evm');

const TARGET = 'https://depegguard-x402-production.up.railway.app/api/signal';

function decodeHeader(value) {
  return JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
}

async function main() {
  if (!process.env.PRIVATE_KEY) {
    console.error('PRIVATE_KEY not set in .env');
    process.exit(1);
  }

  // ── Step 1: raw 402 — inspect the challenge ────────────────────────────────
  console.log(`Calling ${TARGET} ...\n`);

  const raw = await fetch(TARGET);
  if (raw.status !== 402) {
    console.error(`Expected 402, got ${raw.status}`);
    process.exit(1);
  }

  const challenge = decodeHeader(raw.headers.get('payment-required'));
  const exactEntry = challenge.accepts.find((a) => a.scheme === 'exact');
  if (!exactEntry) {
    console.error('No exact scheme entry in 402 challenge');
    process.exit(1);
  }

  console.log('[402] exact scheme challenge:');
  console.log(`  amount   : ${exactEntry.amount} (${parseInt(exactEntry.amount, 10) / 1e6} USDC)`);
  console.log(`  payTo    : ${exactEntry.payTo}`);
  console.log(`  network  : ${exactEntry.network}`);
  console.log(`  resource : ${challenge.resource?.url ?? TARGET}`);
  console.log();

  // ── Step 2: build the paying client ───────────────────────────────────────
  const { privateKeyToAccount } = await import('viem/accounts');
  const pk = process.env.PRIVATE_KEY.startsWith('0x')
    ? process.env.PRIVATE_KEY
    : `0x${process.env.PRIVATE_KEY}`;
  const account = privateKeyToAccount(pk);
  console.log(`[wallet] buyer address: ${account.address}`);

  const signer    = toClientEvmSigner(account);
  const evmScheme = new ExactEvmScheme(signer);
  const client    = x402Client.fromConfig({
    schemes: [{ network: 'eip155:8453', client: evmScheme, x402Version: 2 }],
  });
  const paidFetch = wrapFetchWithPayment(fetch, client);

  // ── Step 3: paid request ──────────────────────────────────────────────────
  console.log('\n[paying] signing EIP-3009 transferWithAuthorization and submitting to CDP facilitator ...\n');

  const res = await paidFetch(TARGET);

  if (!res.ok) {
    console.error(`Request failed: ${res.status}`);
    console.error(await res.text());
    process.exit(1);
  }

  // ── Step 4: decode receipt ────────────────────────────────────────────────
  const paymentResponseHeader = res.headers.get('payment-response');
  let txHash = null;
  if (paymentResponseHeader) {
    try {
      const receipt = decodeHeader(paymentResponseHeader);
      txHash = receipt.txHash ?? receipt.transaction ?? null;
      console.log('[receipt]', JSON.stringify(receipt, null, 2));
    } catch {
      console.log('[payment-response raw]', paymentResponseHeader);
    }
  }

  const data = await res.json();

  console.log('\n─── Signal data ─────────────────────────────────────────────');
  console.log(JSON.stringify(data, null, 2));

  if (txHash) {
    console.log('\n─── Transaction ─────────────────────────────────────────────');
    console.log(`https://basescan.org/tx/${txHash}`);
  }
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
