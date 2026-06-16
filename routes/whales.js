'use strict';

async function fetchWhaleAlertTransfers() {
  const start = Math.floor(Date.now() / 1000) - 3600;
  const url = `https://api.whale-alert.io/v1/transactions?api_key=${process.env.WHALE_ALERT_KEY}&min_value=1000000&limit=20&start=${start}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`Whale Alert returned ${res.status}`);
  const data = await res.json();
  return {
    source: 'whale-alert',
    windowHours: 1,
    minValueUsd: 1_000_000,
    transfers: (data.transactions || []).map((tx) => ({
      blockchain: tx.blockchain,
      from: tx.from?.address || tx.from?.owner_type || 'unknown',
      to: tx.to?.address || tx.to?.owner_type || 'unknown',
      amountUsd: tx.amount_usd,
      symbol: tx.symbol?.toUpperCase(),
      timestamp: new Date(tx.timestamp * 1000).toISOString(),
      txHash: tx.hash,
    })),
  };
}

async function fetchLlamaFlows() {
  const res = await fetch(
    'https://stablecoins.llama.fi/stablecoins?includePrices=true',
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) throw new Error(`DeFi Llama returned ${res.status}`);
  const data = await res.json();
  const movers = (data.peggedAssets || [])
    .filter((s) => (s.circulating?.peggedUSD ?? 0) > 500_000_000)
    .map((s) => {
      const now = s.circulating?.peggedUSD ?? 0;
      const prev = s.circulatingPrevDay?.peggedUSD ?? now;
      return { symbol: s.symbol, circulatingUsd: now, change24hUsd: now - prev };
    })
    .sort((a, b) => Math.abs(b.change24hUsd) - Math.abs(a.change24hUsd))
    .slice(0, 10);
  return {
    source: 'defillama-flows',
    note: 'Aggregate 24h circulating supply changes. Set WHALE_ALERT_KEY env var for individual transfer data.',
    movers,
  };
}

async function whalesHandler(req, res) {
  const data = process.env.WHALE_ALERT_KEY
    ? await fetchWhaleAlertTransfers()
    : await fetchLlamaFlows();
  res.json({ fetchedAt: new Date().toISOString(), ...data });
}

module.exports = whalesHandler;
