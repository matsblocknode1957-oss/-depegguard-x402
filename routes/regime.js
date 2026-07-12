'use strict';

const PEGCHECK_REGIME = 'https://pegcheck.uk/api/regime';

const VALID_SYMBOLS = new Set([
  'usdt','usdc','usds','ethena','pyusd','fdusd','rlusd','tusd',
  'frax','gho','crvusd','lusd','usdp','usdd','mkusd','eurc',
  'dola','alusd','bold',
]);

async function regimeHandler(req, res) {
  const symbol = (req.query.symbol || '').toLowerCase();
  if (!symbol) {
    return res.status(400).json({ error: 'Required: ?symbol=USDC' });
  }
  if (!VALID_SYMBOLS.has(symbol)) {
    return res.status(400).json({
      error: `Unknown symbol: ${symbol.toUpperCase()}. Valid: ${[...VALID_SYMBOLS].map(s => s.toUpperCase()).join(', ')}`,
    });
  }

  try {
    const response = await fetch(
      `${PEGCHECK_REGIME}?symbol=${encodeURIComponent(symbol)}`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!response.ok) return res.status(502).json({ error: `PegCheck regime returned ${response.status}` });
    const data = await response.json();

    res.json({
      fetchedAt: new Date().toISOString(),
      symbol:     data.symbol,
      slug:       data.slug,
      layer_a:    data.layer_a,
      layer_b:    data.layer_b,
      confidence: data.confidence,
      timestamp:  data.timestamp,
      features:   data.features,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch regime data', detail: err.message });
  }
}

module.exports = regimeHandler;
