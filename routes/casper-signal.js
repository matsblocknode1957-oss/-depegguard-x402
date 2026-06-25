const express = require('express');
const router = express.Router();
const { fetchCoin } = require('../lib/pegcheck');

const CASPER_RPC = 'https://node.testnet.casper.network/rpc';
const CASPER_RECIPIENT = 'account-hash-fd5650d31c33ab1a9bfce31b5c18928d8d730ef01a0196583f982599733f57b3';
const MIN_MOTES = BigInt('2500000000'); // 2.5 CSPR minimum
const USED_HASHES = new Set(); // replay protection (in-memory, fine for hackathon)

async function rpc(method, params) {
  const res = await fetch(CASPER_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

function getCasperDeploy(deployHash) {
  return rpc('info_get_deploy', { deploy_hash: deployHash, finalized_approvals: false });
}

function getCasperTransaction(txHash) {
  return rpc('info_get_transaction', {
    transaction_hash: { Version1: txHash },
    finalized_approvals: false
  });
}

function extractTransferDetails(result) {
  const execInfo = result.execution_info;

  if (!execInfo) {
    return { valid: false, reason: 'Transaction not yet executed — wait a moment and retry' };
  }

  const v2 = execInfo.execution_result?.Version2;
  if (!v2) {
    return { valid: false, reason: 'Unexpected execution result format' };
  }

  if (v2.error_message !== null && v2.error_message !== undefined) {
    return { valid: false, reason: `Transaction failed on chain: ${v2.error_message}` };
  }

  const transfer = v2.transfers?.[0]?.Version2;
  if (!transfer) {
    return { valid: false, reason: 'Transaction is not a CSPR transfer or transfer record missing' };
  }

  return { valid: true, amount: BigInt(transfer.amount), target: transfer.to };
}

// GET /casper/signal?deploy_hash=<hash>&coin=USDC      (Casper v1 deploy)
// GET /casper/signal?transaction_hash=<hash>&coin=USDC (Casper v2 transaction)
router.get('/signal', async (req, res) => {
  const { deploy_hash, transaction_hash, coin } = req.query;
  const hash = transaction_hash || deploy_hash;
  const isV2 = !!transaction_hash;

  if (!hash) {
    return res.status(400).json({ error: 'deploy_hash or transaction_hash query param required' });
  }

  if (USED_HASHES.has(hash)) {
    return res.status(402).json({ error: 'Hash already used' });
  }

  try {
    const result = isV2
      ? await getCasperTransaction(hash)
      : await getCasperDeploy(hash);

    const { valid, reason, amount, target } = extractTransferDetails(result);

    if (!valid) {
      return res.status(402).json({ error: reason });
    }

    if (target && target !== CASPER_RECIPIENT) {
      return res.status(402).json({
        error: `Payment must be sent to ${CASPER_RECIPIENT}`,
        got: target
      });
    }

    if (amount < MIN_MOTES) {
      return res.status(402).json({
        error: 'Minimum payment is 2.5 CSPR (2500000000 motes)',
        got: amount.toString()
      });
    }

    USED_HASHES.add(hash);

    const targetCoin = (coin || 'USDC').toUpperCase();
    const signalData = await fetchCoin(targetCoin);
    const hashKey = isV2 ? 'transaction_hash' : 'deploy_hash';

    return res.json({
      paid: true,
      payment: {
        chain: 'casper-test',
        [hashKey]: hash,
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
    usage: {
      v1_deploy: '/casper/signal?deploy_hash=YOUR_HASH&coin=USDC',
      v2_transaction: '/casper/signal?transaction_hash=YOUR_HASH&coin=USDC'
    },
    supported_coins: ['USDC', 'USDT', 'DAI', 'FRAX', 'LUSD', 'alUSD', 'DOLA'],
    rpc_node: CASPER_RPC
  });
});

module.exports = router;
