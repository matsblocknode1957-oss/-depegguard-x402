'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const MODEL      = 'claude-sonnet-4-6';
const MAX_TOKENS = 4096;
const FETCH_TIMEOUT_MS  = 15_000;
const CLAUDE_TIMEOUT_MS = 60_000;

const SYSTEM_PROMPT = `You are a senior DeFi risk analyst. You receive structured JSON data about a DeFi protocol or wallet. Write a concise risk advisory report with these four sections — no preamble, no padding:

## Executive Summary
2-3 sentences on overall risk posture.

## Risk Breakdown
One short paragraph each on: TVL Risk, Liquidation Risk, Peg Risk, Cross-Protocol Risk. Cite specific numbers. Keep each paragraph to 2-3 sentences.

## Key Metrics
Bullet list of the 5-7 most important risk indicators with their values. No prose.

## Recommendation
HOLD / REDUCE EXPOSURE / EXIT — one line verdict, then 2 sentences of rationale citing specific data.

Rules: cite only numbers present in the data; total output under 600 words.`;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`fetch timeout after ${ms}ms`)), ms),
    ),
  ]);
}

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

function timedRoute(handler, query) {
  return withTimeout(callRoute(handler, query), FETCH_TIMEOUT_MS).catch(() => null);
}

async function fetchProtocolData(protocol) {
  const [tvlRisk, corrRisk, protoRisk] = await Promise.all([
    timedRoute(require('./tvl-risk'),       { protocol }),
    timedRoute(require('./correlated-risk'), {}),
    timedRoute(require('./protocol-risk'),  { protocol }),
  ]);
  return {
    subject: protocol,
    mode:    'protocol',
    tvlRisk,
    correlatedRisk: corrRisk,
    protocolRisk:   protoRisk,
  };
}

async function fetchAddressData(address) {
  const [walletMon, liqPrice, corrRisk, healthIdx] = await Promise.all([
    timedRoute(require('./wallet-monitor'),    { address }),
    timedRoute(require('./liquidation-price'), { address }),
    timedRoute(require('./correlated-risk'),   {}),
    timedRoute(require('./health-index'),      {}),
  ]);
  return {
    subject: address,
    mode:    'address',
    walletMonitor:    walletMon,
    liquidationPrice: liqPrice,
    correlatedRisk:   corrRisk,
    healthIndex:      healthIdx,
  };
}

function isValidAddress(addr) {
  return typeof addr === 'string' && /^0x[0-9a-fA-F]{40}$/i.test(addr);
}

async function aiReportHandler(req, res) {
  const { protocol, address } = req.query;

  if (!protocol && !address) {
    return res.status(400).json({ error: 'Required: ?protocol=aave-v3 OR ?address=0x…' });
  }
  if (address && !isValidAddress(address)) {
    return res.status(400).json({ error: 'Invalid EVM address' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  let dataSnapshot;
  try {
    dataSnapshot = protocol
      ? await fetchProtocolData(protocol)
      : await fetchAddressData(address);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch DeFi data', detail: err.message });
  }

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
          content: `Produce a risk advisory report for this DeFi data:\n\n${JSON.stringify(dataSnapshot, null, 2)}`,
        },
      ],
    }, { signal: AbortSignal.timeout(CLAUDE_TIMEOUT_MS) });
    report = message.content[0]?.text ?? null;
  } catch (err) {
    claudeError = err.message;
    console.error('[ai-report] Claude API failed:', err.message);
  }

  res.json({
    fetchedAt: new Date().toISOString(),
    mode:      dataSnapshot.mode,
    subject:   dataSnapshot.subject,
    model:     MODEL,
    report,
    ...(claudeError ? { claudeError, note: 'Raw data returned below; report generation failed' } : {}),
    dataSnapshot,
  });
}

module.exports = aiReportHandler;
