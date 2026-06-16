'use strict';

const COINS = ['USDT', 'USDC', 'DAI', 'FRAX', 'LUSD', 'DOLA', 'PYUSD'];
const PEGCHECK_API = process.env.PEGCHECK_API || 'https://pegcheck.uk/api/depeg-status';
const PEGCHECK_HISTORY = process.env.PEGCHECK_HISTORY_API
  || PEGCHECK_API.replace('/depeg-status', '/history');

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
    if (!res.ok) return { symbol, signal: 'UNKNOWN', error: `PegCheck returned ${res.status}` };
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

module.exports = { COINS, PEGCHECK_API, PEGCHECK_HISTORY, classify, fetchCoin };
