'use strict';

const { AgentClient, EventType, DeliverableType } = require('@croo-network/sdk');
const { COINS, PEGCHECK_HISTORY, fetchCoin } = require('./lib/pegcheck');

const FINTECHCHECK = process.env.FINTECHCHECK_URL
  || 'https://fintechcheck-production.up.railway.app';

// ── Service ID registry ───────────────────────────────────────────────────────
// These must match the service IDs assigned by the CROO marketplace after
// registration. Override via env vars once your services are live.
const SERVICE_IDS = {
  signal:          process.env.CROO_SVC_SIGNAL           || 'depeg-signal',
  signalCoin:      process.env.CROO_SVC_SIGNAL_COIN      || 'depeg-signal-coin',
  healthIndex:     process.env.CROO_SVC_HEALTH_INDEX     || 'health-index',
  fearGreed:       process.env.CROO_SVC_FEAR_GREED       || 'fear-greed',
  history:         process.env.CROO_SVC_HISTORY          || 'depeg-history',
  whales:          process.env.CROO_SVC_WHALES           || 'whale-transfers',
  collateral:      process.env.CROO_SVC_COLLATERAL       || 'collateral-ratio',
  liquidationRisk: process.env.CROO_SVC_LIQUIDATION_RISK || 'liquidation-risk',
  tvlRisk:         process.env.CROO_SVC_TVL_RISK         || 'tvl-risk',
  correlatedRisk:  process.env.CROO_SVC_CORRELATED_RISK  || 'correlated-risk',
};

// Reverse map: service_id string → handler key
const ID_TO_KEY = Object.fromEntries(
  Object.entries(SERVICE_IDS).map(([k, v]) => [v, k]),
);

// ── Payload builders ──────────────────────────────────────────────────────────

async function buildSignal() {
  const results = await Promise.all(COINS.map(fetchCoin));
  const signals = results.reduce((acc, r) => { acc[r.symbol] = r; return acc; }, {});
  const summary = {
    EXIT:    results.filter((r) => r.signal === 'EXIT').map((r) => r.symbol),
    HEDGE:   results.filter((r) => r.signal === 'HEDGE').map((r) => r.symbol),
    STABLE:  results.filter((r) => r.signal === 'STABLE').map((r) => r.symbol),
    UNKNOWN: results.filter((r) => r.signal === 'UNKNOWN').map((r) => r.symbol),
  };
  return { fetchedAt: new Date().toISOString(), summary, signals };
}

async function buildSignalCoin(opts) {
  const coin = COINS.includes((opts.coin || '').toUpperCase())
    ? opts.coin.toUpperCase()
    : 'USDC';
  const result = await fetchCoin(coin);
  return { fetchedAt: new Date().toISOString(), ...result };
}

const HEALTH_SCORE = { STABLE: 100, HEDGE: 50, UNKNOWN: 25, EXIT: 0 };
function healthGrade(s) {
  return s >= 90 ? 'A' : s >= 75 ? 'B' : s >= 50 ? 'C' : s >= 25 ? 'D' : 'F';
}

async function buildHealthIndex() {
  const results = await Promise.all(COINS.map(fetchCoin));
  const score = Math.round(
    results.reduce((sum, r) => sum + (HEALTH_SCORE[r.signal] ?? 0), 0) / results.length,
  );
  const perCoin = results.reduce((acc, r) => {
    acc[r.symbol] = { signal: r.signal, score: HEALTH_SCORE[r.signal] ?? 0 };
    return acc;
  }, {});
  return { fetchedAt: new Date().toISOString(), healthIndex: score, grade: healthGrade(score), perCoin };
}

