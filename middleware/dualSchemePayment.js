'use strict';

const { randomUUID } = require('crypto');
const { createPaymentGate } = require('@piprail/sdk');

// Canonical Base USDC — EIP-55 checksummed, verified via viem getAddress().
// Hardcoded so the 402 challenge is always correct regardless of env var capitalisation.
const BASE_USDC = '0x833589fcd6EDB6e08f4C7C32C4f2E608D57336b3';

const PAYMENT_REQUIRED_HEADER = 'payment-required';
const PAYMENT_SIGNATURE_HEADER = 'payment-signature';
const PAYMENT_RESPONSE_HEADER = 'payment-response';

const SIGNAL_EXAMPLE = {
  fetchedAt: '2025-01-15T12:00:00.000Z',
  summary: {
    EXIT:    [],
    HEDGE:   ['FRAX'],
    STABLE:  ['USDT', 'USDC', 'DAI', 'LUSD', 'DOLA', 'PYUSD'],
    UNKNOWN: [],
  },
  signals: {
    USDT:  { symbol: 'USDT',  signal: 'STABLE', price: 1.0001, pegDeviation: 0.01, status: 'stable' },
    USDC:  { symbol: 'USDC',  signal: 'STABLE', price: 1.0000, pegDeviation: 0.00, status: 'stable' },
    DAI:   { symbol: 'DAI',   signal: 'STABLE', price: 0.9998, pegDeviation: 0.02, status: 'stable' },
    FRAX:  { symbol: 'FRAX',  signal: 'HEDGE',  price: 0.9942, pegDeviation: 0.58, status: 'at-risk' },
    LUSD:  { symbol: 'LUSD',  signal: 'STABLE', price: 1.0003, pegDeviation: 0.03, status: 'stable' },
    DOLA:  { symbol: 'DOLA',  signal: 'STABLE', price: 0.9997, pegDeviation: 0.03, status: 'stable' },
    PYUSD: { symbol: 'PYUSD', signal: 'STABLE', price: 1.0001, pegDeviation: 0.01, status: 'stable' },
  },
};

const BAZAAR_EXTENSION = {
  name: 'DepegGuard Signal API',
  description: 'Real-time stablecoin depeg signals with HEDGE / EXIT / STABLE classification',
  version: '1.0.0',
  schema: {
    type: 'object',
    properties: {
      signals:       { type: 'array' },
      activeSignals: { type: 'array' },
      topSignal:     { type: 'object' },
      timestamp:     { type: 'string' },
    },
  },
  info: {
    input:  { type: 'http', method: 'GET' },
    output: { type: 'json', example: SIGNAL_EXAMPLE },
  },
};

// Decode scheme from a base64-encoded payment-signature header.
// Returns 'exact' | 'onchain-proof' | null.
function detectScheme(header) {
  try {
    const obj = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    const scheme = obj?.accepted?.scheme ?? obj?.scheme;
    if (scheme === 'exact' || scheme === 'onchain-proof') return scheme;
  } catch {}
  return null;
}

function toBase64(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64');
}

/**
 * Factory returning Express middleware that advertises both the x402 `exact`
 * scheme (for Agentic.Market/Bazaar discovery) and piprail's `onchain-proof`
 * scheme (for real Base mainnet settlement).
 *
 * config = {
 *   recipientAddress, usdcContract, serverUrl,
 *   facilitatorUrl, description, rpcUrl
 * }
 */
function dualSchemePayment(config) {
  const resourceUrl = `${config.serverUrl}/api/signal`;

  const exactAccept = {
    scheme: 'exact',
    network: 'eip155:8453',
    asset: BASE_USDC,
    amount: '1000',
    payTo: config.recipientAddress,
    maxTimeoutSeconds: 300,
    description: config.description,
    extra: { name: 'USD Coin', version: '2' },
  };

  // Piprail gate — only used for onchain-proof verification via Base RPC
  const gate = createPaymentGate({
    chain:            'base',
    token:            { address: BASE_USDC, decimals: 6 },
    amount:           '0.001',
    payTo:            config.recipientAddress,
    rpcUrl:           config.rpcUrl,
    minConfirmations: 1,
    description:      config.description,
    generateNonce:    () => randomUUID(),
  });

  // Build the 402 body fresh per request (onchain-proof nonce must be unique).
  async function build402Body() {
    const { challenge } = await gate.challenge(resourceUrl);
    return {
      x402Version: 2,
      resource: challenge.resource,          // url + description, now correctly populated
      accepts:  [exactAccept, ...challenge.accepts], // exact first for Agentic.Market, then onchain-proof
      extensions: { bazaar: BAZAAR_EXTENSION },
    };
  }

  // Settle an exact-scheme proof via the x402 facilitator.
  async function settleExact(header) {
    let paymentObj;
    try {
      paymentObj = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    } catch {
      return { success: false, error: 'Malformed payment-signature: not valid base64 JSON' };
    }

    const body = {
      x402Version: 2,
      paymentPayload: paymentObj,
      paymentRequirements: {
        scheme: 'exact',
        network: 'eip155:8453',
        asset: BASE_USDC,
        amount: '1000',
        payTo: config.recipientAddress,
        maxTimeoutSeconds: 300,
        description: config.description,
        extra: { name: 'USD Coin', version: '2' },
        resource: resourceUrl,
      },
    };

    try {
      const response = await fetch(`${config.facilitatorUrl}/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      const data = await response.json();
      if (!response.ok) {
        return { success: false, error: data.error ?? `Facilitator returned ${response.status}` };
      }
      return { success: true, txHash: data.transaction ?? data.txHash ?? null };
    } catch (err) {
      return { success: false, error: `Facilitator unreachable: ${err.message}` };
    }
  }

  return async function (req, res, next) {
    const header = req.headers[PAYMENT_SIGNATURE_HEADER];

    if (!header) {
      const body = await build402Body();
      res.status(402).set(PAYMENT_REQUIRED_HEADER, toBase64(body)).json(body);
      return;
    }

    const scheme = detectScheme(header);

    if (scheme === 'onchain-proof') {
      let result;
      try {
        result = await gate.verify(header);
      } catch (err) {
        return next(err);
      }

      if (result.kind === 'paid') {
        res.set(PAYMENT_RESPONSE_HEADER, result.receiptHeader);
        return next();
      }

      const body = await build402Body();
      res.status(402).set(PAYMENT_REQUIRED_HEADER, toBase64(body)).json({
        ...body, error: result.error ?? 'Payment verification failed',
      });
      return;
    }

    if (scheme === 'exact') {
      const result = await settleExact(header);

      if (result.success) {
        res.set(PAYMENT_RESPONSE_HEADER, toBase64({
          success: true,
          txHash: result.txHash,
          network: 'eip155:8453',
          amountSettled: '1000',
          asset: BASE_USDC,
        }));
        return next();
      }

      const body = await build402Body();
      res.status(402).set(PAYMENT_REQUIRED_HEADER, toBase64(body)).json({
        ...body, error: 'Payment verification failed', reason: result.error,
      });
      return;
    }

    // Unrecognized or malformed signature — re-issue challenge
    const body = await build402Body();
    res.status(402).set(PAYMENT_REQUIRED_HEADER, toBase64(body)).json(body);
  };
}

module.exports = { dualSchemePayment };
