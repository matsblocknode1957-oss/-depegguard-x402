'use strict';

const FINTECHCHECK = process.env.FINTECHCHECK_URL
  || 'https://fintechcheck-production.up.railway.app';

function riskLevel(composite) {
  if (composite >= 75) return 'CRITICAL';
  if (composite >= 50) return 'HIGH';
  if (composite >= 25) return 'MODERATE';
  return 'LOW';
}

async function correlatedRiskHandler(req, res) {
  try {
  const response = await fetch(`${FINTECHCHECK}/api/risk`, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) return res.status(502).json({ error: `FintechCheck returned ${response.status}` });
  const data = await response.json();

  res.json({
    fetchedAt: new Date().toISOString(),
    composite: data.composite,
    corrScore: data.corrScore,
    riskLevel: riskLevel(data.composite ?? 0),
    correlatedCoins: Object.fromEntries((data.correlatedCoins || []).map((c, i) => [String(i), c])),
    pegStress: data.pegStress,
    liquidationStress: data.liquidationStress,
    flowPressure: data.flowPressure,
    perCoin: data.perCoin || {},
    dataTimestamp: new Date(data.timestamp).toISOString(),
  });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch correlated risk data', detail: err.message });
  }
}

module.exports = correlatedRiskHandler;
