'use strict';

// Chainlink Proof of Reserve feeds on Ethereum mainnet
// Source: https://docs.chain.link/data-feeds/proof-of-reserve/addresses
const POR_FEEDS = {
  TUSD: {
    reserves:    '0x478f78a3E3cEf0e0cf7c26f12E6dB4b755f4e2e',  // TUSD Proof of Reserve
    totalSupply: '0x9B22cC2b2A89C1E43fBf3DDcE3B13FCAB0Abbc0', // TUSD Total Supply
    decimals:    18,
  },
  PAXG: {
    reserves:    '0x9B97304EA12EFed0FAd976FBeCAad46016bf269e', // PAXG Proof of Reserve (troy oz × 1e18)
    totalSupply: '0x7BE2B6Cc6CE7EF6700a9B6BaDdAe21A00a573b0e', // PAXG Total Supply
    decimals:    18,
  },
};

const LATEST_ROUND_DATA = '0xfeaf968c'; // latestRoundData() selector

async function readFeed(address, rpcUrl) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'eth_call',
      params: [{ to: address, data: LATEST_ROUND_DATA }, 'latest'],
    }),
    signal: AbortSignal.timeout(8_000),
  });
  const json = await res.json();
  if (!json.result || json.result === '0x') return null;
  // latestRoundData: (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
  const hex = json.result.replace('0x', '');
  const answer = BigInt('0x' + hex.slice(64, 128)); // second word = answer
  const updatedAt = Number(BigInt('0x' + hex.slice(192, 256)));
  return { answer, updatedAt: new Date(updatedAt * 1000).toISOString() };
}

async function porHandler(req, res) {
  const coin = ((req.query.coin || 'TUSD')).toUpperCase();
  const feed = POR_FEEDS[coin];
  if (!feed) {
    return res.status(400).json({
      error: `Unsupported coin. Supported: ${Object.keys(POR_FEEDS).join(', ')}`,
    });
  }

  const rpcUrl = process.env.ETH_RPC_URL || 'https://ethereum.publicnode.com';

  const [reservesData, supplyData] = await Promise.all([
    readFeed(feed.reserves,    rpcUrl),
    readFeed(feed.totalSupply, rpcUrl),
  ]);

  if (!reservesData || !supplyData) {
    throw new Error('Failed to read Chainlink PoR feeds — RPC may be unavailable');
  }

  const divisor = 10n ** BigInt(feed.decimals);
  const reservesNum = Number(reservesData.answer) / Number(divisor);
  const supplyNum   = Number(supplyData.answer)   / Number(divisor);
  const ratio       = supplyNum > 0 ? reservesNum / supplyNum : null;

  res.json({
    fetchedAt:        new Date().toISOString(),
    coin,
    source:           'Chainlink Proof of Reserve',
    chain:            'ethereum',
    reservesUsd:      Math.round(reservesNum),
    totalSupply:      Math.round(supplyNum),
    reserveRatio:     ratio != null ? Math.round(ratio * 10000) / 10000 : null,
    status:           ratio == null ? 'UNKNOWN' : ratio >= 1 ? 'BACKED' : 'UNDERBACKED',
    reservesUpdatedAt: reservesData.updatedAt,
    supplyUpdatedAt:   supplyData.updatedAt,
  });
}

module.exports = porHandler;
