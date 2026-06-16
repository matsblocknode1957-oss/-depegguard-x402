'use strict';

const { COINS, fetchCoin } = require('../lib/pegcheck');

async function signalCoinHandler(req, res) {
  const coin = (req.query.coin || '').toUpperCase();
  if (!COINS.includes(coin)) {
    return res.status(400).json({ error: `Unknown coin. Supported: ${COINS.join(', ')}` });
  }
  const result = await fetchCoin(coin);
  res.json({ fetchedAt: new Date().toISOString(), ...result });
}

module.exports = signalCoinHandler;
