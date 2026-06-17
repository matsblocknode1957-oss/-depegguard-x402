'use strict';

const PEGCHECK_MARKET_STRESS = 'https://pegcheck.uk/api/market-stress';

async function marketStressHandler(req, res) {
  const response = await fetch(
    PEGCHECK_MARKET_STRESS,
    { signal: AbortSignal.timeout(15_000) },
  );
  if (!response.ok) throw new Error(`PegCheck market-stress returned ${response.status}`);
  const data = await response.json();

  res.json({
    fetchedAt:          new Date().toISOString(),
    stress_level:       data.stress_level,
    stressed_coin_count: data.stressed_coin_count,
    stressed_coins:     data.stressed_coins,
    all_regimes:        data.all_regimes,
    timestamp:          data.timestamp,
  });
}

module.exports = marketStressHandler;
