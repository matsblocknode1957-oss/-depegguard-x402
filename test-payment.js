'use strict';

require('dotenv').config();

const { x402Client, wrapFetchWithPayment, decodePaymentResponseHeader } = require('@x402/fetch');
const { registerExactEvmScheme } = require('@x402/evm/exact/client');
const { privateKeyToAccount } = require('viem/accounts');

const TARGET = 'https://depegguard-x402-production.up.railway.app/api/signal';

async function main() {
  const rawKey = process.env.PRIVATE_KEY;
  if (!rawKey) {
    console.error('ERROR: PRIVATE_KEY is not set in .env');
    process.exit(1);
  }

  const privateKey = rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`;
  const signer = privateKeyToAccount(privateKey);
  console.log(`Paying from : ${signer.address}`);
  console.log(`Target      : ${TARGET}\n`);

  const client = new x402Client();

  client.onBeforePaymentCreation(() => console.log('→ Signing EIP-3009 payment...'));
  client.onAfterPaymentCreation(() => console.log('✓ Payment signed\n'));
  client.onPaymentCreationFailure((err) => console.error('✗ Signing failed:', err));

  registerExactEvmScheme(client, { signer, networks: ['eip155:8453'] });

  const payFetch = wrapFetchWithPayment(fetch, client);

  const res = await payFetch(TARGET);

  console.log(`HTTP ${res.status}`);

  const paymentResponseHeader = res.headers.get('payment-response');
  if (paymentResponseHeader) {
    const settlement = decodePaymentResponseHeader(paymentResponseHeader);
    console.log('Settlement  :', JSON.stringify(settlement, null, 2));
  }

  if (!res.ok) {
    const text = await res.text();
    console.error('\nResponse body:', text);
    process.exit(1);
  }

  const data = await res.json();

  console.log('\n=== Depeg Signals ===');
  console.log(`Fetched at  : ${data.fetchedAt}`);
  console.log(`EXIT        : ${data.summary.EXIT.length  ? data.summary.EXIT.join(', ')  : 'none'}`);
  console.log(`HEDGE       : ${data.summary.HEDGE.length ? data.summary.HEDGE.join(', ') : 'none'}`);
  console.log(`STABLE      : ${data.summary.STABLE.join(', ')}`);

  console.log('\n=== Per-coin detail ===');
  for (const [symbol, s] of Object.entries(data.signals)) {
    const dev = s.pegDeviation != null ? `${Number(s.pegDeviation).toFixed(3)}%` : 'n/a';
    const price = s.price != null ? String(s.price) : 'n/a';
    console.log(`  ${symbol.padEnd(5)} ${s.signal.padEnd(6)}  price=${price.padEnd(8)}  dev=${dev}`);
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message ?? err);
  process.exit(1);
});
