'use strict';

const { AgentClient, EventType, DeliverableType } = require('@croo-network/sdk');
const { COINS, PEGCHECK_HISTORY, fetchCoin } = require('./lib/pegcheck');

const FINTECHCHECK = process.env.FINTECHCHECK_URL
  || 'https://fintechcheck-production.up.railway.app';

// ── Service ID → handler key ──────────────────────────────────────────────────
const ID_TO_KEY = {
  '54931089-096a-43b1-812a-ebdc412c58d1': 'signal',
  '187217b4-1a33-414d-bfd9-e70ec3eafebb': 'signalCoin',
  '7c96a4e6-958e-49ad-a0b6-e70acd7de1a9': 'healthIndex',
  '738491a2-1220-4168-81fe-656d2ecf4f22': 'fearGreed',
  'd835c881-be15-4993-b961-67efd099e538': 'history',
  'd3d424de-c590-4316-8eb4-d9eb1fa1678d': 'whales',
  'fe8670f6-608a-4e29-9de9-5f2af2b8c913': 'collateral',
  'ef1da897-7208-4fe6-bb9a-8beaa9ad0ad6': 'liquidationRisk',
  'e02583e5-01ca-43b7-bf88-b4071368ee0d': 'tvlRisk',
  '5b38507a-df2c-45d1-b436-9a7d7dde586c': 'correlatedRisk',
  // ── new services — replace placeholders with CROO marketplace UUIDs once registered ──
  'CROO_UUID_YIELD':          'yield',
  'CROO_UUID_EDGAR':          'edgar',
  'CROO_UUID_MACRO':          'macro',
  'CROO_UUID_PROOF_OF_RESERVE': 'proofOfReserve',
  'CROO_UUID_STRESS_TEST':    'stressTest',
  'CROO_UUID_WALLET_MONITOR': 'walletMonitor',
  'CROO_UUID_GAS':            'gas',
  'CROO_UUID_DOMINANCE':      'dominance',
  'CROO_UUID_PROTOCOL_RISK':  'protocolRisk',
};

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

// ── New service builders (delegate to route handlers via shared logic) ────────

