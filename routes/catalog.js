'use strict';

const FREE_ENDPOINTS = [
  {
    method: 'GET', path: '/',            auth: 'free',
    description: 'Service info, pricing, and usage instructions',
  },
  {
    method: 'GET', path: '/api/catalog', auth: 'free',
    description: 'This catalog of all endpoints and pricing',
  },
];

const PAID_ENDPOINTS = [
  {
    path: '/api/signal',
    price: '$0.001', priceRaw: '1000',
    description: 'Depeg risk signals for USDT, USDC, DAI, FRAX, LUSD, DOLA, PYUSD',
    params: [],
    responseSchema: {
      fetchedAt: 'ISO-8601 timestamp',
      summary: { EXIT: 'array', HEDGE: 'array', STABLE: 'array', UNKNOWN: 'array' },
      signals: { '[SYMBOL]': { signal: 'EXIT|HEDGE|STABLE|UNKNOWN', price: 'number', pegDeviation: 'number%' } },
    },
  },
  {
    path: '/api/signal/coin',
    price: '$0.05', priceRaw: '50000',
    description: 'Single-coin depeg signal with price and deviation',
    params: [{ name: 'coin', required: true, values: 'USDT|USDC|DAI|FRAX|LUSD|DOLA|PYUSD' }],
    responseSchema: {
      fetchedAt: 'ISO-8601 timestamp',
      symbol: 'string', signal: 'EXIT|HEDGE|STABLE|UNKNOWN',
      price: 'number', pegDeviation: 'number%',
    },
  },
  {
    path: '/api/health-index',
    price: '$0.05', priceRaw: '50000',
    description: 'Composite stablecoin health score 0–100 with A–F grade',
    params: [],
    responseSchema: {
      fetchedAt: 'ISO-8601 timestamp',
      healthIndex: 'number 0–100', grade: 'A|B|C|D|F',
      interpretation: 'string', perCoin: 'object',
    },
  },
  {
    path: '/api/fear-greed',
    price: '$0.05', priceRaw: '50000',
    description: 'Crypto Fear & Greed Index (0 = Extreme Fear, 100 = Extreme Greed)',
    params: [],
    responseSchema: {
      fetchedAt: 'ISO-8601 timestamp',
      value: 'number 0–100', classification: 'string', timestamp: 'ISO-8601',
    },
  },
  {
    path: '/api/history',
    price: '$0.05', priceRaw: '50000',
    description: 'Depeg deviation history for a single coin over 7 or 30 days',
    params: [
      { name: 'coin',  required: false, default: 'USDC', values: 'USDT|USDC|DAI|FRAX|LUSD|DOLA|PYUSD' },
      { name: 'days',  required: false, default: '7',    values: '7|30' },
    ],
    responseSchema: {
      fetchedAt: 'ISO-8601 timestamp', coin: 'string', days: 'number',
      history: 'array of PegCheck history objects',
    },
  },
  {
    path: '/api/whales',
    price: '$0.10', priceRaw: '100000',
    description: 'Stablecoin whale transfers >$1M in the last hour (Whale Alert or DeFi Llama flows)',
    params: [],
    responseSchema: {
      fetchedAt: 'ISO-8601 timestamp', source: 'whale-alert|defillama-flows',
      transfers: 'array (with WHALE_ALERT_KEY) or movers array (fallback)',
    },
  },
  {
    path: '/api/collateral',
    price: '$0.10', priceRaw: '100000',
    description: 'Aave V3 on-chain collateral ratio and health factor for a wallet address',
    params: [
      { name: 'address',  required: true,  values: '0x… EVM address' },
      { name: 'protocol', required: false, default: 'aave', values: 'aave' },
    ],
    responseSchema: {
      fetchedAt: 'ISO-8601 timestamp',
      collateralUsd: 'number', debtUsd: 'number', healthFactor: 'number',
      liquidationThresholdPct: 'number', ltvPct: 'number',
      riskLevel: 'SAFE|MODERATE|ELEVATED|CRITICAL|LIQUIDATABLE',
    },
  },
  {
    path: '/api/liquidation-risk',
    price: '$0.10', priceRaw: '100000',
    description: 'Protocol-wide liquidation stress score from FintechCheck + DeFi Llama TVL',
    params: [{ name: 'protocol', required: false, default: 'aave-v3', values: 'DeFi Llama slug' }],
    responseSchema: {
      fetchedAt: 'ISO-8601 timestamp',
      liquidationStress: 'number 0–100', riskLevel: 'CRITICAL|HIGH|MODERATE|LOW',
      pegStress: 'number', composite: 'number', tvlUsd: 'number',
    },
  },
  {
    path: '/api/tvl-risk',
    price: '$0.10', priceRaw: '100000',
    description: 'Protocol TVL and 24h change risk assessment from DeFi Llama',
    params: [{ name: 'protocol', required: false, default: 'aave-v3', values: 'DeFi Llama slug' }],
    responseSchema: {
      fetchedAt: 'ISO-8601 timestamp',
      tvlUsd: 'number', change24hPct: 'number', riskLevel: 'HIGH|MODERATE|LOW',
      chainBreakdown: 'array of { chain, tvlUsd }',
    },
  },
  {
    path: '/api/correlated-risk',
    price: '$0.10', priceRaw: '100000',
    description: 'Cross-stablecoin correlated risk score from FintechCheck Risk Engine',
    params: [],
    responseSchema: {
      fetchedAt: 'ISO-8601 timestamp',
      composite: 'number 0–100', corrScore: 'number',
      riskLevel: 'CRITICAL|HIGH|MODERATE|LOW',
      correlatedCoins: 'array of symbol strings',
      perCoin: 'object — individual risk scores',
      pegStress: 'number', liquidationStress: 'number', flowPressure: 'number',
    },
  },
];

function catalogHandler(req, res) {
  const serverUrl = process.env.SERVER_URL || `http://localhost:${process.env.PORT || 3001}`;
  const recipient  = process.env.RECIPIENT_ADDRESS || '0xcBB1AD132bB51Cc41210309d6e3bd45598eebb5e';
  const asset      = process.env.USDC_CONTRACT     || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

  const paid = PAID_ENDPOINTS.map((e) => ({
    method: 'GET',
    path: e.path,
    auth: 'x402-v2',
    price: e.price,
    priceRaw: e.priceRaw,
    priceCurrency: 'USDC',
    priceDecimals: 6,
    asset,
    network: 'base',
    chainId: 8453,
    recipient,
    description: e.description,
    params: e.params,
    responseSchema: e.responseSchema,
  }));

  res.json({
    service: 'DepegGuard x402',
    version: '2.0.0',
    endpoints: [...FREE_ENDPOINTS, ...paid],
    paymentFlow: {
      step1: `Call any paid endpoint without headers → receive 402 with x402 challenge`,
      step2: 'Choose scheme: exact (EIP-3009) or onchain-proof (Base USDC transfer)',
      step3: 'Include payment-signature header with your proof',
      step4: 'Receive 200 with data; payment-response header contains the verified receipt',
      client: 'Use PipRailClient from @piprail/sdk for automatic payment handling',
    },
  });
}

module.exports = catalogHandler;