async function buildFearGreed() {
  const res = await fetch('https://api.alternative.me/fng/?limit=1', { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`Fear & Greed API returned ${res.status}`);
  const data = await res.json();
  const entry = data.data?.[0];
  if (!entry) throw new Error('No data from Fear & Greed API');
  return {
    fetchedAt: new Date().toISOString(),
    value: parseInt(entry.value, 10),
    classification: entry.value_classification,
    timestamp: new Date(parseInt(entry.timestamp, 10) * 1000).toISOString(),
  };
}

async function buildHistory(opts) {
  const coin = COINS.includes((opts.coin || '').toUpperCase()) ? opts.coin.toUpperCase() : 'USDC';
  const days = Math.min(parseInt(opts.days, 10) || 7, 30);
  const res = await fetch(`${PEGCHECK_HISTORY}?coin=${coin}&days=${days}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`PegCheck history returned ${res.status}`);
  return { fetchedAt: new Date().toISOString(), coin, days, history: await res.json() };
}

async function buildWhales() {
  if (process.env.WHALE_ALERT_KEY) {
    const start = Math.floor(Date.now() / 1000) - 3600;
    const url = `https://api.whale-alert.io/v1/transactions?api_key=${process.env.WHALE_ALERT_KEY}&min_value=1000000&limit=20&start=${start}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`Whale Alert returned ${res.status}`);
    const data = await res.json();
    return {
      fetchedAt: new Date().toISOString(),
      source: 'whale-alert',
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
  const res = await fetch('https://stablecoins.llama.fi/stablecoins?includePrices=true', { signal: AbortSignal.timeout(10_000) });
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
    fetchedAt: new Date().toISOString(),
    source: 'defillama-flows',
    note: 'Set WHALE_ALERT_KEY for individual transfer data.',
    movers,
  };
}

async function buildCollateral(opts) {
  if (!opts.address) throw new Error('address required for collateral service');
  const { createPublicClient, http, isAddress } = await import('viem');
  const { base } = await import('viem/chains');
  if (!isAddress(opts.address)) throw new Error('Invalid EVM address');
  const client = createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org'),
  });
  const ABI = [{ name: 'getUserAccountData', type: 'function', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ name: 'totalCollateralBase', type: 'uint256' }, { name: 'totalDebtBase', type: 'uint256' }, { name: 'availableBorrowsBase', type: 'uint256' }, { name: 'currentLiquidationThreshold', type: 'uint256' }, { name: 'ltv', type: 'uint256' }, { name: 'healthFactor', type: 'uint256' }] }];
  const [col, debt, borrows, liqThresh, ltv, hf] = await client.readContract({
    address: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
    abi: ABI,
    functionName: 'getUserAccountData',
    args: [opts.address],
  });
  const hfNum = Number(hf) / 1e18;
  return {
    fetchedAt: new Date().toISOString(), protocol: 'aave-v3', chain: 'base', address: opts.address,
    collateralUsd: Number(col) / 1e8, debtUsd: Number(debt) / 1e8,
    availableBorrowsUsd: Number(borrows) / 1e8, liquidationThresholdPct: Number(liqThresh) / 100,
    ltvPct: Number(ltv) / 100, healthFactor: hfNum,
    riskLevel: hfNum >= 2 ? 'SAFE' : hfNum >= 1.5 ? 'MODERATE' : hfNum >= 1.1 ? 'ELEVATED' : hfNum > 1 ? 'CRITICAL' : 'LIQUIDATABLE',
  };
}

async function buildLiquidationRisk(opts) {
  const protocol = (opts.protocol || 'aave-v3').toLowerCase();
  const [riskRes, tvlRes] = await Promise.all([
    fetch(`${FINTECHCHECK}/api/risk`, { signal: AbortSignal.timeout(8_000) }),
    fetch(`https://api.llama.fi/tvl/${protocol}`, { signal: AbortSignal.timeout(8_000) }),
  ]);
  if (!riskRes.ok) throw new Error(`FintechCheck returned ${riskRes.status}`);
  const risk = await riskRes.json();
  const tvlUsd = tvlRes.ok ? await tvlRes.json() : null;
  const s = risk.liquidationStress ?? 0;
  return {
    fetchedAt: new Date().toISOString(), protocol,
    liquidationStress: s,
    riskLevel: s >= 75 ? 'CRITICAL' : s >= 50 ? 'HIGH' : s >= 25 ? 'MODERATE' : 'LOW',
    pegStress: risk.pegStress ?? null, composite: risk.composite ?? null,
    tvlUsd: typeof tvlUsd === 'number' ? tvlUsd : null,
  };
}

async function buildTvlRisk(opts) {
  const protocol = (opts.protocol || 'aave-v3').toLowerCase();
  const [tvlRes, protocolRes] = await Promise.all([
    fetch(`https://api.llama.fi/tvl/${protocol}`, { signal: AbortSignal.timeout(8_000) }),
    fetch(`https://api.llama.fi/protocol/${protocol}`, { signal: AbortSignal.timeout(10_000) }),
  ]);
  if (!protocolRes.ok) throw new Error(`DeFi Llama returned ${protocolRes.status}`);
  const tvlNow = tvlRes.ok ? await tvlRes.json() : null;
  const pd = await protocolRes.json();
  const hist = pd.tvl || [];
  const l = hist[hist.length - 1], y = hist[hist.length - 2];
  const change24hPct = l?.totalLiquidityUSD && y?.totalLiquidityUSD
    ? ((l.totalLiquidityUSD - y.totalLiquidityUSD) / y.totalLiquidityUSD) * 100 : null;
  const chains = Object.entries(pd.currentChainTvls || {}).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([chain, tvlUsd]) => ({ chain, tvlUsd }));
  return {
    fetchedAt: new Date().toISOString(), protocol: pd.name || protocol,
    tvlUsd: typeof tvlNow === 'number' ? tvlNow : null,
    change24hPct: change24hPct != null ? Math.round(change24hPct * 100) / 100 : null,
    chainBreakdown: chains,
  };
}