async function buildYield() {
  const res = await fetch('https://yields.llama.fi/pools', { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`DeFi Llama yields returned ${res.status}`);
  const { data: pools } = await res.json();
  const TARGET = new Set(['aave-v3', 'compound-v3', 'curve-dex', 'curve']);
  const SYMS   = new Set(['USDC', 'USDT', 'DAI', 'FRAX', 'LUSD', 'PYUSD', 'USDP', 'TUSD', 'GUSD', 'USDS']);
  const filtered = pools
    .filter((p) => p.stablecoin === true && TARGET.has(p.project))
    .filter((p) => [...SYMS].some((s) => (p.symbol || '').toUpperCase().includes(s)))
    .map((p) => ({ project: p.project, chain: p.chain, symbol: p.symbol, apy: Math.round((p.apy ?? 0) * 100) / 100, tvlUsd: Math.round(p.tvlUsd ?? 0) }))
    .sort((a, b) => b.apy - a.apy);
  const best = {};
  for (const p of filtered) if (!best[p.project]) best[p.project] = p;
  return { fetchedAt: new Date().toISOString(), topYield: filtered[0] ?? null, bestByProject: best, allPools: filtered.slice(0, 30) };
}

async function buildEdgar() {
  const SEC_UA = 'DepegGuard/1.0 contact@depegguard.com';
  const queries = ['"Circle Internet" stablecoin', '"Paxos Trust" stablecoin', 'stablecoin "proof of reserve"'];
  const results = await Promise.all(queries.map(async (q) => {
    const params = new URLSearchParams({ q, forms: '8-K,S-1,10-K', dateRange: 'custom', startdt: '2024-01-01', hits: '5' });
    const r = await fetch(`https://efts.sec.gov/LATEST/search-index?${params}`, { headers: { 'User-Agent': SEC_UA, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.hits?.hits ?? []).map((h) => ({ filedAt: h._source?.file_date ?? null, formType: h._source?.form_type ?? null, company: (h._source?.display_names ?? []).join(', ') || null, description: h._source?.file_description ?? null }));
  }));
  const seen = new Set();
  const filings = results.flat().filter((f) => { const k = `${f.company}|${f.filedAt}|${f.formType}`; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => (b.filedAt ?? '').localeCompare(a.filedAt ?? '')).slice(0, 20);
  return { fetchedAt: new Date().toISOString(), source: 'SEC EDGAR', count: filings.length, filings };
}

async function buildMacro() {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) throw new Error('FRED_API_KEY not configured');
  const SERIES = { federalFundsRate: 'FEDFUNDS', cpi: 'CPIAUCSL', treasury2y: 'DGS2', sofr: 'SOFR', m2: 'M2SL' };
  const fetchS = async (id) => {
    const p = new URLSearchParams({ series_id: id, api_key: apiKey, file_type: 'json', limit: '1', sort_order: 'desc' });
    const r = await fetch(`https://api.stlouisfed.org/fred/series/observations?${p}`, { signal: AbortSignal.timeout(8_000) });
    if (!r.ok) return null;
    const d = await r.json();
    const o = d.observations?.[0];
    return o && o.value !== '.' ? { value: parseFloat(o.value), date: o.date } : null;
  };
  const [ffr, cpi, t2y, sofr, m2] = await Promise.all(Object.values(SERIES).map(fetchS));
  const rate = ffr?.value ?? 0;
  const ctx = rate >= 5 ? { riskLevel: 'ELEVATED', note: 'High rates compress stablecoin on-chain yield incentives' }
    : rate >= 3 ? { riskLevel: 'MODERATE', note: 'Moderate rates — Treasury competition elevated' }
    : { riskLevel: 'LOW', note: 'Low rate environment favourable for stablecoin on-chain yield' };
  return { fetchedAt: new Date().toISOString(), indicators: { federalFundsRate: ffr, cpi, treasury2y: t2y, sofr, m2SlnUsd: m2 ? { value: m2.value * 1e9, date: m2.date } : null }, stablecoinContext: ctx };
}

async function buildProofOfReserve(opts) {
  const POR = {
    TUSD: { reserves: '0x478f78a3E3cEf0e0cf7c26f12E6dB4b755f4e2e', totalSupply: '0x9B22cC2b2A89C1E43fBf3DDcE3B13FCAB0Abbc0', decimals: 18 },
    PAXG: { reserves: '0x9B97304EA12EFed0FAd976FBeCAad46016bf269e', totalSupply: '0x7BE2B6Cc6CE7EF6700a9B6BaDdAe21A00a573b0e', decimals: 18 },
  };
  const coin = ((opts.coin || 'TUSD')).toUpperCase();
  const feed = POR[coin];
  if (!feed) throw new Error(`Unsupported coin: ${coin}`);
  const rpcUrl = process.env.ETH_RPC_URL || 'https://ethereum.publicnode.com';
  const readFeed = async (addr) => {
    const r = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: addr, data: '0xfeaf968c' }, 'latest'] }), signal: AbortSignal.timeout(8_000) });
    const j = await r.json();
    if (!j.result || j.result === '0x') return null;
    const hex = j.result.replace('0x', '');
    return { answer: BigInt('0x' + hex.slice(64, 128)), updatedAt: new Date(Number(BigInt('0x' + hex.slice(192, 256))) * 1000).toISOString() };
  };
  const [rv, sv] = await Promise.all([readFeed(feed.reserves), readFeed(feed.totalSupply)]);
  if (!rv || !sv) throw new Error('Failed to read Chainlink PoR feeds');
  const d = 10n ** BigInt(feed.decimals);
  const res = Number(rv.answer) / Number(d), sup = Number(sv.answer) / Number(d);
  const ratio = sup > 0 ? Math.round((res / sup) * 10000) / 10000 : null;
  return { fetchedAt: new Date().toISOString(), coin, source: 'Chainlink Proof of Reserve', chain: 'ethereum', reservesUsd: Math.round(res), totalSupply: Math.round(sup), reserveRatio: ratio, status: ratio == null ? 'UNKNOWN' : ratio >= 1 ? 'BACKED' : 'UNDERBACKED' };
}

