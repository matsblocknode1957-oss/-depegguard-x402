'use strict';

const { COINS, fetchCoin } = require('../lib/pegcheck');

async function signalHandler(req, res) {
  const results = await Promise.all(COINS.map(fetchCoin));

  const signals = results.reduce((acc, r) => {
    acc[r.symbol] = r;
    return acc;
  }, {});

  const summary = {
    EXIT: results.filter((r) => r.signal === 'EXIT').map((r) => r.symbol),
    HEDGE: results.filter((r) => r.signal === 'HEDGE').map((r) => r.symbol),
    STABLE: results.filter((r) => r.signal === 'STABLE').map((r) => r.symbol),
    UNKNOWN: results.filter((r) => r.signal === 'UNKNOWN').map((r) => r.symbol),
  };

  res.json({
    fetchedAt: new Date().toISOString(),
    summary,
    signals,
  });
}

module.exports = signalHandler;
