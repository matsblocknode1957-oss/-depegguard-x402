'use strict';

function infoHandler(req, res) {
  const serverUrl = process.env.SERVER_URL || `http://localhost:${process.env.PORT || 3001}`;

  res.json({
    service: 'DepegGuard x402',
    description: 'DeFi risk intelligence API protected by x402 V2 micropayments on Base',
    version: '2.0.0',
    priceTiers: {
      '$0.001': ['GET /api/signal — full 7-coin depeg scan'],
      '$0.05':  [
        'GET /api/signal/coin?coin=USDC — single coin depeg signal',
        'GET /api/health-index — stablecoin health score 0–100',
        'GET /api/fear-greed — crypto fear & greed index',
        'GET /api/history?coin=USDC&days=7 — depeg history',
      ],
      '$0.10':  [
        'GET /api/whales — whale transfers >$1M',
        'GET /api/collateral?address=0x… — Aave V3 health factor',
        'GET /api/liquidation-risk?protocol=aave-v3 — liquidation stress score',
        'GET /api/tvl-risk?protocol=aave-v3 — TVL & 24h risk',
        'GET /api/correlated-risk — cross-stablecoin risk score',
      ],
    },
    network: 'Base mainnet',
    paymentProtocol: 'x402 V2',
    dataSources: ['pegcheck.uk', 'fintechcheck.uk', 'alternative.me/fng', 'defillama', 'whale-alert.io (optional key)'],
    endpoints: {
      info:    `GET ${serverUrl}/`,
      catalog: `GET ${serverUrl}/api/catalog`,
    },
    x402Headers: {
      serverRequires: 'PAYMENT-REQUIRED  (base64 JSON, sent on 402 response)',
      clientSends:    'PAYMENT-SIGNATURE (base64 JSON with EIP-3009 authorization)',
      serverConfirms: 'PAYMENT-RESPONSE  (base64 JSON, sent on 200 response)',
    },
  });
}

module.exports = infoHandler;