async function buildStressTest(opts) {
  const SCENARIOS = [
    { id: 'svb-2023', name: 'SVB Collapse (March 2023)', description: 'Circle disclosed $3.3B USDC reserves at SVB; USDC depegged for ~60 hours', prices: { USDC: 0.877, USDT: 1.000, DAI: 0.989, FRAX: 0.980, LUSD: 1.000, DOLA: 0.993, PYUSD: 1.000 } },
    { id: 'usdt-fud-2018', name: 'Tether FUD (October 2018)', description: 'Tether solvency concerns drove USDT to $0.95 for ~24 hours', prices: { USDC: 1.000, USDT: 0.951, DAI: 1.000, FRAX: 1.000, LUSD: 1.000, DOLA: 1.000, PYUSD: 1.000 } },
    { id: 'ust-contagion-2022', name: 'UST/LUNA Collapse (May 2022)', description: 'UST collapse caused broad stablecoin contagion', prices: { USDC: 0.998, USDT: 0.997, DAI: 0.997, FRAX: 0.970, LUSD: 0.998, DOLA: 0.981, PYUSD: 1.000 } },
    { id: 'frax-depeg-2022', name: 'FRAX Algo Stress (November 2022)', description: 'Post-FTX contagion stress tested partially-algorithmic FRAX', prices: { USDC: 1.000, USDT: 1.000, DAI: 1.000, FRAX: 0.968, LUSD: 0.999, DOLA: 0.990, PYUSD: 1.000 } },
    { id: 'black-thursday-2020', name: 'Black Thursday (March 2020)', description: 'COVID crash caused DAI to trade at a premium as ETH collateral collapsed', prices: { USDC: 1.000, USDT: 1.001, DAI: 1.060, FRAX: 1.000, LUSD: 1.000, DOLA: 1.000, PYUSD: 1.000 } },
  ];
  const SUPPORTED = ['USDC', 'USDT', 'DAI', 'FRAX', 'LUSD', 'DOLA', 'PYUSD'];
  let portfolio = {};
  if (opts.portfolio) {
    for (const part of opts.portfolio.split(',')) {
      const [coin, amount] = part.trim().split(':');
      const sym = (coin || '').toUpperCase(), val = parseFloat(amount);
      if (SUPPORTED.includes(sym) && isFinite(val) && val > 0) portfolio[sym] = (portfolio[sym] || 0) + val;
    }
  }
  if (Object.keys(portfolio).length === 0) {
    const perCoin = Math.round((parseFloat(opts.total) || 10000) / SUPPORTED.length);
    portfolio = Object.fromEntries(SUPPORTED.map((c) => [c, perCoin]));
  }
  const pv = Object.values(portfolio).reduce((s, v) => s + v, 0);
  const scenarios = SCENARIOS.map((s) => {
    let sv = 0; const cb = {};
    for (const [c, u] of Object.entries(portfolio)) { const p = s.prices[c] ?? 1; const st = u * p; sv += st; cb[c] = { holdingUsd: u, stressPrice: p, stressedUsd: Math.round(st * 100) / 100, lossUsd: Math.round((u - st) * 100) / 100, lossPct: Math.round((1 - p) * 10000) / 100 }; }
    return { scenarioId: s.id, name: s.name, description: s.description, portfolioLossUsd: Math.round((pv - sv) * 100) / 100, portfolioLossPct: Math.round(((pv - sv) / pv) * 10000) / 100, stressedValueUsd: Math.round(sv * 100) / 100, coinBreakdown: cb };
  }).sort((a, b) => b.portfolioLossUsd - a.portfolioLossUsd);
  const worst = scenarios[0];
  return { fetchedAt: new Date().toISOString(), portfolio, portfolioValueUsd: pv, worstScenario: { name: worst.name, lossUsd: worst.portfolioLossUsd, lossPct: worst.portfolioLossPct }, scenarios };
}

