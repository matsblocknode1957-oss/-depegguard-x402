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

// ── Paid route registry ───────────────────────────────────────────────────────
const sharedConfig = {
  recipientAddress: process.env.RECIPIENT_ADDRESS || '0xcBB1AD132bB51Cc41210309d6e3bd45598eebb5e',
  usdcContract:     process.env.USDC_CONTRACT     || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  serverUrl:        process.env.SERVER_URL         || `http://localhost:${PORT}`,
  facilitatorUrl:   process.env.FACILITATOR_URL   || 'https://api.cdp.coinbase.com/platform/v2/x402',
  rpcUrl:           process.env.BASE_RPC_URL,
};

const PAID_ROUTES = [
  {
    resourcePath: '/api/signal',
    amountMicro:  '1000',
    description:  'Depeg signals for USDT, USDC, DAI, FRAX, LUSD, DOLA, PYUSD',
    handler:      require('./routes/signal'),
  },
  {
    resourcePath: '/api/signal/coin',
    amountMicro:  '50000',
    description:  'Single-coin depeg signal — specify ?coin=USDC',
    handler:      require('./routes/signal-coin'),
  },
  {
    resourcePath: '/api/health-index',
    amountMicro:  '50000',
    description:  'Stablecoin Health Index score (0–100) across all monitored coins',
    handler:      require('./routes/health-index'),
  },
  {
    resourcePath: '/api/fear-greed',
    amountMicro:  '50000',
    description:  'Crypto Fear & Greed Index (0–100) from Alternative.me',
    handler:      require('./routes/fear-greed'),
  },
  {
    resourcePath: '/api/history',
    amountMicro:  '50000',
    description:  'Depeg history for a coin — ?coin=USDC&days=7 (max 30)',
    handler:      require('./routes/history'),
  },
  {
    resourcePath: '/api/whales',
    amountMicro:  '100000',
    description:  'Whale stablecoin transfers >$1M in the last hour',
    handler:      require('./routes/whales'),
  },
  {
    resourcePath: '/api/collateral',
    amountMicro:  '100000',
    description:  'Aave V3 collateral ratio and health factor — ?address=0x…',
    handler:      require('./routes/collateral'),
  },
  {
    resourcePath: '/api/liquidation-risk',
    amountMicro:  '100000',
    description:  'Protocol liquidation stress score — ?protocol=aave-v3',
    handler:      require('./routes/liquidation-risk'),
  },
  {
    resourcePath: '/api/tvl-risk',
    amountMicro:  '100000',
    description:  'Protocol TVL and 24h risk assessment — ?protocol=aave-v3',
    handler:      require('./routes/tvl-risk'),
  },
  {
    resourcePath: '/api/correlated-risk',
    amountMicro:  '100000',
    description:  'Correlated stablecoin risk score from FintechCheck Risk Engine',
    handler:      require('./routes/correlated-risk'),
  },
  {
    resourcePath: '/api/yield',
    amountMicro:  '50000',
    description:  'Stablecoin yield comparison across Aave, Compound, Curve',
    handler:      require('./routes/yield'),
  },
  {
    resourcePath: '/api/edgar',
    amountMicro:  '100000',
    description:  'SEC EDGAR filing alerts — latest stablecoin issuer filings',
    handler:      require('./routes/edgar'),
  },
  {
    resourcePath: '/api/macro',
    amountMicro:  '50000',
    description:  'FRED macro indicators — fed funds rate, CPI, SOFR, M2, 2yr treasury',
    handler:      require('./routes/macro'),
  },
  {
    resourcePath: '/api/proof-of-reserve',
    amountMicro:  '100000',
    description:  'Chainlink Proof of Reserve verification — ?coin=TUSD|PAXG',
    handler:      require('./routes/proof-of-reserve'),
  },
  {
    resourcePath: '/api/stress-test',
    amountMicro:  '100000',
    description:  'Portfolio stress test against historical depeg scenarios — ?portfolio=USDC:10000,USDT:5000',
    handler:      require('./routes/stress-test'),
  },
  {
    resourcePath: '/api/wallet-monitor',
    amountMicro:  '100000',
    description:  'Multi-protocol wallet borrow positions — Aave v3, Compound v3, MakerDAO on Ethereum mainnet',
    handler:      require('./routes/wallet-monitor'),
  },
  {
    resourcePath: '/api/gas',
    amountMicro:  '50000',
    description:  'Current Base and Ethereum gas prices in gwei',
    handler:      require('./routes/gas'),
  },
  {
    resourcePath: '/api/dominance',
    amountMicro:  '50000',
    description:  'Stablecoin market cap as % of total crypto market cap',
    handler:      require('./routes/dominance'),
  },
  {
    resourcePath: '/api/protocol-risk',
    amountMicro:  '100000',
    description:  'Combined TVL + liquidation + depeg risk score for a protocol — ?protocol=aave-v3',
    handler:      require('./routes/protocol-risk'),
  },
  {
    resourcePath: '/api/cross-chain-depeg',
    amountMicro:  '100000',
    description:  'Cross-chain stablecoin price comparison — Ethereum vs Base vs Arbitrum — ?coin=USDC',
    handler:      require('./routes/cross-chain-depeg'),
  },
  {
    resourcePath: '/api/protocol-comparison',
    amountMicro:  '100000',
    description:  'Side-by-side Aave v3 vs Compound v3 vs MakerDAO risk comparison',
    handler:      require('./routes/protocol-comparison'),
  },
  {
    resourcePath: '/api/liquidation-price',
    amountMicro:  '100000',
    description:  'ETH liquidation price for a wallet across Aave, Compound, MakerDAO — ?address=0x…',
    handler:      require('./routes/liquidation-price'),
  },
  {
    resourcePath: '/api/tvl-trend',
    amountMicro:  '50000',
    description:  '7 or 30 day TVL trend for a DeFi protocol — ?protocol=aave-v3&days=7',
    handler:      require('./routes/tvl-trend'),
  },
  {
    resourcePath: '/api/chainlink-price',
    amountMicro:  '50000',
    description:  'Live Chainlink on-chain price for any supported asset — ?asset=ETH',
    handler:      require('./routes/chainlink-price'),
  },
  {
    resourcePath: '/api/velocity',
    amountMicro:  '50000',
    description:  'Stablecoin supply velocity — mint/redeem rate as a risk signal — ?coin=USDC&days=30',
    handler:      require('./routes/velocity'),
  },
  {
    resourcePath: '/api/portfolio-report',
    amountMicro:  '250000',
    description:  'Full portfolio risk report across multiple wallets — ?addresses=0x1,0x2 (up to 5)',
    handler:      require('./routes/portfolio-report'),
  },
  {
    resourcePath: '/api/early-warning',
    amountMicro:  '250000',
    description:  'Depeg early warning signal — composite score 0–100, alert level GREEN/YELLOW/ORANGE/RED',
    handler:      require('./routes/early-warning'),
  },
  {
    resourcePath: '/api/ai-report',
    amountMicro:  '1000000',
    description:  'AI-generated DeFi risk advisory report via Claude — ?protocol=aave-v3 OR ?address=0x…',
    handler:      require('./routes/ai-report'),
  },
  {
    resourcePath: '/api/uniswap-pool',
    amountMicro:  '100000',
    description:  'Uniswap V3 pool liquidity snapshot — ?pool=0x… OR ?token0=USDC&token1=ETH&fee=3000',
    handler:      require('./routes/uniswap-pool'),
  },
];

for (const route of PAID_ROUTES) {
  app.use(route.resourcePath, dualSchemePayment({ ...sharedConfig, ...route }));
  app.get(route.resourcePath, route.handler);
}

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`DepegGuard x402 server  →  http://localhost:${PORT}`);
  console.log(`  Free :  GET /   GET /api/catalog`);
  console.log(`  Paid :  ${PAID_ROUTES.map((r) => r.resourcePath).join('  ')}`);

  require('./croo-provider').init().catch((err) => {
    console.error('[croo] provider failed to start:', err.message);
  });
});
