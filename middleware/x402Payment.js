'use strict';

const PAYMENT_REQUIRED_HEADER = 'payment-required';
const PAYMENT_SIGNATURE_HEADER = 'payment-signature';
const PAYMENT_RESPONSE_HEADER = 'payment-response';

// Example response used in the bazaar output descriptor
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

/**
 * Builds the canonical x402 V2 payment-required body.
 * Also used (base64-encoded) as the PAYMENT-REQUIRED header value.
 */
function buildX402Body(config) {
  const resourceUrl = `${config.serverUrl}/api/signal`;

  return {
    x402Version: 2,
    accepts: [
      {
        scheme: 'exact',
        network: 'base',
        asset: config.usdcContract,
        maxAmountRequired: String(config.priceMicroUsdc),
        payTo: config.recipientAddress,
        maxTimeoutSeconds: 300,
        description: config.description,
        extra: {
          name: 'USD Coin',
          version: '2',
        },
      },
    ],
    resource: {
      url: resourceUrl,
      description: 'Stablecoin depeg risk signals for USDT, USDC, DAI, FRAX, LUSD, DOLA, PYUSD',
      mimeType: 'application/json',
    },
    extensions: {
      bazaar: {
        name: 'DepegGuard Signal API',
        description: 'Real-time stablecoin depeg signals with HEDGE / EXIT / STABLE classification',
        version: '1.0.0',
        info: {
          input: {
            type: 'http',
            method: 'GET',
          },
          output: {
            type: 'json',
            example: SIGNAL_EXAMPLE,
          },
        },
      },
    },
  };
}

/**
 * Calls the x402 facilitator to settle (verify + submit on-chain) a payment.
 * Returns { success, txHash, error }.
 */
async function settleWithFacilitator(facilitatorUrl, paymentHeader, config) {
  let paymentObj;
  try {
    paymentObj = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf8'));
  } catch {
    return { success: false, error: 'Malformed PAYMENT-SIGNATURE: not valid base64 JSON' };
  }

  const body = {
    x402Version: 2,
    scheme: paymentObj.scheme ?? 'exact',
    network: paymentObj.network ?? 'base',
    payload: paymentObj.payload,
    paymentRequirements: {
      scheme: 'exact',
      network: 'base',
      asset: config.usdcContract,
      maxAmountRequired: String(config.priceMicroUsdc),
      payTo: config.recipientAddress,
      resource: `${config.serverUrl}/api/signal`,
    },
  };

  try {
    const response = await fetch(`${facilitatorUrl}/settle`, {
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

/**
 * Factory that returns Express middleware enforcing x402 V2 payment for a route.
 *
 * config = {
 *   recipientAddress, usdcContract, priceMicroUsdc,
 *   serverUrl, facilitatorUrl, description
 * }
 */
function x402Middleware(config) {
  // Build once at startup; body is static for this server's lifetime
  const x402Body = buildX402Body(config);
  const paymentRequiredHeader = Buffer.from(JSON.stringify(x402Body)).toString('base64');

  return async function (req, res, next) {
    const paymentSignature = req.headers[PAYMENT_SIGNATURE_HEADER];

    if (!paymentSignature) {
      res.status(402)
        .set(PAYMENT_REQUIRED_HEADER, paymentRequiredHeader)
        .json(x402Body);
      return;
    }

    const result = await settleWithFacilitator(
      config.facilitatorUrl,
      paymentSignature,
      config
    );

    if (!result.success) {
      res.status(402)
        .set(PAYMENT_REQUIRED_HEADER, paymentRequiredHeader)
        .json({
          x402Version: 2,
          error: 'Payment verification failed',
          reason: result.error,
          accepts: x402Body.accepts,
          resource: x402Body.resource,
        });
      return;
    }

    const paymentResponse = Buffer.from(
      JSON.stringify({
        success: true,
        txHash: result.txHash,
        network: 'base',
        amountSettled: String(config.priceMicroUsdc),
        asset: config.usdcContract,
      })
    ).toString('base64');

    res.set(PAYMENT_RESPONSE_HEADER, paymentResponse);
    next();
  };
}

module.exports = { x402Middleware, PAYMENT_RESPONSE_HEADER };
