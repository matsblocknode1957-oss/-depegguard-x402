'use strict';

const SIGNAL_EXAMPLE = {
  fetchedAt: '2025-01-15T12:00:00.000Z',
  summary: {
    EXIT:    [],
    HEDGE:   ['FRAX'],
    STABLE:  ['USDT', 'USDC', 'DAI', 'LUSD', 'DOLA', 'PYUSD'],
    UNKNOWN: [],
  },
  signals: {
    USDT:  { symbol: 'USDT',  signal: 'STABLE', price: 1.0001, pegDeviation:  0.01, status: 'stable' },
    USDC:  { symbol: 'USDC',  signal: 'STABLE', price: 1.0000, pegDeviation:  0.00, status: 'stable' },
    DAI:   { symbol: 'DAI',   signal: 'STABLE', price: 0.9998, pegDeviation:  0.02, status: 'stable' },
    FRAX:  { symbol: 'FRAX',  signal: 'HEDGE',  price: 0.9942, pegDeviation:  0.58, status: 'at-risk' },
    LUSD:  { symbol: 'LUSD',  signal: 'STABLE', price: 1.0003, pegDeviation:  0.03, status: 'stable' },
    DOLA:  { symbol: 'DOLA',  signal: 'STABLE', price: 0.9997, pegDeviation:  0.03, status: 'stable' },
    PYUSD: { symbol: 'PYUSD', signal: 'STABLE', price: 1.0001, pegDeviation:  0.01, status: 'stable' },
  },
};

function catalogHandler(req, res) {
  const serverUrl = process.env.SERVER_URL || `http://localhost:${process.env.PORT || 3001}`;

  res.json({
    service: 'DepegGuard x402',
    version: '1.0.0',
    endpoints: [
      {
        method: 'GET',
        path: '/',
        auth: 'free',
        description: 'Service info, pricing, and usage instructions',
      },
      {
        method: 'GET',
        path: '/api/catalog',
        auth: 'free',
        description: 'This catalog of available endpoints and pricing',
      },
      {
        method: 'GET',
        path: '/api/signal',
        auth: 'x402-v2',
        price: '$0.001 USDC',
        priceRaw: '1000',
        priceCurrency: 'USDC',
        priceDecimals: 6,
        asset: process.env.USDC_CONTRACT || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        network: 'base',
        chainId: 8453,
        recipient: process.env.RECIPIENT_ADDRESS || '0xcBB1AD132bB51Cc41210309d6e3bd45598eebb5e',
        description: 'Depeg risk signals for USDT, USDC, DAI, FRAX, LUSD, DOLA, PYUSD fetched in parallel from PegCheck',
        responseSchema: {
          fetchedAt: 'ISO-8601 timestamp',
          summary: {
            EXIT: 'array of symbols with critical depeg (≥2% deviation) — de-risk immediately',
            HEDGE: 'array of symbols with elevated risk (0.5–2% deviation) — reduce exposure',
            STABLE: 'array of symbols within normal peg tolerance (<0.5% deviation)',
            UNKNOWN: 'array of symbols where data could not be fetched',
          },
          signals: {
            '[SYMBOL]': {
              symbol: 'string',
              signal: 'EXIT | HEDGE | STABLE | UNKNOWN',
              price: 'number — current market price in USD',
              pegDeviation: 'number — % deviation from $1.00 peg',
              status: 'string — raw status from PegCheck',
              lastUpdated: 'ISO-8601 timestamp',
            },
          },
        },
        responseExample: SIGNAL_EXAMPLE,
      },
    ],
    paymentFlow: {
      step1: `Call ${serverUrl}/api/signal without payment headers → receive 402 with x402 challenge`,
      step2: 'Parse the challenge; send 0.001 USDC to the recipient address on Base mainnet (on-chain transfer)',
      step3: 'Encode the transaction hash as a piprail proof and include it in the payment-signature header',
      step4: 'Receive 200 with signal data; payment-response header contains the verified receipt',
      client: 'Use PipRailClient from @piprail/sdk — it handles steps 2–4 automatically',
    },
  });
}

module.exports = catalogHandler;