async function buildCorrelatedRisk() {
  const res = await fetch(`${FINTECHCHECK}/api/risk`, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`FintechCheck returned ${res.status}`);
  const data = await res.json();
  const c = data.composite ?? 0;
  return {
    fetchedAt: new Date().toISOString(), composite: c, corrScore: data.corrScore,
    riskLevel: c >= 75 ? 'CRITICAL' : c >= 50 ? 'HIGH' : c >= 25 ? 'MODERATE' : 'LOW',
    correlatedCoins: data.correlatedCoins || [], pegStress: data.pegStress,
    liquidationStress: data.liquidationStress, flowPressure: data.flowPressure,
    perCoin: data.perCoin || {}, dataTimestamp: new Date(data.timestamp).toISOString(),
  };
}

// Dispatch table: handler key → builder
const BUILDERS = {
  signal:          (_opts) => buildSignal(),
  signalCoin:      (opts)  => buildSignalCoin(opts),
  healthIndex:     (_opts) => buildHealthIndex(),
  fearGreed:       (_opts) => buildFearGreed(),
  history:         (opts)  => buildHistory(opts),
  whales:          (_opts) => buildWhales(),
  collateral:      (opts)  => buildCollateral(opts),
  liquidationRisk: (opts)  => buildLiquidationRisk(opts),
  tvlRisk:         (opts)  => buildTvlRisk(opts),
  correlatedRisk:  (_opts) => buildCorrelatedRisk(),
};

// Services that read parameters from negotiation.requirements JSON
const PARAMETERIZED = new Set(['signalCoin', 'history', 'collateral', 'liquidationRisk', 'tvlRisk']);

function parseRequirements(str) {
  if (!str) return {};
  try { return JSON.parse(str); } catch { return {}; }
}

// ── Provider lifecycle ────────────────────────────────────────────────────────

async function init() {
  if (!process.env.CROO_SDK_KEY) {
    console.warn('[croo] CROO_SDK_KEY not set — provider disabled');
    return;
  }

  const client = new AgentClient(
    {
      baseURL: process.env.CROO_API_URL,
      wsURL:   process.env.CROO_WS_URL,
      rpcURL:  process.env.BASE_RPC_URL,
    },
    process.env.CROO_SDK_KEY,
  );

  const stream = await client.connectWebSocket();
  console.log('[croo] provider connected, waiting for orders…');

  stream.on(EventType.NegotiationCreated, async (e) => {
    const key = ID_TO_KEY[e.service_id];
    if (!key) {
      console.warn(`[croo] negotiation ${e.negotiation_id} — unknown service_id "${e.service_id}", rejecting`);
      try { await client.rejectNegotiation(e.negotiation_id, 'Service not offered'); } catch {}
      return;
    }
    console.log(`[croo] negotiation ${e.negotiation_id} (${e.service_id}) — accepting`);
    try {
      const result = await client.acceptNegotiation(e.negotiation_id);
      console.log(`[croo] order created ${result.order.orderId}`);
    } catch (err) {
      console.error('[croo] accept failed:', err.message);
    }
  });

  stream.on(EventType.OrderPaid, async (e) => {
    const key = ID_TO_KEY[e.service_id];
    if (!key) {
      console.warn(`[croo] order ${e.order_id} — unknown service_id "${e.service_id}", skipping`);
      return;
    }
    console.log(`[croo] order ${e.order_id} (${e.service_id}) paid — building payload`);
    try {
      let opts = {};
      if (PARAMETERIZED.has(key)) {
        const order = await client.getOrder(e.order_id);
        const negotiation = await client.getNegotiation(order.negotiationId);
        opts = parseRequirements(negotiation.requirements);
      }
      const payload = await BUILDERS[key](opts);
      const result = await client.deliverOrder(e.order_id, {
        deliverableType: DeliverableType.Schema,
        deliverableText: JSON.stringify(payload),
      });
      console.log(`[croo] order ${e.order_id} delivered, tx: ${result.txHash}`);
    } catch (err) {
      console.error(`[croo] order ${e.order_id} delivery failed:`, err.message);
    }
  });

  stream.onAny((e) => {
    if (e.type !== EventType.NegotiationCreated && e.type !== EventType.OrderPaid) {
      console.log(`[croo] event ${e.type}`, e.order_id ?? e.negotiation_id ?? '');
    }
  });

  return stream;
}

module.exports = { init };
