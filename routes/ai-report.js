'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;

const SYSTEM_PROMPT = `You are a senior DeFi risk analyst. You receive structured JSON data from on-chain and off-chain sources about a DeFi protocol or wallet position. Produce a professional risk advisory report with exactly these four sections:

## Executive Summary
2-3 sentences summarising the overall risk posture.

## Risk Breakdown
Sub-sections covering TVL Risk, Liquidation Risk, Peg Risk, and Cross-Protocol Risk. Cite specific numbers from the data.

## Key Metrics
A concise bullet list of the 5-8 most important risk indicators with their values.

## Recommendation
One of: HOLD / REDUCE EXPOSURE / EXIT — followed by a 2-3 sentence rationale citing specific data points.

Be precise and data-driven. Do not invent numbers not present in the provided data.`;

function callRoute(handler, query) {
  return new Promise((resolve, reject) => {
    handler(
      { query },
      {
        json:   (data) => resolve(data),
        status: (code) => ({ json: (data) => reject(new Error(`Route ${code}: ${JSON.stringify(data)}`)) }),
      },
    );
  });
}

async function fetchProtocolData(protocol) {
  const [tvlRisk, liqRisk, corrRisk, protoRisk, tvlTrend, ethPrice] = await Promise.allSettled([
    callRoute(require('./tvl-risk'),        { protocol }),
    callRoute(require('./liquidation-risk'), { protocol }),
    callRoute(require('./correlated-risk'), {}),
    callRoute(require('./protocol-risk'),   { protocol }),
    callRoute(require('./tvl-trend'),       { protocol, days: '7' }),
    callRoute(require('./chainlink-price'), { asset: 'ETH' }),
  ]);
  return {
    subject: protocol,
    mode:    'protocol',
    tvlRisk:        tvlRisk.status      === 'fulfilled' ? tvlRisk.value      : null,
    liquidationRisk: liqRisk.status     === 'fulfilled' ? liqRisk.value      : null,
    correlatedRisk:  corrRisk.status    === 'fulfilled' ? corrRisk.value     : null,
    protocolRisk:    protoRisk.status   === 'fulfilled' ? protoRisk.value    : null,
    tvlTrend:        tvlTrend.status    === 'fulfilled' ? tvlTrend.value     : null,
    ethPriceUsd:     ethPrice.status    === 'fulfilled' ? ethPrice.value?.price : null,
  };
}

async function fetchAddressData(address) {
  const [walletMon, liqPrice, corrRisk, healthIdx, fearGreed, ethPrice] = await Promise.allSettled([
    callRoute(require('./wallet-monitor'),    { address }),
    callRoute(require('./liquidation-price'), { address }),
    callRoute(require('./correlated-risk'),   {}),
    callRoute(require('./health-index'),      {}),
    callRoute(require('./fear-greed'),        {}),
    callRoute(require('./chainlink-price'),   { asset: 'ETH' }),
  ]);
  return {
    subject: address,
    mode:    'address',
    walletMonitor:   walletMon.status  === 'fulfilled' ? walletMon.value  : null,
    liquidationPrice: liqPrice.status  === 'fulfilled' ? liqPrice.value   : null,
    correlatedRisk:  corrRisk.status   === 'fulfilled' ? corrRisk.value   : null,
    healthIndex:     healthIdx.status  === 'fulfilled' ? healthIdx.value  : null,
    fearGreed:       fearGreed.status  === 'fulfilled' ? fearGreed.value  : null,
    ethPriceUsd:     ethPrice.status   === 'fulfilled' ? ethPrice.value?.price : null,
  };
}

async function aiReportHandler(req, res) {
  const { protocol, address } = req.query;

  if (!protocol && !address) {
    return res.status(400).json({ error: 'Required: ?protocol=aave-v3 OR ?address=0x…' });
  }
  if (address) {
    const { isAddress } = await import('viem');
    if (!isAddress(address)) return res.status(400).json({ error: 'Invalid EVM address' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  // Fetch all underlying data
  const dataSnapshot = protocol
    ? await fetchProtocolData(protocol)
    : await fetchAddressData(address);

  // Call Claude — if it fails, return raw data rather than 500ing
  let report = null;
  let claudeError = null;
  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model:      MODEL,
      max_tokens: MAX_TOKENS,
      system:     SYSTEM_PROMPT,
      messages: [
        {
          role:    'user',
          content: `Please produce a risk advisory report for the following DeFi data:\n\n${JSON.stringify(dataSnapshot, null, 2)}`,
        },
      ],
    });
    report = message.content[0]?.text ?? null;
  } catch (err) {
    claudeError = err.message;
    console.error('[ai-report] Claude API failed:', err.message);
  }

  res.json({
    fetchedAt:    new Date().toISOString(),
    mode:         dataSnapshot.mode,
    subject:      dataSnapshot.subject,
    model:        MODEL,
    report,
    ...(claudeError ? { claudeError, note: 'Raw data returned below; report generation failed' } : {}),
    dataSnapshot,
  });
}

module.exports = aiReportHandler;
