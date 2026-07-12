'use strict';

const MAX_DAYS = 30;

async function tvlTrendHandler(req, res) {
  const protocol = (req.query.protocol || 'aave-v3').toLowerCase();
  const days     = Math.min(parseInt(req.query.days, 10) || 7, MAX_DAYS);

  try {
    const protoRes = await fetch(`https://api.llama.fi/protocol/${protocol}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!protoRes.ok) return res.status(502).json({ error: `DeFi Llama returned ${protoRes.status} for "${protocol}"` });

    const pd   = await protoRes.json();
    const hist = (pd.tvl || []).map((e) => ({
      date:   new Date(e.date * 1000).toISOString().slice(0, 10),
      tvlUsd: Math.round(e.totalLiquidityUSD),
    }));

    const slice      = hist.slice(-days);
    const startEntry = slice[0];
    const endEntry   = slice[slice.length - 1];

    const changePct = startEntry && endEntry && startEntry.tvlUsd > 0
      ? Math.round(((endEntry.tvlUsd - startEntry.tvlUsd) / startEntry.tvlUsd) * 10000) / 100
      : null;

    const trend = changePct == null ? 'UNKNOWN'
      : changePct >  2 ? 'GROWING'
      : changePct < -2 ? 'DECLINING'
      : 'FLAT';

    // Simple linear regression slope to catch noisy trends
    let slope = null;
    if (slice.length >= 3) {
      const n  = slice.length;
      const xs = slice.map((_, i) => i);
      const ys = slice.map((e) => e.tvlUsd);
      const xm = xs.reduce((s, x) => s + x, 0) / n;
      const ym = ys.reduce((s, y) => s + y, 0) / n;
      const num = xs.reduce((s, x, i) => s + (x - xm) * (ys[i] - ym), 0);
      const den = xs.reduce((s, x)    => s + (x - xm) ** 2, 0);
      slope = den > 0 ? Math.round((num / den) / 1e6) : 0; // USD millions per day
    }

    res.json({
      fetchedAt:    new Date().toISOString(),
      protocol:     pd.name || protocol,
      days,
      startTvlUsd:  startEntry?.tvlUsd ?? null,
      endTvlUsd:    endEntry?.tvlUsd   ?? null,
      changePct,
      trend,
      slopeUsdMillionsPerDay: slope,
      history: Object.fromEntries(slice.map((e, i) => [String(i), e])),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch TVL trend data', detail: err.message });
  }
}

module.exports = tvlTrendHandler;
