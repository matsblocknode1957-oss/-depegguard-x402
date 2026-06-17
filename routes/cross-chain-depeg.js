'use strict';

// Chainlink AggregatorV3 latestRoundData() selector
const LATEST_ROUND_DATA = '0xfeaf968c';

// Feed addresses per chain per coin
const FEEDS = {
  USDC: {
    ethereum: '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6',
    base:     '0x7e860098F58bBFC8648a4311b374B1D669a2bc9b',
    arbitrum: '0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3',
  },
  USDT: {
    ethereum: '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D',
    base:     '0xf19d560eB8d2ADf07BD6D13ed03e1D11215721F9',
    arbitrum: '0x3f3f5dF88dC9F13eac63DF89EC16ef6e7E25DdE7',
  },
  DAI: {
    ethereum: '0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee7',
    base:     '0x591e79239a7d679378eC8c847e5038150364C78F',
    arbitrum: '0xc5C8E77B397E531B8EC06BFb0048328B30E9eCfB',
  },
};

const SUPPORTED = Object.keys(FEEDS);
const DEVIATION_THRESHOLD = 0.001; // 0.1%

function getRpcUrls() {
  return {
    ethereum: process.env.ETH_RPC_URL || process.env.ALCHEMY_RPC_URL || 'https://ethereum.publicnode.com',
    base:     process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    arbitrum: process.env.ARB_RPC_URL  || 'https://arb1.arbitrum.io/rpc',
  };
}

async function readFeed(feedAddress, rpcUrl) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'eth_call',
      params: [{ to: feedAddress, data: LATEST_ROUND_DATA }, 'latest'],
    }),
    signal: AbortSignal.timeout(8_000),
  });
  const json = await res.json();
  if (!json.result || json.result === '0x') return null;
  const hex = json.result.replace('0x', '');
  // answer is the second 32-byte word; Chainlink USD feeds use 8 decimals
  const answer     = Number(BigInt('0x' + hex.slice(64, 128))) / 1e8;
  const updatedAt  = Number(BigInt('0x' + hex.slice(192, 256)));
  return { price: answer, updatedAt: new Date(updatedAt * 1000).toISOString() };
}

async function crossChainDepegHandler(req, res) {
  const coin = ((req.query.coin || 'USDC')).toUpperCase();
  const feeds = FEEDS[coin];
  if (!feeds) {
    return res.status(400).json({ error: `Unsupported coin. Supported: ${SUPPORTED.join(', ')}` });
  }

  const rpcs = getRpcUrls();

  const [ethereum, base, arbitrum] = await Promise.all([
    readFeed(feeds.ethereum, rpcs.ethereum),
    readFeed(feeds.base,     rpcs.base),
    readFeed(feeds.arbitrum, rpcs.arbitrum),
  ]);

  const readings = { ethereum, base, arbitrum };
  const prices   = Object.values(readings).filter(Boolean).map((r) => r.price);
  const maxPrice = Math.max(...prices);
  const minPrice = Math.min(...prices);
  const maxDeviation = prices.length >= 2 ? (maxPrice - minPrice) / minPrice : null;

  const chains = Object.entries(readings).map(([chain, data]) => ({
    chain,
    price:      data?.price  ?? null,
    updatedAt:  data?.updatedAt ?? null,
    deviation:  data && minPrice > 0
      ? Math.round((data.price - minPrice) / minPrice * 10000) / 10000
      : null,
  }));

  const isDepegged = maxDeviation != null && maxDeviation > DEVIATION_THRESHOLD;

  res.json({
    fetchedAt:    new Date().toISOString(),
    coin,
    status:       isDepegged ? 'DEPEGGED' : 'STABLE',
    maxDeviationPct: maxDeviation != null ? Math.round(maxDeviation * 10000) / 100 : null,
    chains,
    note: 'Prices sourced from Chainlink on-chain feeds per network.',
  });
}

module.exports = crossChainDepegHandler;
