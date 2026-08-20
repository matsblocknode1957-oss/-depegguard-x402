'use strict';

const { randomUUID } = require('crypto');
const { createPaymentGate } = require('@piprail/sdk');

const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const PAYMENT_REQUIRED_HEADER = 'payment-required';
const PAYMENT_SIGNATURE_HEADER = 'payment-signature';
const PAYMENT_RESPONSE_HEADER = 'payment-response';

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
 * config = {
 *   recipientAddress, usdcContract, serverUrl, facilitatorUrl, rpcUrl,
 *   resourcePath,   // e.g. '/api/signal'
 *   amountMicro,    // USDC in base units (6 decimals), e.g. '1000' = $0.001
 *   description,    // human-readable description (becomes serviceName on Bazaar)
 *   tags,           // string[] — up to 5, 32 chars each, for Bazaar discovery
 *   queryParams,    // JSON Schema properties object for query parameters (optional)
 *   outputExample,  // representative example response object (optional)
 * }
 */
function dualSchemePayment(config) {
  const resourceUrl = `${config.serverUrl}${config.resourcePath}`;
  const amountDecimal = String(parseInt(config.amountMicro, 10) / 1_000_000);

  // Bazaar extension — spec-compliant: only `info` inside extensions.bazaar.
  // serviceName and tags go at the resource level of the 402 body (see build402Body).
  const bazaarInfo = {
    input: {
      type: 'http',
      method: 'GET',
      ...(config.queryParams ? { queryParams: config.queryParams } : {}),
    },
    output: {
      type: 'json',
      ...(config.outputExample ? { example: config.outputExample } : {}),
    },
  };

  const exactAccept = {
    scheme: 'exact',
    network: 'eip155:8453',
    asset: BASE_USDC,
    amount: config.amountMicro,
    payTo: config.recipientAddress,
    maxTimeoutSeconds: 300,
    description: config.description,
    extra: { name: 'USD Coin', version: '2' },
  };

  const gate = createPaymentGate({
    chain:            'base',
    token:            { address: BASE_USDC, decimals: 6 },
    amount:           amountDecimal,
    payTo:            config.recipientAddress,
    rpcUrl:           config.rpcUrl,
    minConfirmations: 0,
    description:      config.description,
    generateNonce:    () => randomUUID(),
  });

  async function build402Body() {
    const { challenge } = await gate.challenge(resourceUrl);
    return {
      x402Version: 2,
      resource:    challenge.resource,
      accepts:     [exactAccept, ...challenge.accepts],
      // serviceName and tags at resource level per Bazaar spec
      serviceName: config.description,
      tags:        config.tags || [],
      extensions:  { bazaar: { info: bazaarInfo } },
    };
  }

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
        amount: config.amountMicro,
        payTo: config.recipientAddress,
        maxTimeoutSeconds: 300,
        description: config.description,
        extra: { name: 'USD Coin', version: '2' },
        resource: resourceUrl,
      },
      // Include bazaar extension in the settlement POST so the Coinbase CDP
      // facilitator can catalog this endpoint even when the paying client
      // doesn't explicitly echo it.
      extensions: { bazaar: { info: bazaarInfo } },
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
          amountSettled: config.amountMicro,
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
