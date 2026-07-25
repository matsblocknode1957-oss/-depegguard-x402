'use strict';

require('dotenv').config();

const { PipRailClient } = require('@piprail/sdk');

const ENDPOINT = 'https://depegguard-x402-production.up.railway.app/api/signal';

async function main() {
  if (!process.env.PRIVATE_KEY) {
    console.error('PRIVATE_KEY not set in .env');
    process.exit(1);
  }
  if (!process.env.BASE_RPC_URL) {
    console.error('BASE_RPC_URL not set in .env');
    process.exit(1);
  }

  let txHash = null;

  const client = new PipRailClient({
    chain:  'base',
    wallet: { privateKey: process.env.PRIVATE_KEY },
    rpcUrl: process.env.BASE_RPC_URL,
    // default schemes: ['onchain-proof'] — picks the piprail entry, ignores exact
    onEvent(event) {
      switch (event.kind) {
        case 'payment-required':
          console.log(`[402] scheme=${event.accept.scheme}  amount=${event.accept.amount}  network=${event.accept.network}`);
          break;
        case 'payment-broadcast':
          txHash = event.ref;
          console.log(`[broadcast] ${txHash}`);
          console.log(`[basescan]  https://basescan.org/tx/${txHash}`);
          break;
        case 'payment-confirmed':
          console.log(`[confirmed] block ${event.blockNumber}`);
          break;
        case 'payment-unconfirmed':
          console.log(`[unconfirmed] submitting proof anyway — ${event.reason}`);
          break;
        case 'payment-settled':
          if (event.receipt?.transaction) txHash = txHash ?? event.receipt.transaction;
          console.log(`[settled]`);
          break;
        case 'payment-failed':
          console.error(`[failed] ${event.reason}`);
          break;
      }
    },
  });

  console.log(`Calling ${ENDPOINT} ...\n`);

  const res = await client.fetch(ENDPOINT);

  if (!res.ok) {
    console.error(`\nRequest failed: ${res.status}`);
    console.error(await res.text());
    process.exit(1);
  }

  const data = await res.json();

  console.log('\n─── Signal data ───────────────────────────────────────');
  console.log(JSON.stringify(data, null, 2));

  if (txHash) {
    console.log('\n─── Transaction ────────────────────────────────────────');
    console.log(`https://basescan.org/tx/${txHash}`);
  }
}

main().catch(err => {
  console.error(err?.message ?? err);
  process.exit(1);
});