async function buildWalletMonitor(opts) {
  if (!opts.address) throw new Error('address required for wallet-monitor service');
  const { isAddress } = await import('viem');
  if (!isAddress(opts.address)) throw new Error('Invalid EVM address');
  // Delegate to the route handler logic (inline to avoid circular require)
  const mod = require('./routes/wallet-monitor');
  // Create a mock req/res to capture the JSON output
  let payload;
  await mod({ query: opts }, { json: (d) => { payload = d; }, status: () => ({ json: () => {} }) });
  return payload;
}

async function buildGas() {
  const ethRpc = process.env.ETH_RPC_URL || process.env.ALCHEMY_RPC_URL || 'https://ethereum.publicnode.com';
  const fetchG = async (network, rpcUrl) => {
    const r = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_feeHistory', params: ['0x1', 'latest', [50]] }), signal: AbortSignal.timeout(6_000) });
    const j = await r.json();
    const fh = j.result; if (!fh) return null;
    const base = BigInt(fh.baseFeePerGas?.[0] ?? '0x0'), prio = BigInt(fh.reward?.[0]?.[0] ?? '0x0');
    const toGwei = (w) => Math.round(Number(w) / 1e9 * 1000) / 1000;
    return { network, baseFeeGwei: toGwei(base), priorityFeeGwei: toGwei(prio), totalGwei: toGwei(base + prio) };
  };
  const [base, eth] = await Promise.all([fetchG('base', 'https://mainnet.base.org'), fetchG('ethereum', ethRpc)]);
  return { fetchedAt: new Date().toISOString(), networks: [base, eth].filter(Boolean), note: 'USD cost estimates assume ETH=$3,000.' };
}

async function buildDominance() {
  const [sr, gr] = await Promise.all([
    fetch('https://stablecoins.llama.fi/stablecoins?includePrices=true', { signal: AbortSignal.timeout(10_000) }),
    fetch('https://api.coingecko.com/api/v3/global', { signal: AbortSignal.timeout(8_000) }),
  ]);
  if (!sr.ok || !gr.ok) throw new Error('Upstream API error');
  const [sd, gd] = await Promise.all([sr.json(), gr.json()]);
  const assets = sd.peggedAssets || [];
  const totalStable = assets.reduce((s, a) => s + (a.circulating?.peggedUSD ?? 0), 0);
  const totalCrypto = gd.data?.total_market_cap?.usd ?? null;
  const top10 = assets.map((a) => ({ symbol: a.symbol, marketCapUsd: Math.round(a.circulating?.peggedUSD ?? 0), sharePct: totalStable ? Math.round((a.circulating?.peggedUSD ?? 0) / totalStable * 10000) / 100 : null })).sort((a, b) => b.marketCapUsd - a.marketCapUsd).slice(0, 10);
  const prev = assets.reduce((s, a) => s + (a.circulatingPrevDay?.peggedUSD ?? a.circulating?.peggedUSD ?? 0), 0);
  const chg = totalStable - prev;
  return { fetchedAt: new Date().toISOString(), stablecoinMarketCapUsd: Math.round(totalStable), totalCryptoMarketCapUsd: totalCrypto ? Math.round(totalCrypto) : null, dominancePct: totalCrypto ? Math.round((totalStable / totalCrypto) * 10000) / 100 : null, change24hUsd: Math.round(chg), change24hPct: prev > 0 ? Math.round((chg / prev) * 10000) / 100 : null, trend: chg > 0 ? 'EXPANDING' : chg < 0 ? 'CONTRACTING' : 'STABLE', topStablecoins: top10 };
}

