'use strict';

const MAX_ADDRESSES = 5;

// Call an existing route handler with a mock req/res, capture JSON output
function callRoute(handler, query) {
  return new Promise((resolve, reject) => {
    handler(
      { query },
      {
        json:   (data) => resolve(data),
        status: (code) => ({ json: (data) => reject(new Error(`Route ${code}: ${JSON.stringify(data)}`)) }),
      },
    );
  });
}

// Lazy-load handlers to avoid circular require at module load time
function handlers() {
  return {
    walletMonitor:   require('./wallet-monitor'),
    liquidationPrice: require('./liquidation-price'),
    correlatedRisk:  require('./correlated-risk'),
    fearGreed:       require('./fear-greed'),
    healthIndex:     require('./health-index'),
    crossChainDepeg: require('./cross-chain-depeg'),
    whales:          require('./whales'),
  };
}

function riskLevel(score) {
  if (score >= 75) return 'CRITICAL';
  if (score >= 50) return 'HIGH';
  if (score >= 25) return 'MODERATE';
  return 'LOW';
}

// Convert health factor to a 0–100 risk contribution (lower HF = higher risk)
function hfToRisk(hf) {
  if (!hf || !isFinite(hf)) return 0;
  if (hf <= 1.0) return 100;
  if (hf <= 1.1) return 90;
  if (hf <= 1.2) return 75;
  if (hf <= 1.5) return 50;
  if (hf <= 2.0) return 25;
  return 10;
}

async function portfolioReportHandler(req, res) {
  const raw = (req.query.addresses || '').split(',').map((a) => a.trim()).filter(Boolean);
  if (raw.length === 0) {
    return res.status(400).json({ error: 'Required: ?addresses=0x…,0x… (comma-separated, up to 5)' });
  }

  const { isAddress } = await import('viem');
  const addresses = raw.slice(0, MAX_ADDRESSES).filter((a) => isAddress(a));
  if (addresses.length === 0) {
    return res.status(400).json({ error: 'No valid EVM addresses provided' });
  }

  const h = handlers();

  // Run all fetches in parallel: per-address + system-wide
  const [walletResults, liqResults, systemResults] = await Promise.all([
    // Per-address wallet positions
    Promise.all(addresses.map((address) =>
      callRoute(h.walletMonitor, { address }).catch((err) => ({ address, error: err.message, positions: [] }))
    )),
    // Per-address liquidation prices
    Promise.all(addresses.map((address) =>
      callRoute(h.liquidationPrice, { address }).catch((err) => ({ address, error: err.message, positions: [] }))
    )),
    // System-wide signals
    Promise.allSettled([
      callRoute(h.correlatedRisk,  {}),
      callRoute(h.fearGreed,       {}),
      callRoute(h.healthIndex,     {}),
      callRoute(h.crossChainDepeg, { coin: 'USDC' }),
      callRoute(h.whales,          {}),
    ]),
  ]);

  const [corrResult, fngResult, hiResult, ccdResult, whaleResult] = systemResults.map(
    (r) => (r.status === 'fulfilled' ? r.value : null),
  );

  // Build per-wallet summaries
  const wallets = addresses.map((address, i) => {
    const monitor = walletResults[i];
    const liq     = liqResults[i];
    const worstHF = monitor.worstHealthFactor ?? null;
    const positionRisk = hfToRisk(worstHF);

    // Extract liquidation prices keyed by protocol
    const liquidationPrices = {};
    for (const p of (liq.positions || [])) {
      if (p.liquidationPriceUsd) liquidationPrices[p.protocol] = p.liquidationPriceUsd;
    }

    return {
      address,
      overallRisk:        monitor.overallRisk ?? 'NO_POSITIONS',
      worstHealthFactor:  worstHF,
      positionRiskScore:  positionRisk,
      liquidationPrices,
      mostAtRisk:         liq.mostAtRisk ?? null,
      positions:          monitor.positions ?? [],
      error:              monitor.error ?? liq.error ?? null,
    };
  });

  // System-wide risk components
  const correlatedScore = corrResult?.composite       ?? 0;
  const fearGreedVal    = fngResult?.value            ?? 50;
  const healthIndexVal  = hiResult?.healthIndex       ?? 50;
  const crossChainDev   = ccdResult?.status           ?? 'UNKNOWN';
  const whaleCount      = (whaleResult?.transfers || whaleResult?.movers || []).length;

  const fearRisk   = fearGreedVal < 25 ? 80 : fearGreedVal < 40 ? 50 : fearGreedVal < 60 ? 20 : 0;
  const healthRisk = Math.max(0, 100 - healthIndexVal);
  const crossRisk  = crossChainDev === 'DEPEGGED' ? 100
    : ccdResult?.maxDeviationPct ? Math.min(100, ccdResult.maxDeviationPct * 200) : 0;
  const whaleRisk  = whaleCount > 10 ? 80 : whaleCount > 5 ? 40 : whaleCount > 0 ? 20 : 0;
  const systemScore = Math.round(
    correlatedScore * 0.40 +
    healthRisk      * 0.20 +
    fearRisk        * 0.20 +
    crossRisk       * 0.10 +
    whaleRisk       * 0.10,
  );

  // Portfolio composite: average per-wallet position risk (50%) + system risk (50%)
  const avgPositionRisk = wallets.length > 0
    ? Math.round(wallets.reduce((s, w) => s + w.positionRiskScore, 0) / wallets.length)
    : 0;
  const portfolioScore = Math.round(avgPositionRisk * 0.50 + systemScore * 0.50);

  const worstWallet = wallets.reduce(
    (worst, w) => (w.positionRiskScore > (worst?.positionRiskScore ?? -1) ? w : worst),
    null,
  );

  res.json({
    fetchedAt:           new Date().toISOString(),
    portfolioRiskScore:  portfolioScore,
    riskLevel:           riskLevel(portfolioScore),
    walletsChecked:      wallets.length,
    worstAddress:        worstWallet?.address ?? null,
    wallets,
    systemRisk: {
      score:              systemScore,
      correlatedRisk:     correlatedScore,
      fearGreedValue:     fearGreedVal,
      healthIndex:        healthIndexVal,
      crossChainDeviation: crossChainDev,
      whaleTransferCount: whaleCount,
    },
  });
}

module.exports = portfolioReportHandler;
