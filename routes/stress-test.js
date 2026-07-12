'use strict';

const SUPPORTED_COINS = ['USDC', 'USDT', 'DAI', 'FRAX', 'LUSD', 'DOLA', 'PYUSD'];

// Historical depeg floors (worst intraday price during the event)
const SCENARIOS = [
  {
    id:          'svb-2023',
    name:        'SVB Collapse (March 2023)',
    description: 'Circle disclosed $3.3B USDC reserves held at SVB; USDC depegged for ~60 hours',
    prices: { USDC: 0.877, USDT: 1.000, DAI: 0.989, FRAX: 0.980, LUSD: 1.000, DOLA: 0.993, PYUSD: 1.000 },
  },
  {
    id:          'usdt-fud-2018',
    name:        'Tether FUD (October 2018)',
    description: 'Tether solvency concerns drove USDT to $0.95 on major exchanges for ~24 hours',
    prices: { USDC: 1.000, USDT: 0.951, DAI: 1.000, FRAX: 1.000, LUSD: 1.000, DOLA: 1.000, PYUSD: 1.000 },
  },
  {
    id:          'ust-contagion-2022',
    name:        'UST/LUNA Collapse (May 2022)',
    description: 'UST collapse caused broad stablecoin contagion; USDT briefly hit $0.997, FRAX hit $0.97',
    prices: { USDC: 0.998, USDT: 0.997, DAI: 0.997, FRAX: 0.970, LUSD: 0.998, DOLA: 0.981, PYUSD: 1.000 },
  },
  {
    id:          'frax-depeg-2022',
    name:        'FRAX Algo Stress (November 2022)',
    description: 'Post-FTX contagion stress tested partially-algorithmic FRAX',
    prices: { USDC: 1.000, USDT: 1.000, DAI: 1.000, FRAX: 0.968, LUSD: 0.999, DOLA: 0.990, PYUSD: 1.000 },
  },
  {
    id:          'black-thursday-2020',
    name:        'Black Thursday (March 2020)',
    description: 'COVID crash caused DAI to trade at a premium ($1.06) as ETH collateral collapsed',
    prices: { USDC: 1.000, USDT: 1.001, DAI: 1.060, FRAX: 1.000, LUSD: 1.000, DOLA: 1.000, PYUSD: 1.000 },
  },
];

function parsePortfolio(raw) {
  if (!raw) return null;
  const portfolio = {};
  for (const part of raw.split(',')) {
    const [coin, amount] = part.trim().split(':');
    const sym = (coin || '').toUpperCase();
    const val = parseFloat(amount);
    if (SUPPORTED_COINS.includes(sym) && isFinite(val) && val > 0) {
      portfolio[sym] = (portfolio[sym] || 0) + val;
    }
  }
  return Object.keys(portfolio).length > 0 ? portfolio : null;
}

function defaultPortfolio(totalUsd) {
  const perCoin = Math.round(totalUsd / SUPPORTED_COINS.length);
  return Object.fromEntries(SUPPORTED_COINS.map((c) => [c, perCoin]));
}

async function stressTestHandler(req, res) {
  const rawPortfolio = req.query.portfolio;
  const totalUsd     = parseFloat(req.query.total) || 10_000;

  const portfolio = parsePortfolio(rawPortfolio) || defaultPortfolio(totalUsd);
  const portfolioValue = Object.values(portfolio).reduce((s, v) => s + v, 0);

  const scenarioResults = SCENARIOS.map((s) => {
    let stressedValue = 0;
    const coinBreakdown = {};
    for (const [coin, usd] of Object.entries(portfolio)) {
      const price    = s.prices[coin] ?? 1.0;
      const stressed = usd * price;
      stressedValue += stressed;
      coinBreakdown[coin] = {
        holdingUsd:    usd,
        stressPrice:   price,
        stressedUsd:   Math.round(stressed * 100) / 100,
        lossUsd:       Math.round((usd - stressed) * 100) / 100,
        lossPct:       Math.round((1 - price) * 10000) / 100,
      };
    }
    const lossUsd = portfolioValue - stressedValue;
    return {
      scenarioId:    s.id,
      name:          s.name,
      description:   s.description,
      portfolioLossUsd:  Math.round(lossUsd * 100) / 100,
      portfolioLossPct:  Math.round((lossUsd / portfolioValue) * 10000) / 100,
      stressedValueUsd:  Math.round(stressedValue * 100) / 100,
      coinBreakdown,
    };
  }).sort((a, b) => b.portfolioLossUsd - a.portfolioLossUsd);

  const worst = scenarioResults[0];

  res.json({
    fetchedAt:        new Date().toISOString(),
    portfolio,
    portfolioValueUsd: portfolioValue,
    worstScenario: {
      name:     worst.name,
      lossUsd:  worst.portfolioLossUsd,
      lossPct:  worst.portfolioLossPct,
    },
    scenarios: Object.fromEntries(scenarioResults.map((s) => [s.scenarioId, s])),
  });
}

module.exports = stressTestHandler;
