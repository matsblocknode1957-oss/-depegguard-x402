'use strict';

const { AgentClient, EventType, DeliverableType } = require('@croo-network/sdk');

// ── PegCheck logic (mirrors routes/signal.js, no Express dependency) ─────────

const COINS = ['USDT', 'USDC', 'DAI', 'FRAX', 'LUSD', 'DOLA', 'PYUSD'];
const PEGCHECK_API = process.env.PEGCHECK_API || 'https://pegcheck.uk/api/depeg-status';

function classify(deviationPct) {
  if (deviationPct == null || isNaN(deviationPct)) return 'UNKNOWN';
  const abs = Math.abs(deviationPct);
  if (abs < 0.5) return 'STABLE';
  if (abs < 2)   return 'HEDGE';
  return 'EXIT';
}

async function fetchCoin(symbol) {
  const url = `${PEGCHECK_API}?coin=${symbol}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) {
      return { symbol, signal: 'UNKNOWN', error: `PegCheck returned ${res.status}` };
    }
    const data = await res.json();
    const deviationPct = data.consensus_deviation_bps != null
      ? data.consensus_deviation_bps / 100
      : null;
    return {
      symbol,
      signal:       classify(deviationPct),
      price:        data.consensus_price ?? null,
      pegDeviation: deviationPct,
      status:       data.signal ?? null,
      lastUpdated:  data.timestamp ?? new Date().toISOString(),
    };
  } catch (err) {
    return { symbol, signal: 'UNKNOWN', error: err.message };
  }
}

async function buildPayload() {
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

// ── CROO provider ─────────────────────────────────────────────────────────────

async function init() {
  if (!process.env.CROO_SDK_KEY) {
    console.warn('[croo] CROO_SDK_KEY not set — provider disabled');
    return;
  }

  const client = new AgentClient(
    {
      baseURL: process.env.CROO_API_URL,
      wsURL:   process.env.CROO_WS_URL,
      rpcURL:  process.env.BASE_RPC_URL,  // optional; defaults to Base mainnet
    },
    process.env.CROO_SDK_KEY,
  );

  const stream = await client.connectWebSocket();
  console.log('[croo] provider connected, waiting for orders…');

  stream.on(EventType.NegotiationCreated, async (e) => {
    console.log(`[croo] negotiation ${e.negotiation_id} — accepting`);
    try {
      const result = await client.acceptNegotiation(e.negotiation_id);
      console.log(`[croo] order created ${result.order.orderId}`);
    } catch (err) {
      console.error('[croo] accept failed:', err.message);
    }
  });

  stream.on(EventType.OrderPaid, async (e) => {
    console.log(`[croo] order ${e.order_id} paid — fetching PegCheck`);
    try {
      const payload = await buildPayload();
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
