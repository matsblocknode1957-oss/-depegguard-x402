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
      stressed_coins:     data.stressed_coins,
      all_regimes:        data.all_regimes,
      timestamp:          data.timestamp,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch market stress data', detail: err.message });
  }
}

module.exports = marketStressHandler;
