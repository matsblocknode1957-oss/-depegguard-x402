'use strict';

const { COINS, fetchCoin } = require('../lib/pegcheck');
const FINTECHCHECK = process.env.FINTECHCHECK_URL || 'https://fintechcheck-production.up.railway.app';

function grade(score) {
  if (score <= 10) return 'A+';
  if (score <= 20) return 'A';
  if (score <= 35) return 'B';
  if (score <= 50) return 'C';
  if (score <= 65) return 'D';
  return 'F';
}

function riskLevel(score) {
  if (score >= 75) return 'CRITICAL';
  if (score >= 50) return 'HIGH';
  if (score >= 25) return 'MODERATE';
  return 'LOW';
}

async function protocolRiskHandler(req, res) {
  const protocol = (req.query.protocol || 'aave-v3').toLowerCase();

  const [tvlRes, protocolRes, fintechRes, pegResults] = await Promise.all([
    fetch(`https://api.llama.fi/tvl/${protocol}`, { signal: AbortSignal.timeout(8_000) }),
    fetch(`https://api.llama.fi/protocol/${protocol}`, { signal: AbortSignal.timeout(10_000) }),
    fetch(`${FINTECHCHECK}/api/risk`, { signal: AbortSignal.timeout(8_000) }),
    Promise.all(COINS.slice(0, 4).map(fetchCoin)), // USDT, USDC, DAI, FRAX
  ]);

  if (!protocolRes.ok) throw new Error(`DeFi Llama returned ${protocolRes.status} for "${protocol}"`);
  if (!fintechRes.ok)  throw new Error(`FintechCheck returned ${fintechRes.status}`);

  const tvlNow      = tvlRes.ok ? await tvlRes.json() : null;
  const protocolData = await protocolRes.json();
  const fintech      = await fintechRes.json();

  // TVL risk component (0–100)
  const tvlHist    = protocolData.tvl || [];
  const latest     = tvlHist[tvlHist.length - 1];
  const yesterday  = tvlHist[tvlHist.length - 2];
  const change24h  = latest?.totalLiquidityUSD && yesterday?.totalLiquidityUSD
    ? ((latest.totalLiquidityUSD - yesterday.totalLiquidityUSD) / yesterday.totalLiquidityUSD) * 100
    : 0;
  const tvlRiskScore = Math.min(100, Math.max(0, Math.abs(change24h) * 3));

  // Liquidation stress component (0–100) — from FintechCheck directly
  const liqStress = fintech.liquidationStress ?? 0;

  // Peg stress component (0–100) — from FintechCheck
  const pegStress = fintech.pegStress ?? 0;

  // Depeg signal component: count EXIT/HEDGE signals across top 4 coins
  const exitCount  = pegResults.filter((r) => r.signal === 'EXIT').length;
  const hedgeCount = pegResults.filter((r) => r.signal === 'HEDGE').length;
  const depegScore = Math.min(100, exitCount * 25 + hedgeCount * 10);

  // Weighted composite: TVL 25% + liquidation 35% + peg stress 25% + depeg signals 15%
  const composite = Math.round(
    tvlRiskScore * 0.25 +
    liqStress    * 0.35 +
    pegStress    * 0.25 +
    depegScore   * 0.15,
  );

  const tvlUsd = typeof tvlNow === 'number' ? tvlNow : null;

  res.json({
    fetchedAt:  new Date().toISOString(),
    protocol:   protocolData.name || protocol,
    riskScore:  composite,
    riskLevel:  riskLevel(composite),
    grade:      grade(composite),
    components: {
      tvlRisk: {
        score:       Math.round(tvlRiskScore),
        weight:      '25%',
        tvlUsd,
        change24hPct: Math.round(change24h * 100) / 100,
      },
      liquidationStress: {
        score:  liqStress,
        weight: '35%',
      },
      pegStress: {
        score:  pegStress,
        weight: '25%',
      },
      depegSignals: {
        score:     depegScore,
        weight:    '15%',
        exitCoins: pegResults.filter((r) => r.signal === 'EXIT').map((r) => r.symbol),
        hedgeCoins: pegResults.filter((r) => r.signal === 'HEDGE').map((r) => r.symbol),
      },
    },
  });
}

module.exports = protocolRiskHandler;
