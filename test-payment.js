'use strict';

require('dotenv').config();

const { x402Client } = require('@x402/fetch');
const { privateKeyToAccount } = require('viem/accounts');

const TARGET = 'https://depegguard-x402-production.up.railway.app/api/signal';

async function main() {
  const rawKey = process.env.PRIVATE_KEY;
  if (!rawKey) {
    console.error('ERROR: PRIVATE_KEY env var is not set.');
    console.error('Add it to .env as PRIVATE_KEY=0x<your-private-key>');
    process.exit(1);
  }

  const privateKey = rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`;
  const signer = privateKeyToAccount(privateKey);
  console.log(`Paying from: ${signer.address}`);

  const client = x402Client()
    .registerExactEvmScheme('eip155:8453', { signer })
    .on('beforePaymentCreation', () => console.log('→ Signing payment...'))
    .on('afterPaymentCreation',  () => console.log('✓ Payment signed'))
    .on('paymentCreationFailure', (err) => console.error('✗ Payment signing failed:', err));

  console.log(`\nGET ${TARGET}`);

  const res = await client.fetch(TARGET);

  console.log(`\nHTTP ${res.status}`);

  const paymentResponse = res.headers.get('payment-response');
  if (paymentResponse) {
    const settlement = JSON.parse(Buffer.from(paymentResponse, 'base64').toString('utf8'));
    console.log('Settlement:', JSON.stringify(settlement, null, 2));
  }

  if (!res.ok) {
    const text = await res.text();
    console.error('Response body:', text);
    process.exit(1);
  }

  const data = await res.json();
  console.log('\n=== Depeg Signals ===');
  console.log(`Fetched at: ${data.fetchedAt}`);
  console.log(`EXIT  : ${data.summary.EXIT.length  ? data.summary.EXIT.join(', ')  : 'none'}`);
  console.log(`HEDGE : ${data.summary.HEDGE.length ? data.summary.HEDGE.join(', ') : 'none'}`);
  console.log(`STABLE: ${data.summary.STABLE.join(', ')}`);

  console.log('\n=== Per-coin detail ===');
  for (const [symbol, s] of Object.entries(data.signals)) {
    const dev = s.pegDeviation != null ? `${s.pegDeviation.toFixed(3)}%` : 'n/a';
    console.log(`  ${symbol.padEnd(5)} ${s.signal.padEnd(6)}  price=${s.price ?? 'n/a'}  dev=${dev}`);
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message ?? err);
  process.exit(1);
});
