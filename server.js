'use strict';

require('dotenv').config();

const express = require('express');
const { dualSchemePayment } = require('./middleware/dualSchemePayment');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// ── Free endpoints ────────────────────────────────────────────────────────────
app.get('/', require('./routes/info'));
app.get('/api/catalog', require('./routes/catalog'));

// ── Dual-scheme payment gate ──────────────────────────────────────────────────
//   exact        → x402.org facilitator  (Agentic.Market/Bazaar discovery)
//   onchain-proof → piprail + Base RPC   (real mainnet settlement)
app.use('/api/signal', dualSchemePayment({
  recipientAddress: process.env.RECIPIENT_ADDRESS || '0xcBB1AD132bB51Cc41210309d6e3bd45598eebb5e',
  usdcContract:     process.env.USDC_CONTRACT     || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  serverUrl:        process.env.SERVER_URL         || `http://localhost:${PORT}`,
  facilitatorUrl:   process.env.FACILITATOR_URL   || 'https://api.cdp.coinbase.com/platform/v2/x402',
  description:      'PegCheck depeg signal — USDT, USDC, DAI, FRAX, LUSD, DOLA, PYUSD',
  rpcUrl:           process.env.BASE_RPC_URL,
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
  console.log(`  Paid :  GET /api/signal  ($0.001 USDC — exact or onchain-proof on Base)`);

  require('./croo-provider').init().catch((err) => {
    console.error('[croo] provider failed to start:', err.message);
  });
});
