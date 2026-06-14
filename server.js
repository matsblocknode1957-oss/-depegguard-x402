'use strict';

require('dotenv').config();

const express = require('express');
const { randomUUID } = require('crypto');
const { requirePayment } = require('@piprail/sdk');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// ── Free endpoints ────────────────────────────────────────────────────────────
app.get('/', require('./routes/info'));
app.get('/api/catalog', require('./routes/catalog'));

// ── Piprail payment gate (on-chain verification via Base RPC) ─────────────────
// piprail's built-in 'USDC' address for Base is wrong; override with the canonical contract
const BASE_USDC = process.env.USDC_CONTRACT || '0x833589fCD6eDb6E08f4c7C32C4f2e608d57336B3';

app.use('/api/signal', requirePayment({
  chain:              'base',
  token:              { address: BASE_USDC, decimals: 6 },
  amount:             '0.001',
  payTo:              process.env.RECIPIENT_ADDRESS || '0xcBB1AD132bB51Cc41210309d6e3bd45598eebb5e',
  rpcUrl:             process.env.BASE_RPC_URL,
  minConfirmations:   1,
  description:        'PegCheck depeg signal — USDT, USDC, DAI, FRAX, LUSD, DOLA, PYUSD',
  // globalThis.crypto is absent on Node 18 in some environments (stable only in Node 19+)
  generateNonce:      () => randomUUID(),
}));

// ── Paid endpoint ─────────────────────────────────────────────────────────────
app.get('/api/signal', require('./routes/signal'));

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`DepegGuard x402 server  →  http://localhost:${PORT}`);
  console.log(`  Free :  GET /           GET /api/catalog`);
  console.log(`  Paid :  GET /api/signal  ($0.001 USDC via piprail on Base mainnet)`);
});
