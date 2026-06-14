# DepegGuard x402

Stablecoin depeg signal API gated by **x402 V2** micropayments on Base mainnet.  
$0.001 USDC per call. Covers USDT, USDC, DAI, FRAX, LUSD, DOLA, PYUSD.

Payment verification is handled by [`@piprail/sdk`](https://www.npmjs.com/package/@piprail/sdk) — no external facilitator, verified directly on-chain via a Base RPC you control.

---

## Live Deployment

**Production URL:** `https://depegguard-x402-production.up.railway.app`

**Payment settlement wallet:** `0xcBB1AD132bB51Cc41210309d6e3bd45598eebb5e`

### Live curl examples

```bash
# Discover service info (free)
curl https://depegguard-x402-production.up.railway.app/

# Discover catalog and pricing (free)
curl https://depegguard-x402-production.up.railway.app/api/catalog

# Trigger 402 Payment Required
curl -i https://depegguard-x402-production.up.railway.app/api/signal

# Inspect the x402 challenge body
curl -s https://depegguard-x402-production.up.railway.app/api/signal | jq .

# Call /api/signal with a piprail payment proof
curl -i https://depegguard-x402-production.up.railway.app/api/signal \
  -H "payment-signature: $SIGNED_PAYMENT"
```

---

## Quick start

```bash
cp .env.example .env
# Set RECIPIENT_ADDRESS and BASE_RPC_URL in .env
npm install
npm start
# → http://localhost:3001
```

---

## Endpoints

| Method | Path | Auth | Price |
|--------|------|------|-------|
| GET | `/` | free | — |
| GET | `/api/catalog` | free | — |
| GET | `/api/signal` | x402 V2 | $0.001 USDC |

---

## x402 V2 payment flow

The server uses the **`onchain-proof`** scheme: the client pays on-chain first, then presents the transaction hash as proof. No EIP-3009 signatures, no external facilitator.

```
Client                              Server
  │                                   │
  │  GET /api/signal                  │
  │ ─────────────────────────────────►│
  │                                   │
  │  402 + x402 challenge (JSON body) │
  │◄──────────────────────────────────│
  │                                   │
  │  (send 0.001 USDC on-chain        │
  │   to payTo address on Base)       │
  │                                   │
  │  GET /api/signal                  │
  │  payment-signature: <proof>       │
  │ ─────────────────────────────────►│
  │                                   │
  │  (server queries Base RPC,        │
  │   verifies tx: recipient,         │
  │   token, amount, confirmations)   │
  │                                   │
  │  200 OK                           │
  │  payment-response: <receipt>      │
  │◄──────────────────────────────────│
```

### 402 challenge body

```json
{
  "x402Version": 2,
  "resource": {
    "url": "https://depegguard-x402-production.up.railway.app/api/signal",
    "description": "PegCheck depeg signal — USDT, USDC, DAI, FRAX, LUSD, DOLA, PYUSD"
  },
  "accepts": [
    {
      "scheme": "onchain-proof",
      "network": "eip155:8453",
      "asset": "0x833589fCD6eDb6E08f4c7C32C4f2e608d57336B3",
      "amount": "1000",
      "payTo": "0xcBB1AD132bB51Cc41210309d6e3bd45598eebb5e",
      "maxTimeoutSeconds": 600,
      "extra": {
        "decimals": 6,
        "symbol": "USDC",
        "amountFormatted": "0.001",
        "minConfirmations": 1
      }
    }
  ]
}
```

---

## curl examples

### 1 — Discover service info (free)

```bash
curl http://localhost:3001/
```

### 2 — Discover catalog and pricing (free)

```bash
curl http://localhost:3001/api/catalog
```

### 3 — Call /api/signal without payment → 402

```bash
curl -i http://localhost:3001/api/signal
```

Expected:

```
HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "x402Version": 2,
  "resource": { "url": "...", "description": "..." },
  "accepts": [{ "scheme": "onchain-proof", "network": "eip155:8453", ... }]
}
```

### 4 — Call /api/signal with a piprail payment proof

Use `PipRailClient` from `@piprail/sdk` — it handles the on-chain transfer and proof construction automatically:

```js
import { PipRailClient } from '@piprail/sdk';

const client = new PipRailClient({
  chain: 'base',
  wallet: { privateKey: process.env.AGENT_KEY },
  rpcUrl: process.env.BASE_RPC_URL,
});

const res = await client.fetch('http://localhost:3001/api/signal');
const data = await res.json();
```

Or with a raw curl (proof is a base64-encoded JSON containing the tx hash):

```bash
curl -i http://localhost:3001/api/signal \
  -H "payment-signature: $PIPRAIL_PROOF"
```

Expected response on success:

```
HTTP/1.1 200 OK
payment-response: <base64 receipt>
Content-Type: application/json

{
  "fetchedAt": "2025-01-15T12:00:00.000Z",
  "summary": {
    "EXIT":    [],
    "HEDGE":   ["FRAX"],
    "STABLE":  ["USDT", "USDC", "DAI", "LUSD", "DOLA", "PYUSD"],
    "UNKNOWN": []
  },
  "signals": {
    "USDT":  { "symbol": "USDT",  "signal": "STABLE", "price": 1.0001, "pegDeviation": 0.01 },
    "USDC":  { "symbol": "USDC",  "signal": "STABLE", "price": 1.0000, "pegDeviation": 0.00 },
    "DAI":   { "symbol": "DAI",   "signal": "STABLE", "price": 0.9998, "pegDeviation": 0.02 },
    "FRAX":  { "symbol": "FRAX",  "signal": "HEDGE",  "price": 0.9942, "pegDeviation": 0.58 },
    "LUSD":  { "symbol": "LUSD",  "signal": "STABLE", "price": 1.0003, "pegDeviation": 0.03 },
    "DOLA":  { "symbol": "DOLA",  "signal": "STABLE", "price": 0.9997, "pegDeviation": 0.03 },
    "PYUSD": { "symbol": "PYUSD", "signal": "STABLE", "price": 1.0001, "pegDeviation": 0.01 }
  }
}
```

---

## Signal classification

| Signal | Condition | Recommended action |
|--------|-----------|-------------------|
| `STABLE` | \|deviation\| < 0.5% | No action needed |
| `HEDGE` | 0.5% ≤ \|deviation\| < 2% | Reduce exposure, add hedges |
| `EXIT` | \|deviation\| ≥ 2% | De-risk immediately |
| `UNKNOWN` | PegCheck unreachable | Treat as elevated risk |

---

## Configuration

Copy `.env.example` to `.env` and adjust:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP listen port |
| `RECIPIENT_ADDRESS` | `0xcBB1...` | USDC recipient on Base |
| `USDC_CONTRACT` | `0x8335...C4f2e...` | USDC contract on Base mainnet |
| `BASE_RPC_URL` | — | Base mainnet RPC (Alchemy, QuickNode, etc.) — required |
| `SERVER_URL` | `http://localhost:3001` | Public URL of this server |
| `PEGCHECK_API` | `https://pegcheck.uk/api/depeg-status` | PegCheck API base URL |

`BASE_RPC_URL` is the only required addition vs a stock Express setup. Piprail queries it directly to verify each payment transaction.

---

## Client SDKs

- **JS/TS (recommended)**: [`@piprail/sdk`](https://www.npmjs.com/package/@piprail/sdk) — `PipRailClient` handles the full onchain-proof flow
- **twak MCP**: `mcp__twak__x402_request` handles payment automatically for agent use cases

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     server.js (Express)                      │
│                                                              │
│  GET /             → routes/info.js        (free)           │
│  GET /api/catalog  → routes/catalog.js     (free)           │
│  GET /api/signal   → requirePayment()      (@piprail/sdk)   │
│                       └→ routes/signal.js  (paid, $0.001)   │
│                                                              │
│  requirePayment() — onchain-proof scheme                     │
│    1. No payment-signature → 402 + x402 challenge           │
│    2. Proof present → query Base RPC, verify tx             │
│       (recipient, USDC token, amount, confirmations)        │
│    3. Verified → set payment-response header, call next()   │
│                                                              │
│  routes/signal.js                                            │
│    Promise.all → PegCheck API × 7 coins                     │
│    classify() → STABLE / HEDGE / EXIT per coin              │
└─────────────────────────────────────────────────────────────┘
```
