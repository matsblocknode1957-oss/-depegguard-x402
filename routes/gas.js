'use strict';

const NETWORKS = {
  base:     'https://mainnet.base.org',
  ethereum: null, // filled from env at runtime
};

async function fetchGas(networkName, rpcUrl) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'eth_feeHistory',
      params: ['0x1', 'latest', [50]],
    }),
    signal: AbortSignal.timeout(6_000),
  });
  const json = await res.json();
  const fh = json.result;
  if (!fh) return null;

  const baseWei  = BigInt(fh.baseFeePerGas?.[0] ?? '0x0');
  const prioWei  = BigInt(fh.reward?.[0]?.[0]   ?? '0x0');
  const totalWei = baseWei + prioWei;

  const toGwei = (w) => Math.round(Number(w) / 1e9 * 1000) / 1000;

  return {
    network:        networkName,
    baseFeeGwei:    toGwei(baseWei),
    priorityFeeGwei: toGwei(prioWei),
    totalGwei:      toGwei(totalWei),
    // Rough USDC-transfer cost at ETH $3,000 (illustrative)
    estimatedUsdcTransferCostUsd: networkName === 'base'
      ? Math.round(toGwei(totalWei) * 21000 / 1e9 * 3000 * 10000) / 10000
      : Math.round(toGwei(totalWei) * 65000 / 1e9 * 3000 * 1000) / 1000,
  };
}

async function gasHandler(req, res) {
  const ethRpc = process.env.ETH_RPC_URL
    || process.env.ALCHEMY_RPC_URL
    || 'https://ethereum.publicnode.com';

  const [base, ethereum] = await Promise.all([
    fetchGas('base',     NETWORKS.base),
    fetchGas('ethereum', ethRpc),
  ]);

  res.json({
    fetchedAt: new Date().toISOString(),
    networks: [base, ethereum].filter(Boolean),
    note: 'baseFeeGwei + priorityFeeGwei = totalGwei. USD cost estimates assume ETH=$3,000.',
  });
}

module.exports = gasHandler;
