const express = require('express');
const router = express.Router();
const { fetchCoin } = require('../lib/pegcheck');

const CASPER_RPC = 'https://node.testnet.casper.network/rpc';
const CASPER_RECIPIENT = '0116ef6d6c6e8e11611b2c0019cb11fc937808842153313079c61a741a99918b9e';
const MIN_MOTES = BigInt('2500000000'); // 2.5 CSPR minimum
const USED_DEPLOYS = new Set(); // replay protection (in-memory, fine for hackathon)

async function getCasperDeploy(deployHash) {
  const res = await fetch(CASPER_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'info_get_deploy',
      params: { deploy_hash: deployHash, finalized_approvals: false }
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

function extractTransferDetails(deployResult) {
  const deploy = deployResult.deploy;
  const execResults = deployResult.execution_results;

  // Must have execution results and be successful
  if (!execResults || execResults.length === 0) {
    return { valid: false, reason: 'Deploy not yet executed - wait a moment and retry' };
  }

  const result = execResults[0].result;
  if (result.Failure) {
    return { valid: false, reason: `Deploy failed on chain: ${result.Failure.error_message}` };
  }

  // Extract transfer session args
  const session = deploy.session;
  if (!session.Transfer) {
    return { valid: false, reason: 'Deploy is not a CSPR transfer' };
  }

  const args = session.Transfer.args;
  let amount = null;
  let target = null;

  for (const [key, val] of args) {
    if (key === 'amount') amount = BigInt(val.parsed);
    if (key === 'target') target = val.parsed;
  }

  // Also check execution transfers for the actual recipient
  const transfers = result.Success?.effect?.transforms || [];

  return { valid: true, amount, target };
}

// GET /casper/signal?deploy_hash=abc123&coin=USDC
router.get('/signal', async (req, res) => {
  const { deploy_hash, coin } = req.query;

  if (!deploy_hash) {
    return res.status(400).json({ error: 'deploy_hash query param required' });
  }

  // Replay protection
  if (USED_DEPLOYS.has(deploy_hash)) {
    return res.status(402).json({ error: 'Deploy hash already used' });
  }

  try {
    const deployResult = await getCasperDeploy(deploy_hash);
    console.log('[casper-signal] deployResult:', JSON.stringify(deployResult, null, 2));
    const { valid, reason, amount, target } = extractTransferDetails(deployResult);

    if (!valid) {
      return res.status(402).json({ error: reason });
    }

    // Verify target is our address
    if (target && target !== CASPER_RECIPIENT) {
      return res.status(402).json({
        error: `Payment must be sent to ${CASPER_RECIPIENT}`,
        got: target
      });
    }

    // Verify amount
    if (amount < MIN_MOTES) {
      return res.status(402).json({
        error: `Minimum payment is 2.5 CSPR (2500000000 motes)`,
        got: amount.toString()
      });
    }

    // Mark as used
    USED_DEPLOYS.add(deploy_hash);

    const targetCoin = (coin || 'USDC').toUpperCase();
    const signalData = await fetchCoin(targetCoin);

    return res.json({
      paid: true,
      payment: {
        chain: 'casper-test',
        deploy_hash,
        amount_motes: amount.toString(),
        amount_cspr: (Number(amount) / 1_000_000_000).toFixed(4),
        recipient: CASPER_RECIPIENT
      },
      signal: signalData,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('[casper-signal]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /casper/info — tells callers how to pay
router.get('/info', (req, res) => {
  res.json({
    description: 'DepegGuard CSPR-paid signal endpoint',
    chain: 'casper-test',
    recipient: CASPER_RECIPIENT,
    min_payment_cspr: 2.5,
    min_payment_motes: '2500000000',
    usage: 'Send CSPR transfer to recipient, then call /casper/signal?deploy_hash=YOUR_HASH&coin=USDC',
    supported_coins: ['USDC', 'USDT', 'DAI', 'FRAX', 'LUSD', 'alUSD', 'DOLA'],
    rpc_node: CASPER_RPC
  });
});

module.exports = router;
