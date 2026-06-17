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
  {
    path: '/api/yield',
    price: '$0.05', priceRaw: '50000',
    description: 'Stablecoin yield comparison — best APY across Aave, Compound, Curve',
    params: [],
    responseSchema: {
      fetchedAt: 'ISO-8601 timestamp',
      topYield: 'object — highest APY pool', bestByProject: 'object — best per protocol',
      allPools: 'array of up to 30 stablecoin pools sorted by APY',
    },
  },
  {
    path: '/api/edgar',
    price: '$0.10', priceRaw: '100000',
    description: 'SEC EDGAR filing alerts — latest filings by stablecoin issuers (Circle, Paxos, TrustToken)',
    params: [],
    responseSchema: {
      fetchedAt: 'ISO-8601 timestamp',
      count: 'number', filings: 'array of { filedAt, formType, company, description, period, url }',
    },
  },
  {
    path: '/api/macro',
    price: '$0.05', priceRaw: '50000',
    description: 'FRED macro indicators with stablecoin risk context — fed funds, CPI, SOFR, M2, 2yr treasury',
    params: [],
    responseSchema: {
      fetchedAt: 'ISO-8601 timestamp',
      indicators: 'object — { federalFundsRate, cpi, treasury2y, sofr, m2SlnUsd }',
      stablecoinContext: '{ riskLevel: ELEVATED|MODERATE|LOW, note: string }',
    },
  },
  {
    path: '/api/proof-of-reserve',
    price: '$0.10', priceRaw: '100000',
    description: 'Chainlink Proof of Reserve verification — on-chain reserves vs total supply',
    params: [{ name: 'coin', required: false, default: 'TUSD', values: 'TUSD|PAXG' }],
    responseSchema: {
      fetchedAt: 'ISO-8601 timestamp',
      coin: 'string', reservesUsd: 'number', totalSupply: 'number',
      reserveRatio: 'number (≥1.0 = fully backed)',
      status: 'BACKED|UNDERBACKED|UNKNOWN',
    },
  },
  {
    path: '/api/stress-test',
    price: '$0.10', priceRaw: '100000',
    description: 'Portfolio stress test against historical depeg scenarios (SVB, USDT FUD, UST collapse, Black Thursday)',
    params: [
      { name: 'portfolio', required: false, default: 'equal $10k split', values: 'USDC:10000,USDT:5000,DAI:2000 format' },
      { name: 'total',     required: false, default: '10000', values: 'total USD for equal-split default portfolio' },
    ],
    responseSchema: {
      fetchedAt: 'ISO-8601 timestamp',
      portfolioValueUsd: 'number',
      worstScenario: '{ name, lossUsd, lossPct }',
      scenarios: 'array — per-scenario breakdown with coinBreakdown',
    },
  },
  {
    path: '/api/wallet-monitor',
    price: '$0.10', priceRaw: '100000',
    description: 'Multi-protocol borrow positions for a wallet — Aave v3, Compound v3, MakerDAO on Ethereum mainnet',
    params: [{ name: 'address', required: true, values: '0x… EVM address' }],
    responseSchema: {
      fetchedAt: 'ISO-8601 timestamp',
      address: 'string', ethPriceUsd: 'number',
      overallRisk: 'SAFE|MODERATE|ELEVATED|CRITICAL|LIQUIDATABLE|NO_POSITIONS',
      worstHealthFactor: 'number',
      positions: 'array of { protocol, healthFactor, collateralUsd, debtUsd, riskLevel }',
    },
  },
  {
    path: '/api/gas',
    price: '$0.05', priceRaw: '50000',
    description: 'Current Base and Ethereum gas prices — base fee + priority fee in gwei',
    params: [],
    responseSchema: {
      fetchedAt: 'ISO-8601 timestamp',
      networks: 'array of { network, baseFeeGwei, priorityFeeGwei, totalGwei, estimatedUsdcTransferCostUsd }',
    },
  },
  {
    path: '/api/dominance',
    price: '$0.05', priceRaw: '50000',
    description: 'Stablecoin dominance — stablecoin market cap as % of total crypto market cap',
    params: [],
    responseSchema: {
      fetchedAt: 'ISO-8601 timestamp',
      stablecoinMarketCapUsd: 'number', totalCryptoMarketCapUsd: 'number',
      dominancePct: 'number', change24hPct: 'number',
      trend: 'EXPANDING|CONTRACTING|STABLE', topStablecoins: 'array of { symbol, marketCapUsd, sharePct }',
    },
  },
  {
    path: '/api/protocol-risk',
    price: '$0.10', priceRaw: '100000',
    description: 'Combined risk score for a DeFi protocol — TVL, liquidation stress, peg stress, depeg signals',
    params: [{ name: 'protocol', required: false, default: 'aave-v3', values: 'DeFi Llama slug' }],
    responseSchema: {
      fetchedAt: 'ISO-8601 timestamp',
      riskScore: 'number 0–100', riskLevel: 'CRITICAL|HIGH|MODERATE|LOW', grade: 'A+|A|B|C|D|F',
      components: 'object — { tvlRisk, liquidationStress, pegStress, depegSignals } with weights',
    },
  },
  {
    path: '/api/cross-chain-depeg',
    price: '$0.10', priceRaw: '100000',
    description: 'Cross-chain stablecoin price comparison — same coin on Ethereum, Base, Arbitrum via Chainlink',
    params: [{ name: 'coin', required: false, default: 'USDC', values: 'USDC|USDT|DAI' }],
    responseSchema: {
      fetchedAt: 'ISO-8601 timestamp',
      coin: 'string', status: 'STABLE|DEPEGGED',
      maxDeviationPct: 'number',
      chains: 'array of { chain, price, updatedAt, deviation }',
    },
  },
  {
    path: '/api/protocol-comparison',
    price: '$0.10', priceRaw: '100000',
    description: 'Side-by-side risk comparison of Aave v3, Compound v3, and MakerDAO',
    params: [],
    responseSchema: {
      fetchedAt: 'ISO-8601 timestamp',
      protocols: 'object keyed by protocol slug',
      ranking: 'array — protocols ordered safest to riskiest',
      safest: 'string', riskiest: 'string',
      systemWide: '{ liquidationStress, pegStress }',
    },
  },
  {
    path: '/api/liquidation-price',
    price: '$0.10', priceRaw: '100000',
    description: 'ETH price at which a wallet\'s positions get liquidated — Aave, Compound, MakerDAO',
    params: [{ name: 'address', required: true, values: '0x… EVM address' }],
    responseSchema: {
      fetchedAt: 'ISO-8601 timestamp',
      currentEthPrice: 'number',
      mostAtRisk: '{ protocol, liquidationPriceUsd, safetyBuffer }',
      positions: 'array of { protocol, healthFactor, liquidationPriceUsd, safetyBuffer }',
    },
  },
  {
    path: '/api/tvl-trend',
    price: '$0.05', priceRaw: '50000',
    description: '7 or 30-day TVL trend for a DeFi protocol with growth rate and linear slope',
    params: [
      { name: 'protocol', required: false, default: 'aave-v3', values: 'DeFi Llama slug' },
      { name: 'days',     required: false, default: '7',       values: '1–30' },
    ],
    responseSchema: {
      fetchedAt: 'ISO-8601 timestamp',
      protocol: 'string', days: 'number',
      startTvlUsd: 'number', endTvlUsd: 'number', changePct: 'number',
      trend: 'GROWING|DECLINING|FLAT|UNKNOWN',
      slopeUsdMillionsPerDay: 'number', history: 'array of { date, tvlUsd }',
    },
  },
  {
    path: '/api/chainlink-price',
    price: '$0.05', priceRaw: '50000',
    description: 'Live Chainlink on-chain price for ETH, BTC, USDC, USDT, DAI, FRAX, LINK, AAVE, CRV, MATIC, SOL, LUSD',
    params: [{ name: 'asset', required: false, default: 'ETH', values: 'ETH|BTC|USDC|USDT|DAI|FRAX|LUSD|LINK|AAVE|CRV|MATIC|SOL' }],
    responseSchema: {
      fetchedAt: 'ISO-8601 timestamp',
      pair: 'string e.g. ETH/USD', price: 'number',
      updatedAt: 'ISO-8601', staleSeconds: 'number', isStale: 'boolean',
      roundId: 'string', feedAddress: 'string',
    },
  },
  {
    path: '/api/velocity',
    price: '$0.05', priceRaw: '50000',
    description: 'Stablecoin supply velocity — mint/redeem growth rate as a risk signal over 7 or 30 days',
    params: [
      { name: 'coin', required: false, default: 'USDC', values: 'USDT|USDC|DAI|FRAX|TUSD|USDP|GUSD|LUSD|PYUSD' },
      { name: 'days', required: false, default: '30',   values: '1–30' },
    ],
    responseSchema: {
      fetchedAt: 'ISO-8601 timestamp',
      coin: 'string', currentSupplyUsd: 'number', changePct: 'number', dailyChangePct: 'number',
      velocitySignal: 'RAPID_EXPANSION|EXPANDING|STABLE|CONTRACTING|RAPID_CONTRACTION',
      note: 'string', history: 'array of { date, supplyUsd }',
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
