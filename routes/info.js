'use strict';

function infoHandler(req, res) {
  const serverUrl = process.env.SERVER_URL || `http://localhost:${process.env.PORT || 3001}`;

  res.json({
    service: 'DepegGuard x402',
    description: 'Stablecoin depeg signal API protected by x402 V2 micropayments on Base',
    version: '1.0.0',
    pricing: {
      endpoint: '/api/signal',
      price: '$0.001 USDC',
      network: 'Base mainnet',
      paymentProtocol: 'x402 V2',
    },
    coverage: ['USDT', 'USDC', 'DAI', 'FRAX', 'LUSD', 'DOLA', 'PYUSD'],
    signals: {
      EXIT: 'Peg deviation ≥ 2% — de-risk immediately',
      HEDGE: 'Peg deviation 0.5–2% — reduce exposure or hedge',
      STABLE: 'Peg deviation < 0.5% — within normal tolerance',
    },
    endpoints: {
      info: `GET ${serverUrl}/`,
      catalog: `GET ${serverUrl}/api/catalog`,
      signal: `GET ${serverUrl}/api/signal  [x402 V2 — $0.001 USDC]`,
    },
    x402Headers: {
      serverRequires: 'PAYMENT-REQUIRED  (base64 JSON, sent on 402 response)',
      clientSends: 'PAYMENT-SIGNATURE  (base64 JSON with EIP-3009 authorization)',
      serverConfirms: 'PAYMENT-RESPONSE  (base64 JSON, sent on 200 response)',
    },
    dataSource: 'https://pegcheck.uk',
    facilitator: process.env.FACILITATOR_URL || 'https://x402.org/facilitator',
  });
}

module.exports = infoHandler;
