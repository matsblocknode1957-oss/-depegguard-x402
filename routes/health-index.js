'use strict';

const { COINS, fetchCoin } = require('../lib/pegcheck');

const SCORE = { STABLE: 100, HEDGE: 50, UNKNOWN: 25, EXIT: 0 };

function grade(score) {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 50) return 'C';
  if (score >= 25) return 'D';
  return 'F';
}

function interpret(score) {
  if (score >= 90) return 'All stablecoins healthy';
  if (score >= 75) return 'Minor stress detected';
  if (score >= 50) return 'Moderate risk — monitor closely';
  if (score >= 25) return 'Elevated risk — reduce exposure';
  return 'Critical — multiple depegs detected';
}

async function healthIndexHandler(req, res) {
  try {
    const results = await Promise.all(COINS.map(fetchCoin));
    const total = results.reduce((sum, r) => sum + (SCORE[r.signal] ?? 0), 0);
    const score = Math.round(total / results.length);
    const perCoin = results.reduce((acc, r) => {
      acc[r.symbol] = { signal: r.signal, score: SCORE[r.signal] ?? 0, pegDeviation: r.pegDeviation };
      return acc;
    }, {});
    res.json({
      fetchedAt: new Date().toISOString(),
      healthIndex: score,
      grade: grade(score),
      interpretation: interpret(score),
      perCoin,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to compute health index', detail: err.message });
  }
}

module.exports = healthIndexHandler;
