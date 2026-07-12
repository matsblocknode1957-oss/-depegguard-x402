'use strict';

const { COINS, PEGCHECK_HISTORY } = require('../lib/pegcheck');

async function historyHandler(req, res) {
  const coin = (req.query.coin || 'USDC').toUpperCase();
  const days = Math.min(parseInt(req.query.days, 10) || 7, 30);

  if (!COINS.includes(coin)) {
    return res.status(400).json({ error: `Unknown coin. Supported: ${COINS.join(', ')}` });
  }

  try {
    const response = await fetch(
      `${PEGCHECK_HISTORY}?coin=${coin}&days=${days}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) return res.status(502).json({ error: `PegCheck history returned ${response.status}` });
    const data = await response.json();

    const history = Array.isArray(data)
      ? Object.fromEntries(data.map((e, i) => [String(i), e]))
      : data;
    res.json({ fetchedAt: new Date().toISOString(), coin, days, history });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch price history', detail: err.message });
  }
}

module.exports = historyHandler;
