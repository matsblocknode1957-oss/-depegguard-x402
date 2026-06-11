'use strict';

const COINS = ['USDT', 'USDC', 'DAI', 'FRAX', 'LUSD', 'DOLA', 'PYUSD'];

const PEGCHECK_API = process.env.PEGCHECK_API || 'https://pegcheck.uk/api/depeg-status';

/**
 * Derives a HEDGE/EXIT/STABLE signal from a PegCheck API response.
 *
 * PegCheck deviation values are percentages (positive = above peg, negative = below).
 * Thresholds:
 *   |deviation| < 0.5%  → STABLE
 *   0.5% ≤ |dev| < 2%   → HEDGE  (accumulate protection, reduce exposure)
 *   |deviation| ≥ 2%    → EXIT   (de-risk immediately)
 */
function classify(data) {
  const deviation =
    Math.abs(
      data.pegDeviation ??
      data.peg_deviation ??
      data.deviation ??
      (data.price != null ? (data.price - 1) * 100 : null)
    );

  if (deviation == null || isNaN(deviation)) return 'UNKNOWN';
  if (deviation < 0.5) return 'STABLE';
  if (deviation < 2) return 'HEDGE';
  return 'EXIT';
}

async function fetchCoin(symbol) {
  const url = `${PEGCHECK_API}?coin=${symbol}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) {
      return { symbol, signal: 'UNKNOWN', error: `PegCheck returned ${res.status}` };
    }
    const data = await res.json();
    const signal = classify(data);
    return {
      symbol,
      signal,
      price: data.price ?? data.currentPrice ?? null,
      pegDeviation: data.pegDeviation ?? data.peg_deviation ?? data.deviation ?? null,
      status: data.status ?? null,
      lastUpdated: data.lastUpdated ?? data.last_updated ?? new Date().toISOString(),
    };
  } catch (err) {
    return { symbol, signal: 'UNKNOWN', error: err.message };
  }
}

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
