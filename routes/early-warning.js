'use strict';

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

function alertLevel(score) {
  if (score >= 76) return 'RED';
  if (score >= 51) return 'ORANGE';
  if (score >= 26) return 'YELLOW';
  return 'GREEN';
}

function velocityScore(signal) {
  switch (signal) {
    case 'RAPID_CONTRACTION': return 100;
    case 'CONTRACTING':       return 60;
    case 'STABLE':            return 0;
    case 'EXPANDING':         return 10;
    case 'RAPID_EXPANSION':   return 30; // rapid expansion = leverage build-up risk
    default:                  return 0;
  }
}

function fearGreedScore(value) {
  if (value < 25) return 80;
  if (value < 40) return 50;
  if (value < 60) return 20;
  return 0;
}

function crossChainScore(deviation) {
  if (!deviation) return null;
  if (deviation.status === 'DEPEGGED') return 100;
  return Math.min(100, Math.round((deviation.maxDeviationPct ?? 0) * 200));
}

function whaleScore(whaleData) {
  const items = (whaleData?.transfers || whaleData?.movers || []).length;
  if (items > 10) return 80;
  if (items > 5)  return 40;
  if (items > 0)  return 20;
  return 0;
}

async function earlyWarningHandler(req, res) {
  try {
  const [
    velocityUsdc,
    velocityUsdt,
    whaleData,
    crossChain,
    fearGreed,
    correlatedRisk,
    healthIndex,
  ] = await Promise.all([
    callRoute(require('./velocity'),          { coin: 'USDC', days: '7' }).catch(() => null),
    callRoute(require('./velocity'),          { coin: 'USDT', days: '7' }).catch(() => null),
    callRoute(require('./whales'),            {}).catch(() => null),
    callRoute(require('./cross-chain-depeg'), { coin: 'USDC' }).catch(() => null),
    callRoute(require('./fear-greed'),        {}).catch(() => null),
    callRoute(require('./correlated-risk'),   {}).catch(() => null),
    callRoute(require('./health-index'),      {}).catch(() => null),
  ]);

  // Score each component 0–100
  const velUsdcScore  = velocityScore(velocityUsdc?.velocitySignal);
  const velUsdtScore  = velocityScore(velocityUsdt?.velocitySignal);
  const worstVel      = Math.max(velUsdcScore, velUsdtScore);
  const whaleS        = whaleScore(whaleData);
  const crossS        = crossChainScore(crossChain) ?? 0;
  const fngS          = fearGreedScore(fearGreed?.value ?? 50);
  const corrScore     = correlatedRisk?.composite ?? 0;
  const healthRisk    = Math.max(0, 100 - (healthIndex?.healthIndex ?? 50));

  // Weighted composite
  const earlyWarningScore = Math.round(
    corrScore  * 0.30 +
    healthRisk * 0.20 +
    worstVel   * 0.20 +
    fngS       * 0.15 +
    crossS     * 0.10 +
    whaleS     * 0.05,
  );

  const level = alertLevel(earlyWarningScore);

  // Contributing factors sorted by impact
  const factors = [
    { factor: 'Correlated risk (FintechCheck)', signal: correlatedRisk?.riskLevel ?? 'UNKNOWN', rawScore: corrScore,  weight: '30%', contribution: Math.round(corrScore  * 0.30) },
    { factor: 'Stablecoin health index',        signal: healthIndex?.grade ?? 'UNKNOWN',         rawScore: healthRisk, weight: '20%', contribution: Math.round(healthRisk * 0.20) },
    { factor: `Velocity (worst: ${velUsdcScore >= velUsdtScore ? 'USDC' : 'USDT'})`, signal: (velUsdcScore >= velUsdtScore ? velocityUsdc : velocityUsdt)?.velocitySignal ?? 'UNKNOWN', rawScore: worstVel, weight: '20%', contribution: Math.round(worstVel * 0.20) },
    { factor: 'Fear & Greed index',             signal: fearGreed?.classification ?? 'UNKNOWN',  rawScore: fngS,       weight: '15%', contribution: Math.round(fngS       * 0.15) },
    { factor: 'Cross-chain deviation (USDC)',   signal: crossChain?.status ?? 'UNKNOWN',         rawScore: crossS,     weight: '10%', contribution: Math.round(crossS     * 0.10) },
    { factor: 'Whale activity',                 signal: `${(whaleData?.transfers || whaleData?.movers || []).length} transfers`, rawScore: whaleS, weight: '5%', contribution: Math.round(whaleS * 0.05) },
  ].sort((a, b) => b.contribution - a.contribution);

  const topFactors = factors.filter((f) => f.contribution > 0).slice(0, 3);
  const summary = topFactors.length > 0
    ? `${level} alert: driven by ${topFactors.map((f) => f.factor.split('(')[0].trim().toLowerCase()).join(', ')}`
    : 'No significant depeg precursors detected';

  res.json({
    fetchedAt:         new Date().toISOString(),
    earlyWarningScore,
    alertLevel:        level,
    summary,
    factors: Object.fromEntries(factors.map((f, i) => [String(i), f])),
    rawData: {
      correlatedRisk:  correlatedRisk  ? { composite: corrScore, riskLevel: correlatedRisk.riskLevel } : null,
      healthIndex:     healthIndex     ? { score: healthIndex.healthIndex, grade: healthIndex.grade }   : null,
      velocityUsdc:    velocityUsdc    ? { signal: velocityUsdc.velocitySignal, changePct: velocityUsdc.changePct } : null,
      velocityUsdt:    velocityUsdt    ? { signal: velocityUsdt.velocitySignal, changePct: velocityUsdt.changePct } : null,
      fearGreed:       fearGreed       ? { value: fearGreed.value, classification: fearGreed.classification }       : null,
      crossChainDepeg: crossChain      ? { status: crossChain.status, maxDeviationPct: crossChain.maxDeviationPct } : null,
      whales:          whaleData       ? { source: whaleData.source, count: (whaleData.transfers || whaleData.movers || []).length } : null,
    },
  });
  } catch (err) {
    res.status(500).json({ error: 'Failed to compute early warning score', detail: err.message });
  }
}

module.exports = earlyWarningHandler;
