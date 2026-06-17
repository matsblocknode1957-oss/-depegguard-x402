'use strict';

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';

const SERIES = {
  federalFundsRate: 'FEDFUNDS',
  cpi:              'CPIAUCSL',
  treasury2y:       'DGS2',
  sofr:             'SOFR',
  m2:               'M2SL',
};

async function fetchSeries(id, apiKey) {
  const params = new URLSearchParams({
    series_id:  id,
    api_key:    apiKey,
    file_type:  'json',
    limit:      '1',
    sort_order: 'desc',
  });
  const res = await fetch(`${FRED_BASE}?${params}`, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`FRED returned ${res.status} for ${id}`);
  const data = await res.json();
  const obs = data.observations?.[0];
  if (!obs || obs.value === '.') return null;
  return { value: parseFloat(obs.value), date: obs.date };
}

function stablecoinContext(ffr, cpi, t2y) {
  const rate = ffr?.value ?? 0;
  if (rate >= 5)   return { riskLevel: 'ELEVATED', note: 'High rates increase stablecoin redemption pressure and reduce on-chain yield incentives' };
  if (rate >= 3)   return { riskLevel: 'MODERATE', note: 'Moderate rates — stablecoin demand stable but Treasury competition elevated' };
  if (t2y?.value >= 4) return { riskLevel: 'MODERATE', note: 'Elevated 2yr yields compress stablecoin protocol yields' };
  return { riskLevel: 'LOW', note: 'Low rate environment favourable for stablecoin on-chain yield' };
}

async function macroHandler(req, res) {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) throw new Error('FRED_API_KEY not configured');

  const [ffr, cpi, t2y, sofr, m2] = await Promise.all([
    fetchSeries(SERIES.federalFundsRate, apiKey),
    fetchSeries(SERIES.cpi,             apiKey),
    fetchSeries(SERIES.treasury2y,      apiKey),
    fetchSeries(SERIES.sofr,            apiKey),
    fetchSeries(SERIES.m2,              apiKey),
  ]);

  res.json({
    fetchedAt: new Date().toISOString(),
    indicators: {
      federalFundsRate: ffr,
      cpi,
      treasury2y:  t2y,
      sofr,
      m2SlnUsd: m2 ? { value: m2.value * 1e9, date: m2.date } : null,
    },
    stablecoinContext: stablecoinContext(ffr, cpi, t2y),
  });
}

module.exports = macroHandler;
