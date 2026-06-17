'use strict';

const TARGET_PROJECTS = new Set(['aave-v3', 'compound-v3', 'curve-dex', 'curve']);
const STABLECOIN_SYMBOLS = new Set(['USDC', 'USDT', 'DAI', 'FRAX', 'LUSD', 'PYUSD', 'USDP', 'TUSD', 'GUSD', 'USDS']);

function normalize(project) {
  if (project === 'curve') return 'curve-dex';
  return project;
}

async function yieldHandler(req, res) {
  const response = await fetch('https://yields.llama.fi/pools', {
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`DeFi Llama yields returned ${response.status}`);

  const { data: pools } = await response.json();

  const filtered = pools
    .filter((p) => p.stablecoin === true && TARGET_PROJECTS.has(p.project))
    .filter((p) => {
      const sym = (p.symbol || '').toUpperCase();
      return [...STABLECOIN_SYMBOLS].some((s) => sym.includes(s));
    })
    .map((p) => ({
      project:    normalize(p.project),
      chain:      p.chain,
      symbol:     p.symbol,
      apy:        Math.round((p.apy ?? 0) * 100) / 100,
      apyBase:    Math.round((p.apyBase ?? 0) * 100) / 100,
      apyReward:  Math.round((p.apyReward ?? 0) * 100) / 100,
      tvlUsd:     Math.round(p.tvlUsd ?? 0),
    }))
    .sort((a, b) => b.apy - a.apy);

  // Best per project
  const best = {};
  for (const p of filtered) {
    if (!best[p.project]) best[p.project] = p;
  }

  res.json({
    fetchedAt:   new Date().toISOString(),
    topYield:    filtered[0] ?? null,
    bestByProject: best,
    allPools:    filtered.slice(0, 30),
  });
}

module.exports = yieldHandler;
