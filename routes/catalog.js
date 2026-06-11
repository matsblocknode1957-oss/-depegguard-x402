'use strict';

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
      },
    ],
    paymentFlow: {
      step1: `Call ${serverUrl}/api/signal without payment headers → receive 402 with PAYMENT-REQUIRED header`,
      step2: 'Parse base64-decoded PAYMENT-REQUIRED JSON; sign an EIP-3009 transferWithAuthorization for the given amount/recipient',
      step3: 'Encode the signed payment as base64 JSON and include it in the PAYMENT-SIGNATURE header',
      step4: 'Receive 200 with signal data; PAYMENT-RESPONSE header contains settlement confirmation',
    },
  });
}

module.exports = catalogHandler;
