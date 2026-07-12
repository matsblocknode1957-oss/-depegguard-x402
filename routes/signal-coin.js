'use strict';

const { COINS, fetchCoin } = require('../lib/pegcheck');

async function signalCoinHandler(req, res) {
  const coin = (req.query.coin || '').toUpperCase();
  if (!COINS.includes(coin)) {
    return res.status(400).json({ error: `Unknown coin. Supported: ${COINS.join(', ')}` });
  }
  try {
    const result = await fetchCoin(coin);
    res.json({ fetchedAt: new Date().toISOString(), ...result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch coin signal', detail: err.message });
  }
}

module.exports = signalCoinHandler;
