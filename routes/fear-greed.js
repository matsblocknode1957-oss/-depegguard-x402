'use strict';

const FNG_URL = 'https://api.alternative.me/fng/?limit=1';

function interpret(value) {
  if (value <= 20) return 'Extreme Fear';
  if (value <= 40) return 'Fear';
  if (value <= 60) return 'Neutral';
  if (value <= 80) return 'Greed';
  return 'Extreme Greed';
}

async function fearGreedHandler(req, res) {
  try {
    const response = await fetch(FNG_URL, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return res.status(502).json({ error: `Fear & Greed API returned ${response.status}` });
    const data = await response.json();
    const entry = data.data?.[0];
    if (!entry) return res.status(502).json({ error: 'No data from Fear & Greed API' });
    const value = parseInt(entry.value, 10);
    res.json({
      fetchedAt: new Date().toISOString(),
      value,
      classification: entry.value_classification || interpret(value),
      timestamp: new Date(parseInt(entry.timestamp, 10) * 1000).toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch fear & greed data', detail: err.message });
  }
}

module.exports = fearGreedHandler;
