'use strict';

require('dotenv').config();

const express = require('express');
const { dualSchemePayment } = require('./middleware/dualSchemePayment');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// CORS — needed for browser-based x402 clients and agentic wallets
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, payment-signature');
  res.header('Access-Control-Expose-Headers', 'payment-required, payment-response');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Free endpoints ────────────────────────────────────────────────────────────
app.get('/', require('./routes/info'));
app.get('/api/catalog', require('./routes/catalog'));
app.use('/casper', require('./routes/casper-signal'));

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
    resourcePath:  '/api/signal',
    amountMicro:   '1000',
    description:   'Depeg signals for USDT, USDC, DAI, FRAX, LUSD, DOLA, PYUSD',
    tags:          ['stablecoin', 'depeg', 'signal', 'monitoring'],
    outputExample: { coin: 'USDC', signal: 'STABLE', deviation_bps: 4, price: 1.0004, sources: 3 },
    handler:       require('./routes/signal'),
  },
  {
    resourcePath:  '/api/signal/coin',
    amountMicro:   '50000',
    description:   'Single-coin depeg signal — specify ?coin=USDC',
    tags:          ['stablecoin', 'depeg', 'signal'],
    queryParams:   {
      coin: { type: 'string', description: 'Stablecoin symbol, e.g. USDC, USDT, DAI' },
    },
    outputExample: { coin: 'USDC', signal: 'STABLE', deviation_bps: 4, price: 1.0004 },
    handler:       require('./routes/signal-coin'),
  },
  {
    resourcePath:  '/api/health-index',
    amountMicro:   '50000',
    description:   'Stablecoin Health Index score (0–100) across all monitored coins',
    tags:          ['stablecoin', 'health', 'monitoring'],
    outputExample: { health_index: 94, rating: 'HEALTHY', coins_monitored: 19 },
    handler:       require('./routes/health-index'),
  },
  {
    resourcePath:  '/api/fear-greed',
    amountMicro:   '50000',
    description:   'Crypto Fear & Greed Index (0–100) from Alternative.me',
    tags:          ['sentiment', 'fear-greed', 'crypto'],
    outputExample: { value: 62, label: 'Greed', timestamp: '2026-08-20T10:00:00Z' },
    handler:       require('./routes/fear-greed'),
  },
  {
    resourcePath:  '/api/history',
    amountMicro:   '50000',
    description:   'Depeg history for a coin — ?coin=USDC&days=7 (max 30)',
    tags:          ['stablecoin', 'history', 'depeg'],
    queryParams:   {
      coin: { type: 'string', description: 'Stablecoin symbol, e.g. USDC' },
      days: { type: 'integer', description: 'Number of days of history (1–30)', default: 7 },
    },
    outputExample: { coin: 'USDC', days: 7, events: [{ date: '2026-08-13', deviation_bps: 8, signal: 'STABLE' }] },
    handler:       require('./routes/history'),
  },
  {
    resourcePath:  '/api/whales',
    amountMicro:   '100000',
    description:   'Whale stablecoin transfers >$1M in the last hour',
    tags:          ['whale', 'transfers', 'on-chain', 'stablecoin'],
    outputExample: { transfers: [{ coin: 'USDT', amount_usd: 5200000, from: '0xabc…', to: '0xdef…' }] },
    handler:       require('./routes/whales'),
  },
  {
    resourcePath:  '/api/collateral',
    amountMicro:   '100000',
    description:   'Aave V3 collateral ratio and health factor — ?address=0x…',
    tags:          ['aave', 'collateral', 'defi', 'lending'],
    queryParams:   {
      address: { type: 'string', description: 'Ethereum wallet address (0x…)' },
    },
    outputExample: { address: '0xabc…', health_factor: 2.14, collateral_usd: 10000, debt_usd: 4672 },
    handler:       require('./routes/collateral'),
  },
  {
    resourcePath:  '/api/liquidation-risk',
    amountMicro:   '100000',
    description:   'Protocol liquidation stress score — ?protocol=aave-v3',
    tags:          ['liquidation', 'defi', 'risk', 'protocol'],
    queryParams:   {
      protocol: { type: 'string', description: 'Protocol slug, e.g. aave-v3, compound-v3' },
    },
    outputExample: { protocol: 'aave-v3', liquidation_stress: 18, rating: 'LOW' },
    handler:       require('./routes/liquidation-risk'),
  },
  {
    resourcePath:  '/api/tvl-risk',
    amountMicro:   '100000',
    description:   'Protocol TVL and 24h risk assessment — ?protocol=aave-v3',
    tags:          ['tvl', 'defi', 'risk', 'protocol'],
    queryParams:   {
      protocol: { type: 'string', description: 'Protocol slug, e.g. aave-v3, compound-v3' },
    },
    outputExample: { protocol: 'aave-v3', tvl_usd: 12400000000, change_24h_pct: -1.2, risk: 'LOW' },
    handler:       require('./routes/tvl-risk'),
  },
  {
    resourcePath:  '/api/correlated-risk',
    amountMicro:   '100000',
    description:   'Correlated stablecoin risk score from FintechCheck Risk Engine',
    tags:          ['correlation', 'stablecoin', 'risk'],
    outputExample: { score: 22, rating: 'LOW', top_correlations: [{ pair: 'USDT/USDC', r: 0.97 }] },
    handler:       require('./routes/correlated-risk'),
  },
  {
    resourcePath:  '/api/yield',
    amountMicro:   '50000',
    description:   'Stablecoin yield comparison across Aave, Compound, Curve',
    tags:          ['yield', 'aave', 'compound', 'defi'],
    outputExample: { USDC: { aave: 4.2, compound: 3.8, curve: 5.1 }, USDT: { aave: 3.9 } },
    handler:       require('./routes/yield'),
  },
  {
    resourcePath:  '/api/edgar',
    amountMicro:   '100000',
    description:   'SEC EDGAR filing alerts — latest stablecoin issuer filings',
    tags:          ['sec', 'edgar', 'compliance', 'stablecoin'],
    outputExample: { filings: [{ issuer: 'Circle', form: '10-K', date: '2026-03-01', url: 'https://…' }] },
    handler:       require('./routes/edgar'),
  },
  {
    resourcePath:  '/api/macro',
    amountMicro:   '50000',
    description:   'FRED macro indicators — fed funds rate, CPI, SOFR, M2, 2yr treasury',
    tags:          ['macro', 'fed', 'cpi', 'treasury'],
    outputExample: { fed_funds_rate: 5.33, cpi_yoy: 2.9, sofr: 5.31, m2_growth: 0.4, treasury_2yr: 4.87 },
    handler:       require('./routes/macro'),
  },
  {
    resourcePath:  '/api/proof-of-reserve',
    amountMicro:   '100000',
    description:   'Chainlink Proof of Reserve verification — ?coin=TUSD|PAXG',
    tags:          ['proof-of-reserve', 'chainlink', 'stablecoin'],
    queryParams:   {
      coin: { type: 'string', description: 'Coin symbol, e.g. TUSD, PAXG' },
    },
    outputExample: { coin: 'TUSD', reserve_usd: 495000000, supply_usd: 490000000, backed: true },
    handler:       require('./routes/proof-of-reserve'),
  },
  {
    resourcePath:  '/api/stress-test',
    amountMicro:   '100000',
    description:   'Portfolio stress test against historical depeg scenarios — ?portfolio=USDC:10000,USDT:5000',
    tags:          ['stress-test', 'portfolio', 'risk', 'stablecoin'],
    queryParams:   {
      portfolio: { type: 'string', description: 'Comma-separated COIN:AMOUNT pairs, e.g. USDC:10000,USDT:5000' },
    },
    outputExample: { worst_case_loss_pct: 3.2, scenario: 'UST-style depeg', portfolio_value_usd: 15000 },
    handler:       require('./routes/stress-test'),
  },
  {
    resourcePath:  '/api/wallet-monitor',
    amountMicro:   '100000',
    description:   'Multi-protocol wallet borrow positions — Aave v3, Compound v3, MakerDAO on Ethereum mainnet',
    tags:          ['wallet', 'defi', 'lending', 'aave'],
    queryParams:   {
      address: { type: 'string', description: 'Ethereum wallet address (0x…)' },
    },
    outputExample: { address: '0xabc…', positions: [{ protocol: 'aave-v3', debt_usd: 4500, health_factor: 2.1 }] },
    handler:       require('./routes/wallet-monitor'),
  },
  {
    resourcePath:  '/api/gas',
    amountMicro:   '50000',
    description:   'Current Base and Ethereum gas prices in gwei',
    tags:          ['gas', 'base', 'ethereum'],
    outputExample: { ethereum: { base_fee: 12.4, priority_fee: 1.0 }, base: { base_fee: 0.05 } },
    handler:       require('./routes/gas'),
  },
  {
    resourcePath:  '/api/dominance',
    amountMicro:   '50000',
    description:   'Stablecoin market cap as % of total crypto market cap',
    tags:          ['dominance', 'market-cap', 'stablecoin'],
    outputExample: { stablecoin_dominance_pct: 6.8, total_market_cap_usd: 2800000000000, stablecoin_cap_usd: 190000000000 },
    handler:       require('./routes/dominance'),
  },
  {
    resourcePath:  '/api/protocol-risk',
    amountMicro:   '100000',
    description:   'Combined TVL + liquidation + depeg risk score for a protocol — ?protocol=aave-v3',
    tags:          ['protocol', 'risk', 'defi', 'stablecoin'],
    queryParams:   {
      protocol: { type: 'string', description: 'Protocol slug, e.g. aave-v3, compound-v3, makerdao' },
    },
    outputExample: { protocol: 'aave-v3', risk_score: 24, rating: 'LOW', tvl_usd: 12400000000 },
    handler:       require('./routes/protocol-risk'),
  },
  {
    resourcePath:  '/api/cross-chain-depeg',
    amountMicro:   '100000',
    description:   'Cross-chain stablecoin price comparison — Ethereum vs Base vs Arbitrum — ?coin=USDC',
    tags:          ['cross-chain', 'depeg', 'stablecoin'],
    queryParams:   {
      coin: { type: 'string', description: 'Stablecoin symbol, e.g. USDC, USDT' },
    },
    outputExample: { coin: 'USDC', ethereum: 1.0002, base: 1.0001, arbitrum: 1.0003, max_spread_bps: 2 },
    handler:       require('./routes/cross-chain-depeg'),
  },
  {
    resourcePath:  '/api/protocol-comparison',
    amountMicro:   '100000',
    description:   'Side-by-side Aave v3 vs Compound v3 vs MakerDAO risk comparison',
    tags:          ['aave', 'compound', 'makerdao', 'defi'],
    outputExample: { protocols: [{ name: 'aave-v3', tvl_usd: 12400000000, risk_score: 24 }] },
    handler:       require('./routes/protocol-comparison'),
  },
  {
    resourcePath:  '/api/liquidation-price',
    amountMicro:   '100000',
    description:   'ETH liquidation price for a wallet across Aave, Compound, MakerDAO — ?address=0x…',
    tags:          ['liquidation', 'wallet', 'defi', 'ethereum'],
    queryParams:   {
      address: { type: 'string', description: 'Ethereum wallet address (0x…)' },
    },
    outputExample: { address: '0xabc…', liquidation_prices: [{ protocol: 'aave-v3', eth_price_usd: 1820 }] },
    handler:       require('./routes/liquidation-price'),
  },
  {
    resourcePath:  '/api/tvl-trend',
    amountMicro:   '50000',
    description:   '7 or 30 day TVL trend for a DeFi protocol — ?protocol=aave-v3&days=7',
    tags:          ['tvl', 'trend', 'defi', 'protocol'],
    queryParams:   {
      protocol: { type: 'string', description: 'Protocol slug, e.g. aave-v3, compound-v3' },
      days:     { type: 'integer', description: 'Number of days (7 or 30)', default: 7 },
    },
    outputExample: { protocol: 'aave-v3', days: 7, trend: [{ date: '2026-08-13', tvl_usd: 12100000000 }] },
    handler:       require('./routes/tvl-trend'),
  },
  {
    resourcePath:  '/api/chainlink-price',
    amountMicro:   '50000',
    description:   'Live Chainlink on-chain price for any supported asset — ?asset=ETH',
    tags:          ['chainlink', 'price', 'on-chain'],
    queryParams:   {
      asset: { type: 'string', description: 'Asset symbol, e.g. ETH, BTC, USDC' },
    },
    outputExample: { asset: 'ETH', price_usd: 3241.50, updated_at: '2026-08-20T10:00:00Z' },
    handler:       require('./routes/chainlink-price'),
  },
  {
    resourcePath:  '/api/velocity',
    amountMicro:   '50000',
    description:   'Stablecoin supply velocity — mint/redeem rate as a risk signal — ?coin=USDC&days=30',
    tags:          ['velocity', 'supply', 'stablecoin', 'risk'],
    queryParams:   {
      coin: { type: 'string', description: 'Stablecoin symbol, e.g. USDC, USDT' },
      days: { type: 'integer', description: 'Lookback period in days (1–90)', default: 30 },
    },
    outputExample: { coin: 'USDC', days: 30, net_mint_usd: 820000000, velocity_signal: 'NEUTRAL' },
    handler:       require('./routes/velocity'),
  },
  {
    resourcePath:  '/api/portfolio-report',
    amountMicro:   '250000',
    description:   'Full portfolio risk report across multiple wallets — ?addresses=0x1,0x2 (up to 5)',
    tags:          ['portfolio', 'report', 'defi', 'risk'],
    queryParams:   {
      addresses: { type: 'string', description: 'Comma-separated wallet addresses (up to 5)' },
    },
    outputExample: { wallets: 2, total_debt_usd: 18000, overall_risk: 'MEDIUM', protocols: ['aave-v3'] },
    handler:       require('./routes/portfolio-report'),
  },
  {
    resourcePath:  '/api/early-warning',
    amountMicro:   '250000',
    description:   'Depeg early warning signal — composite score 0–100, alert level GREEN/YELLOW/ORANGE/RED',
    tags:          ['early-warning', 'depeg', 'alert', 'stablecoin'],
    queryParams:   {
      coin: { type: 'string', description: 'Stablecoin symbol (optional — omit for all coins)' },
    },
    outputExample: { coin: 'USDC', score: 8, alert: 'GREEN', factors: { price_deviation: 4, velocity: 2 } },
    handler:       require('./routes/early-warning'),
  },
  {
    resourcePath:  '/api/ai-report',
    amountMicro:   '1000000',
    description:   'AI-generated DeFi risk advisory report via Claude — ?protocol=aave-v3 OR ?address=0x…',
    tags:          ['ai', 'report', 'defi', 'risk'],
    queryParams:   {
      protocol: { type: 'string', description: 'Protocol slug, e.g. aave-v3 (use protocol OR address)' },
      address:  { type: 'string', description: 'Wallet address 0x… (use address OR protocol)' },
    },
    outputExample: { protocol: 'aave-v3', summary: 'Low-risk profile…', risk_score: 24, generated_at: '2026-08-20T10:00:00Z' },
    handler:       require('./routes/ai-report'),
  },
  {
    resourcePath:  '/api/uniswap-pool',
    amountMicro:   '100000',
    description:   'Uniswap V3 pool liquidity snapshot — ?pool=0x… OR ?token0=USDC&token1=ETH&fee=3000',
    tags:          ['uniswap', 'liquidity', 'pool', 'defi'],
    queryParams:   {
      pool:   { type: 'string', description: 'Pool contract address 0x… (alternative to token params)' },
      token0: { type: 'string', description: 'First token symbol, e.g. USDC' },
      token1: { type: 'string', description: 'Second token symbol, e.g. ETH' },
      fee:    { type: 'integer', description: 'Fee tier in bps x 100: 500, 3000, or 10000' },
    },
    outputExample: { pool: '0xabc…', tvl_usd: 42000000, tick_current: 195000, utilization: 0.71 },
    handler:       require('./routes/uniswap-pool'),
  },
  {
    resourcePath:  '/api/regime',
    amountMicro:   '250000',
    description:   'PegCheck two-layer regime classifier — Layer A regime + Layer B trajectory + 11 features — ?symbol=USDC',
    tags:          ['regime', 'classifier', 'stablecoin'],
    queryParams:   {
      symbol: { type: 'string', description: 'Stablecoin symbol, e.g. USDC, USDT, DAI' },
    },
    outputExample: { symbol: 'USDC', regime: 'STABLE', trajectory: 'FLAT', confidence: 0.94, features: {} },
    handler:       require('./routes/regime'),
  },
  {
    resourcePath:  '/api/market-stress',
    amountMicro:   '250000',
    description:   'System-wide stablecoin stress assessment across all 19 monitored coins — stress level + per-coin regimes',
    tags:          ['market-stress', 'stablecoin', 'monitoring'],
    outputExample: { stress_level: 'LOW', stressed_coins: 0, coins: [{ symbol: 'USDC', regime: 'STABLE' }] },
    handler:       require('./routes/market-stress'),
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
