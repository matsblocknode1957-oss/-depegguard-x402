'use strict';

const COINS = ['USDT', 'USDC', 'DAI', 'FRAX', 'LUSD', 'DOLA', 'PYUSD'];

const PEGCHECK_API = process.env.PEGCHECK_API || 'https://pegcheck.uk/api/depeg-status';

// PegCheck returns consensus_deviation_bps (basis points).
// Thresholds applied to |deviation %|:
//   < 0.5%  → STABLE
//   < 2%    → HEDGE
//   ≥ 2%    → EXIT
function classify(deviationPct) {
  if (deviationPct == null || isNaN(deviationPct)) return 'UNKNOWN';
  const abs = Math.abs(deviationPct);
  if (abs < 0.5) return 'STABLE';
  if (abs < 2)   return 'HEDGE';
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
    const deviationPct = data.consensus_deviation_bps != null
      ? data.consensus_deviation_bps / 100
      : null;
    return {
      symbol,
      signal:       classify(deviationPct),
      price:        data.consensus_price ?? null,
      pegDeviation: deviationPct,
      status:       data.signal ?? null,
      lastUpdated:  data.timestamp ?? new Date().toISOString(),
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
