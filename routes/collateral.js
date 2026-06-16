'use strict';

// Aave V3 Pool on Base mainnet
const AAVE_V3_POOL_BASE = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';

const GET_USER_ACCOUNT_DATA_ABI = [{
  name: 'getUserAccountData',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'user', type: 'address' }],
  outputs: [
    { name: 'totalCollateralBase', type: 'uint256' },
    { name: 'totalDebtBase', type: 'uint256' },
    { name: 'availableBorrowsBase', type: 'uint256' },
    { name: 'currentLiquidationThreshold', type: 'uint256' },
    { name: 'ltv', type: 'uint256' },
    { name: 'healthFactor', type: 'uint256' },
  ],
}];

function riskLevel(hf) {
  if (hf >= 2)   return 'SAFE';
  if (hf >= 1.5) return 'MODERATE';
  if (hf >= 1.1) return 'ELEVATED';
  if (hf > 1)    return 'CRITICAL';
  return 'LIQUIDATABLE';
}

async function collateralHandler(req, res) {
  const { address, protocol = 'aave' } = req.query;

  if (!address) {
    return res.status(400).json({ error: 'Required: ?address=0x… (EVM wallet address)' });
  }
  if (protocol.toLowerCase() !== 'aave') {
    return res.status(400).json({ error: 'Currently only protocol=aave is supported' });
  }

  // Dynamic import so viem ESM works from this CJS module
  const { createPublicClient, http, isAddress } = await import('viem');
  const { base } = await import('viem/chains');

  if (!isAddress(address)) {
    return res.status(400).json({ error: 'Invalid EVM address' });
  }

  const client = createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org'),
  });

  const [col, debt, borrows, liqThresh, ltv, hf] = await client.readContract({
    address: AAVE_V3_POOL_BASE,
    abi: GET_USER_ACCOUNT_DATA_ABI,
    functionName: 'getUserAccountData',
    args: [address],
  });

  const hfNum = Number(hf) / 1e18;

  res.json({
    fetchedAt: new Date().toISOString(),
    protocol: 'aave-v3',
    chain: 'base',
    address,
    collateralUsd:            Number(col)       / 1e8,
    debtUsd:                  Number(debt)      / 1e8,
    availableBorrowsUsd:      Number(borrows)   / 1e8,
    liquidationThresholdPct:  Number(liqThresh) / 100,
    ltvPct:                   Number(ltv)       / 100,
    healthFactor:             hfNum,
    riskLevel:                riskLevel(hfNum),
  });
}

module.exports = collateralHandler;
