'use strict';

async function dominanceHandler(req, res) {
  const [stableRes, globalRes] = await Promise.all([
    fetch('https://stablecoins.llama.fi/stablecoins?includePrices=true', { signal: AbortSignal.timeout(10_000) }),
    fetch('https://api.coingecko.com/api/v3/global', { signal: AbortSignal.timeout(8_000) }),
  ]);

  if (!stableRes.ok) throw new Error(`DeFi Llama stablecoins returned ${stableRes.status}`);
  if (!globalRes.ok) throw new Error(`CoinGecko global returned ${globalRes.status}`);

  const [stableData, globalData] = await Promise.all([stableRes.json(), globalRes.json()]);

  const assets = stableData.peggedAssets || [];
  const totalStablecoinUsd = assets.reduce((sum, a) => sum + (a.circulating?.peggedUSD ?? 0), 0);
  const totalCryptoUsd     = globalData.data?.total_market_cap?.usd ?? null;
  const dominancePct = totalCryptoUsd ? Math.round((totalStablecoinUsd / totalCryptoUsd) * 10000) / 100 : null;

  const top10 = assets
    .map((a) => ({
      symbol:        a.symbol,
      marketCapUsd:  Math.round(a.circulating?.peggedUSD ?? 0),
      sharePct:      totalStablecoinUsd
        ? Math.round((a.circulating?.peggedUSD ?? 0) / totalStablecoinUsd * 10000) / 100
        : null,
    }))
    .sort((a, b) => b.marketCapUsd - a.marketCapUsd)
    .slice(0, 10);

  // Simple trend: compare to previous day supply if available
  const prev = assets.reduce((sum, a) => sum + (a.circulatingPrevDay?.peggedUSD ?? a.circulating?.peggedUSD ?? 0), 0);
  const change24hUsd  = totalStablecoinUsd - prev;
  const change24hPct  = prev > 0 ? Math.round((change24hUsd / prev) * 10000) / 100 : null;

  res.json({
    fetchedAt:             new Date().toISOString(),
    stablecoinMarketCapUsd: Math.round(totalStablecoinUsd),
    totalCryptoMarketCapUsd: totalCryptoUsd ? Math.round(totalCryptoUsd) : null,
    dominancePct,
    change24hUsd:          Math.round(change24hUsd),
    change24hPct,
    trend:                 change24hUsd > 0 ? 'EXPANDING' : change24hUsd < 0 ? 'CONTRACTING' : 'STABLE',
    topStablecoins:        Object.fromEntries(top10.map((c) => [c.symbol, c])),
  });
}

module.exports = dominanceHandler;
