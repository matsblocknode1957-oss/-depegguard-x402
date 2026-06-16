'use strict';

const { COINS, PEGCHECK_HISTORY } = require('../lib/pegcheck');

async function historyHandler(req, res) {
  const coin = (req.query.coin || 'USDC').toUpperCase();
  const days = Math.min(parseInt(req.query.days, 10) || 7, 30);

  if (!COINS.includes(coin)) {
    return res.status(400).json({ error: `Unknown coin. Supported: ${COINS.join(', ')}` });
  }

  const response = await fetch(
    `${PEGCHECK_HISTORY}?coin=${coin}&days=${days}`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) throw new Error(`PegCheck history returned ${response.status}`);
  const data = await response.json();

  res.json({ fetchedAt: new Date().toISOString(), coin, days, history: data });
}

module.exports = historyHandler;
