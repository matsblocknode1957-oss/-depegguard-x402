'use strict';

async function tvlRiskHandler(req, res) {
  const protocol = (req.query.protocol || 'aave-v3').toLowerCase();

  const [tvlRes, protocolRes] = await Promise.all([
    fetch(`https://api.llama.fi/tvl/${protocol}`, { signal: AbortSignal.timeout(8_000) }),
    fetch(`https://api.llama.fi/protocol/${protocol}`, { signal: AbortSignal.timeout(10_000) }),
  ]);

  if (!protocolRes.ok) {
    throw new Error(`DeFi Llama returned ${protocolRes.status} for protocol "${protocol}"`);
  }

  const tvlNow = tvlRes.ok ? await tvlRes.json() : null;
  const protocolData = await protocolRes.json();

  const tvlHistory = protocolData.tvl || [];
  const latest    = tvlHistory[tvlHistory.length - 1];
  const yesterday = tvlHistory[tvlHistory.length - 2];
  const change24hPct =
    latest?.totalLiquidityUSD && yesterday?.totalLiquidityUSD
      ? ((latest.totalLiquidityUSD - yesterday.totalLiquidityUSD) / yesterday.totalLiquidityUSD) * 100
      : null;

  const chains = Object.entries(protocolData.currentChainTvls || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([chain, tvlUsd]) => ({ chain, tvlUsd }));

  const absPct = Math.abs(change24hPct ?? 0);

  res.json({
    fetchedAt: new Date().toISOString(),
    protocol: protocolData.name || protocol,
    tvlUsd: typeof tvlNow === 'number' ? tvlNow : null,
    change24hPct: change24hPct != null ? Math.round(change24hPct * 100) / 100 : null,
    riskLevel: absPct > 20 ? 'HIGH' : absPct > 10 ? 'MODERATE' : 'LOW',
    riskNote: absPct > 20
      ? 'Significant TVL outflow — potential risk event'
      : absPct > 10
      ? 'Elevated TVL movement — monitor closely'
      : 'TVL stable',
    chainBreakdown: chains,
  });
}

module.exports = tvlRiskHandler;
