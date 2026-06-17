'use strict';

const FINTECHCHECK = process.env.FINTECHCHECK_URL || 'https://fintechcheck-production.up.railway.app';

const PROTOCOLS = [
  { key: 'aave-v3',    label: 'Aave V3' },
  { key: 'compound-v3', label: 'Compound V3' },
  { key: 'makerdao',   label: 'MakerDAO' },
];

async function fetchTvlData(slug) {
  const [tvlRes, protoRes] = await Promise.all([
    fetch(`https://api.llama.fi/tvl/${slug}`,      { signal: AbortSignal.timeout(8_000) }),
    fetch(`https://api.llama.fi/protocol/${slug}`, { signal: AbortSignal.timeout(10_000) }),
  ]);
  const tvlNow = tvlRes.ok ? await tvlRes.json() : null;
  if (!protoRes.ok) return { tvlUsd: null, change24hPct: null, name: slug };
  const pd   = await protoRes.json();
  const hist = pd.tvl || [];
  const lat  = hist[hist.length - 1];
  const yest = hist[hist.length - 2];
  const change24hPct = lat?.totalLiquidityUSD && yest?.totalLiquidityUSD
    ? Math.round(((lat.totalLiquidityUSD - yest.totalLiquidityUSD) / yest.totalLiquidityUSD) * 10000) / 100
    : null;
  return {
    name:         pd.name || slug,
    tvlUsd:       typeof tvlNow === 'number' ? tvlNow : null,
    change24hPct,
  };
}

function tvlRiskScore(change24hPct) {
  const abs = Math.abs(change24hPct ?? 0);
  if (abs > 20) return 80;
  if (abs > 10) return 50;
  if (abs > 5)  return 25;
  return 10;
}

function riskLevel(score) {
  if (score >= 65) return 'HIGH';
  if (score >= 35) return 'MODERATE';
  return 'LOW';
}

async function protocolComparisonHandler(req, res) {
  const [tvlResults, ftRes] = await Promise.all([
    Promise.all(PROTOCOLS.map((p) => fetchTvlData(p.key))),
    fetch(`${FINTECHCHECK}/api/risk`, { signal: AbortSignal.timeout(8_000) }),
  ]);

  const ftData = ftRes.ok ? await ftRes.json() : {};
  const liqStress   = ftData.liquidationStress ?? 0;
  const pegStress   = ftData.pegStress         ?? 0;

  const compared = PROTOCOLS.map((p, i) => {
    const tvl     = tvlResults[i];
    const tScore  = tvlRiskScore(tvl.change24hPct);
    // Liquidation and peg stress are system-wide; weight more heavily for lending protocols
    const isLending = p.key !== 'makerdao';
    const composite = Math.round(tScore * 0.4 + liqStress * (isLending ? 0.4 : 0.3) + pegStress * (isLending ? 0.2 : 0.3));
    return {
      protocol:     p.key,
      name:         tvl.name,
      tvlUsd:       tvl.tvlUsd,
      change24hPct: tvl.change24hPct,
      liquidationStress: liqStress,
      pegStress,
      compositeScore: composite,
      riskLevel:    riskLevel(composite),
    };
  });

  // Rank safest first
  const ranked = [...compared].sort((a, b) => a.compositeScore - b.compositeScore);

  res.json({
    fetchedAt:  new Date().toISOString(),
    protocols:  Object.fromEntries(compared.map((p) => [p.protocol, p])),
    ranking:    ranked.map((p) => p.protocol),
    safest:     ranked[0].protocol,
    riskiest:   ranked[ranked.length - 1].protocol,
    systemWide: { liquidationStress: liqStress, pegStress },
  });
}

module.exports = protocolComparisonHandler;
