'use strict';

const PAYMENT_REQUIRED_HEADER = 'payment-required';
const PAYMENT_SIGNATURE_HEADER = 'payment-signature';
const PAYMENT_RESPONSE_HEADER = 'payment-response';

/**
 * Builds the payment requirements object served in the PAYMENT-REQUIRED header.
 * Encodes as base64 JSON per x402 V2 spec.
 */
function buildPaymentRequired(config, req) {
  const resource = `${config.serverUrl}${req.path}`;
  const requirements = {
    version: 2,
    scheme: 'exact',
    networkId: config.networkId,
    asset: config.usdcContract,
    maxAmountRequired: String(config.priceMicroUsdc),
    payTo: config.recipientAddress,
    maxTimeoutSeconds: 300,
    description: config.description,
    resource,
    extra: {
      name: 'USDC',
      decimals: 6,
    },
  };
  return Buffer.from(JSON.stringify(requirements)).toString('base64');
}

/**
 * Calls the x402 facilitator to settle (verify + submit on-chain) a payment.
 * Returns { success, txHash, error }.
 */
async function settleWithFacilitator(facilitatorUrl, paymentHeader, config, req) {
  let paymentObj;
  try {
    paymentObj = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf8'));
  } catch {
    return { success: false, error: 'Malformed PAYMENT-SIGNATURE: not valid base64 JSON' };
  }

  const resource = `${config.serverUrl}${req.path}`;

  const body = {
    x402Version: 2,
    scheme: paymentObj.scheme ?? 'exact',
    networkId: paymentObj.networkId ?? config.networkId,
    payload: paymentObj.payload,
    paymentRequirements: {
      maxAmountRequired: String(config.priceMicroUsdc),
      asset: config.usdcContract,
      payTo: config.recipientAddress,
      networkId: config.networkId,
      scheme: 'exact',
      resource,
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
 *   networkId, serverUrl, facilitatorUrl, description
 * }
 */
function x402Middleware(config) {
  return async function (req, res, next) {
    const paymentSignature = req.headers[PAYMENT_SIGNATURE_HEADER];

    if (!paymentSignature) {
      const paymentRequired = buildPaymentRequired(config, req);
      res.status(402)
        .set(PAYMENT_REQUIRED_HEADER, paymentRequired)
        .json({
          error: 'Payment required',
          description: `This endpoint costs $0.001 USDC on Base. Include a signed payment in the ${PAYMENT_SIGNATURE_HEADER.toUpperCase()} header.`,
          paymentRequired: JSON.parse(Buffer.from(paymentRequired, 'base64').toString('utf8')),
        });
      return;
    }

    const result = await settleWithFacilitator(
      config.facilitatorUrl,
      paymentSignature,
      config,
      req
    );

    if (!result.success) {
      const paymentRequired = buildPaymentRequired(config, req);
      res.status(402)
        .set(PAYMENT_REQUIRED_HEADER, paymentRequired)
        .json({
          error: 'Payment verification failed',
          reason: result.error,
        });
      return;
    }

    const paymentResponse = Buffer.from(
      JSON.stringify({
        success: true,
        txHash: result.txHash,
        networkId: config.networkId,
        amountSettled: String(config.priceMicroUsdc),
        asset: config.usdcContract,
      })
    ).toString('base64');

    res.set(PAYMENT_RESPONSE_HEADER, paymentResponse);
    next();
  };
}

module.exports = { x402Middleware, PAYMENT_RESPONSE_HEADER };
