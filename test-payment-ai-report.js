'use strict';

require('dotenv').config();

const { PipRailClient } = require('@piprail/sdk');

const ENDPOINT = 'https://depegguard-x402-production.up.railway.app/api/ai-report?protocol=aave-v3';

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
    chain:          'base',
    wallet:         { privateKey: process.env.PRIVATE_KEY },
    rpcUrl:         process.env.BASE_RPC_URL,
    retryTimeoutMs: 90_000,
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

  console.log('\n════════════════════════════════════════════════════════');
  console.log('  AI Risk Report — Aave v3 (claude-sonnet-4-6)');
  console.log('════════════════════════════════════════════════════════\n');

  if (data.claudeError) {
    console.error(`[claude error] ${data.claudeError}`);
    if (data.note) console.error(`[note] ${data.note}`);
  }

  if (data.report) {
    console.log(data.report);
  } else {
    console.log('(no report generated — raw data below)');
  }

  console.log('\n─── Metadata ───────────────────────────────────────────');
  console.log(`fetchedAt : ${data.fetchedAt}`);
  console.log(`mode      : ${data.mode}`);
  console.log(`subject   : ${data.subject}`);
  console.log(`model     : ${data.model}`);

  if (txHash) {
    console.log('\n─── Transaction ────────────────────────────────────────');
    console.log(`https://basescan.org/tx/${txHash}`);
  }
}

main().catch(err => {
  console.error(err?.message ?? err);
  process.exit(1);
});
