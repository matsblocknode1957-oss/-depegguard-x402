'use strict';

const { COINS, fetchCoin } = require('../lib/pegcheck');

async function signalHandler(req, res) {
  const results = await Promise.all(COINS.map(fetchCoin));

  const signals = results.reduce((acc, r) => {
    acc[r.symbol] = r;
    return acc;
  }, {});

  const toObj = (arr) => Object.fromEntries(arr.map((s, i) => [String(i), s]));
  const summary = {
    EXIT:    toObj(results.filter((r) => r.signal === 'EXIT').map((r) => r.symbol)),
    HEDGE:   toObj(results.filter((r) => r.signal === 'HEDGE').map((r) => r.symbol)),
    STABLE:  toObj(results.filter((r) => r.signal === 'STABLE').map((r) => r.symbol)),
    UNKNOWN: toObj(results.filter((r) => r.signal === 'UNKNOWN').map((r) => r.symbol)),
  };

  res.json({
    fetchedAt: new Date().toISOString(),
    summary,
    signals,
  });
}

module.exports = signalHandler;
