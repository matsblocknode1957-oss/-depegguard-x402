'use strict';

const PEGCHECK_MARKET_STRESS = 'https://pegcheck.uk/api/market-stress';

async function marketStressHandler(req, res) {
  try {
    const response = await fetch(
      PEGCHECK_MARKET_STRESS,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!response.ok) return res.status(502).json({ error: `PegCheck market-stress returned ${response.status}` });
    const data = await response.json();

    res.json({
      fetchedAt:          new Date().toISOString(),
      stress_level:       data.stress_level,
      stressed_coin_count: data.stressed_coin_count,
      stressed_coins:     Object.fromEntries((data.stressed_coins || []).map((c, i) => [String(i), c])),
      all_regimes:        Object.fromEntries((data.all_regimes   || []).map((r) => [r.slug, r])),
      timestamp:          data.timestamp,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch market stress data', detail: err.message });
  }
}

module.exports = marketStressHandler;
