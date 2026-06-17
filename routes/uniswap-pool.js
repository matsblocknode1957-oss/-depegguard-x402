'use strict';

const GRAPH_ENDPOINT = process.env.GRAPH_API_KEY
  ? `https://gateway.thegraph.com/api/${process.env.GRAPH_API_KEY}/subgraphs/id/GqzP4Xaehti8KSfAmLP3nKhRLRiqRkznH1cbSfNtDUEK`
  : 'https://gateway.thegraph.com/api/subgraphs/id/GqzP4Xaehti8KSfAmLP3nKhRLRiqRkznH1cbSfNtDUEK';

const POOL_FIELDS = `
  id
  token0 { symbol decimals }
  token1 { symbol decimals }
  liquidity
  sqrtPrice
  tick
  feeTier
  totalValueLockedUSD
  volumeUSD
  feesUSD
  poolDayData(first: 1, orderBy: date, orderDirection: desc) {
    volumeUSD
    feesUSD
  }
`;

const QUERY_BY_ID = `
  query($id: ID!) {
    pool(id: $id) { ${POOL_FIELDS} }
  }
`;

const QUERY_BY_TOKENS = `
  query($t0: String!, $t1: String!, $fee: BigInt!) {
    pools(
      where: { token0_: { symbol_contains_nocase: $t0 }, token1_: { symbol_contains_nocase: $t1 }, feeTier: $fee }
      first: 1
      orderBy: totalValueLockedUSD
      orderDirection: desc
    ) { ${POOL_FIELDS} }
  }
`;

async function graphql(query, variables) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(GRAPH_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ query, variables }),
      signal:  ctrl.signal,
    });
    if (!res.ok) throw new Error(`Graph HTTP ${res.status}`);
    const json = await res.json();
    if (json.errors?.length) throw new Error(json.errors[0].message);
    return json.data;
  } finally {
    clearTimeout(timer);
  }
}

function normaliseSymbol(s) {
  return s.toUpperCase() === 'ETH' ? 'WETH' : s;
}

function formatPool(p) {
  const day = p.poolDayData?.[0];
  return {
    pool:               p.id,
    token0:             { symbol: p.token0.symbol, decimals: Number(p.token0.decimals) },
    token1:             { symbol: p.token1.symbol, decimals: Number(p.token1.decimals) },
    feeTier:            Number(p.feeTier),
    liquidity:          p.liquidity,
    sqrtPrice:          p.sqrtPrice,
    tick:               Number(p.tick),
    totalValueLockedUSD: Number(p.totalValueLockedUSD),
    volume24hUSD:       day ? Number(day.volumeUSD) : null,
    fees24hUSD:         day ? Number(day.feesUSD)   : null,
    volumeAllTimeUSD:   Number(p.volumeUSD),
  };
}

async function uniswapPoolHandler(req, res) {
  const { pool, token0, token1, fee } = req.query;

  if (!pool && !(token0 && token1 && fee)) {
    return res.status(400).json({
      error: 'Required: ?pool=0x… OR ?token0=USDC&token1=ETH&fee=3000',
    });
  }

  if (pool) {
    const { isAddress } = await import('viem');
    if (!isAddress(pool)) return res.status(400).json({ error: 'Invalid pool address' });

    const data = await graphql(QUERY_BY_ID, { id: pool.toLowerCase() });
    if (!data.pool) return res.status(404).json({ error: `Pool ${pool} not found in subgraph` });

    return res.json({ fetchedAt: new Date().toISOString(), ...formatPool(data.pool) });
  }

  // Token + fee mode
  const feeInt = parseInt(fee, 10);
  if (isNaN(feeInt)) return res.status(400).json({ error: 'fee must be a number (e.g. 500, 3000, 10000)' });

  const t0 = normaliseSymbol(token0);
  const t1 = normaliseSymbol(token1);

  const data = await graphql(QUERY_BY_TOKENS, { t0, t1, fee: String(feeInt) });
  if (!data.pools?.length) {
    return res.status(404).json({ error: `No pool found for ${t0}/${t1} fee=${feeInt}` });
  }

  return res.json({ fetchedAt: new Date().toISOString(), ...formatPool(data.pools[0]) });
}

module.exports = uniswapPoolHandler;
