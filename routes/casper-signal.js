const express = require('express');
const router = express.Router();
const { fetchCoin } = require('../lib/pegcheck');

const CASPER_RPC = 'https://node.testnet.casper.network/rpc';
const CASPER_RECIPIENT = 'account-hash-fd5650d31c33ab1a9bfce31b5c18928d8d730ef01a0196583f982599733f57b3';
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
  const execInfo = deployResult.execution_info;

  if (!execInfo) {
    return { valid: false, reason: 'Deploy not yet executed - wait a moment and retry' };
  }

  const v2 = execInfo.execution_result?.Version2;
  if (!v2) {
    return { valid: false, reason: 'Unexpected execution result format' };
  }

  if (v2.error_message !== null && v2.error_message !== undefined) {
    return { valid: false, reason: `Deploy failed on chain: ${v2.error_message}` };
  }

  const transfer = v2.transfers?.[0]?.Version2;
  if (!transfer) {
    return { valid: false, reason: 'Deploy is not a CSPR transfer or transfer record missing' };
  }

  const amount = BigInt(transfer.amount);
  const target = transfer.to; // account hash of recipient

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
