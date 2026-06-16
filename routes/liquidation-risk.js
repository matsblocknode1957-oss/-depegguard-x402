'use strict';

const FINTECHCHECK = process.env.FINTECHCHECK_URL
  || 'https://fintechcheck-production.up.railway.app';

function riskLevel(score) {
  if (score >= 75) return 'CRITICAL';
  if (score >= 50) return 'HIGH';
  if (score >= 25) return 'MODERATE';
  return 'LOW';
}

async function liquidationRiskHandler(req, res) {
  const protocol = (req.query.protocol || 'aave-v3').toLowerCase();

  const [riskRes, tvlRes] = await Promise.all([
    fetch(`${FINTECHCHECK}/api/risk`, { signal: AbortSignal.timeout(8_000) }),
    fetch(`https://api.llama.fi/tvl/${protocol}`, { signal: AbortSignal.timeout(8_000) }),
  ]);

  if (!riskRes.ok) throw new Error(`FintechCheck returned ${riskRes.status}`);
  const risk = await riskRes.json();
  const tvlUsd = tvlRes.ok ? await tvlRes.json() : null;

  const liqStress = risk.liquidationStress ?? 0;

  res.json({
    fetchedAt: new Date().toISOString(),
    protocol,
    liquidationStress: liqStress,
    riskLevel: riskLevel(liqStress),
    pegStress: risk.pegStress ?? null,
    composite: risk.composite ?? null,
    tvlUsd: typeof tvlUsd === 'number' ? tvlUsd : null,
    sources: ['fintechcheck', 'defillama'],
  });
}

module.exports = liquidationRiskHandler;
