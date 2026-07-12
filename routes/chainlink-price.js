'use strict';

// Chainlink AggregatorV3 feeds on Ethereum mainnet
// Source: https://docs.chain.link/data-feeds/price-feeds/addresses?network=ethereum
const FEEDS = {
  'ETH/USD':   { address: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419', decimals: 8 },
  'BTC/USD':   { address: '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88b', decimals: 8 },
  'USDC/USD':  { address: '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6', decimals: 8 },
  'USDT/USD':  { address: '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D', decimals: 8 },
  'DAI/USD':   { address: '0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee7', decimals: 8 },
  'FRAX/USD':  { address: '0xB9E1E3A9feFf48998E45Fa90847ed4D467E8BcfD', decimals: 8 },
  'LUSD/USD':  { address: '0x3D7aE7E594f2f2091Ad8798313450130d0Aba3a0', decimals: 8 },
  'LINK/USD':  { address: '0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c', decimals: 8 },
  'AAVE/USD':  { address: '0x547a514d5e3769680Ce22B2361c10Ea13619e8a9', decimals: 8 },
  'CRV/USD':   { address: '0xCd627aA160A6fA45Eb793D19Ef54f5062F20f33', decimals: 8 },
  'MATIC/USD': { address: '0x7bAC85A8a13A4BcD8abb3eB7d6b4d632c4966857', decimals: 8 },
  'SOL/USD':   { address: '0x4ffC43a60e009B551865A93d232E33Fce9f01507', decimals: 8 },
};

const SUPPORTED = Object.keys(FEEDS);

async function chainlinkPriceHandler(req, res) {
  const rawAsset = (req.query.asset || 'ETH').toUpperCase();
  // Accept both 'ETH' and 'ETH/USD'
  const key    = rawAsset.includes('/') ? rawAsset : `${rawAsset}/USD`;
  const feed   = FEEDS[key];

  if (!feed) {
    return res.status(400).json({
      error: `Unsupported asset. Supported: ${SUPPORTED.map((k) => k.replace('/USD', '')).join(', ')}`,
    });
  }

  const rpcUrl = process.env.ETH_RPC_URL || process.env.ALCHEMY_RPC_URL || 'https://ethereum.publicnode.com';

  try {
  const rpcRes = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'eth_call',
      params: [{ to: feed.address, data: '0xfeaf968c' }, 'latest'],
    }),
    signal: AbortSignal.timeout(8_000),
  });

  const json = await rpcRes.json();
  if (!json.result || json.result === '0x') {
    throw new Error(`No data returned from Chainlink feed for ${key}`);
  }

  const hex        = json.result.replace('0x', '');
  const answer     = Number(BigInt('0x' + hex.slice(64, 128))) / (10 ** feed.decimals);
  const updatedAt  = Number(BigInt('0x' + hex.slice(192, 256)));
  const roundId    = BigInt('0x' + hex.slice(0, 64)).toString();
  const staleSecs  = Math.floor(Date.now() / 1000) - updatedAt;

  res.json({
    fetchedAt:  new Date().toISOString(),
    pair:       key,
    price:      Math.round(answer * 1e6) / 1e6,
    decimals:   feed.decimals,
    roundId,
    updatedAt:  new Date(updatedAt * 1000).toISOString(),
    staleSeconds: staleSecs,
    isStale:    staleSecs > 3600, // flag if data older than 1 hour
    feedAddress: feed.address,
      chain:      'ethereum',
      source:     'Chainlink',
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch Chainlink price', detail: err.message });
  }
}

module.exports = chainlinkPriceHandler;