async function buildProtocolRisk(opts) {
  const protocol = (opts.protocol || 'aave-v3').toLowerCase();
  const [tvlRes, protoRes, ftRes, pegResults] = await Promise.all([
    fetch(`https://api.llama.fi/tvl/${protocol}`, { signal: AbortSignal.timeout(8_000) }),
    fetch(`https://api.llama.fi/protocol/${protocol}`, { signal: AbortSignal.timeout(10_000) }),
    fetch(`${FINTECHCHECK}/api/risk`, { signal: AbortSignal.timeout(8_000) }),
    Promise.all(COINS.slice(0, 4).map(fetchCoin)),
  ]);
  if (!protoRes.ok) throw new Error(`DeFi Llama returned ${protoRes.status}`);
  if (!ftRes.ok)    throw new Error(`FintechCheck returned ${ftRes.status}`);
  const tvlNow = tvlRes.ok ? await tvlRes.json() : null;
  const pd = await protoRes.json(), ft = await ftRes.json();
  const hist = pd.tvl || [], lat = hist[hist.length - 1], yest = hist[hist.length - 2];
  const chg24 = lat?.totalLiquidityUSD && yest?.totalLiquidityUSD ? ((lat.totalLiquidityUSD - yest.totalLiquidityUSD) / yest.totalLiquidityUSD) * 100 : 0;
  const tvlScore = Math.min(100, Math.abs(chg24) * 3);
  const liq = ft.liquidationStress ?? 0, peg = ft.pegStress ?? 0;
  const exit = pegResults.filter((r) => r.signal === 'EXIT').length, hedge = pegResults.filter((r) => r.signal === 'HEDGE').length;
  const depeg = Math.min(100, exit * 25 + hedge * 10);
  const composite = Math.round(tvlScore * 0.25 + liq * 0.35 + peg * 0.25 + depeg * 0.15);
  const grade = composite <= 10 ? 'A+' : composite <= 20 ? 'A' : composite <= 35 ? 'B' : composite <= 50 ? 'C' : composite <= 65 ? 'D' : 'F';
  const rl = composite >= 75 ? 'CRITICAL' : composite >= 50 ? 'HIGH' : composite >= 25 ? 'MODERATE' : 'LOW';
  return { fetchedAt: new Date().toISOString(), protocol: pd.name || protocol, riskScore: composite, riskLevel: rl, grade, components: { tvlRisk: { score: Math.round(tvlScore), weight: '25%', tvlUsd: typeof tvlNow === 'number' ? tvlNow : null, change24hPct: Math.round(chg24 * 100) / 100 }, liquidationStress: { score: liq, weight: '35%' }, pegStress: { score: peg, weight: '25%' }, depegSignals: { score: depeg, weight: '15%', exitCoins: pegResults.filter((r) => r.signal === 'EXIT').map((r) => r.symbol), hedgeCoins: pegResults.filter((r) => r.signal === 'HEDGE').map((r) => r.symbol) } } };
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
  yield:           (_opts) => buildYield(),
  edgar:           (_opts) => buildEdgar(),
  macro:           (_opts) => buildMacro(),
  proofOfReserve:  (opts)  => buildProofOfReserve(opts),
  stressTest:      (opts)  => buildStressTest(opts),
  walletMonitor:   (opts)  => buildWalletMonitor(opts),
  gas:             (_opts) => buildGas(),
  dominance:       (_opts) => buildDominance(),
  protocolRisk:    (opts)  => buildProtocolRisk(opts),
};

// Services that read parameters from negotiation.requirements JSON
const PARAMETERIZED = new Set([
  'signalCoin', 'history', 'collateral', 'liquidationRisk', 'tvlRisk',
  'proofOfReserve', 'stressTest', 'walletMonitor', 'protocolRisk',
]);

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
