# DepegGuard x402

Stablecoin depeg signal API gated by **x402 V2** micropayments on Base mainnet.  
$0.001 USDC per call. Covers USDT, USDC, DAI, FRAX, LUSD, DOLA, PYUSD.

---

## Live Deployment

**Production URL:** `https://depegguard-x402-production.up.railway.app`

Deployed on Base mainnet. Validated on [Agentic.Market](https://agentic.market/validate) — all checks pass, x402 V2 compliant with Bazaar schema extension.

**Payment settlement wallet:** `0xcBB1AD132bB51Cc41210309d6e3bd45598eebb5e`

> **Note on facilitators:** The public `x402.org` facilitator only supports testnets (Base Sepolia `eip155:84532`). For real mainnet settlement, a self-hosted facilitator (`@x402/evm/exact/facilitator`) pointed at Base mainnet is required. This deployment uses such a facilitator.

### Live curl examples

```bash
# Discover service info (free)
curl https://depegguard-x402-production.up.railway.app/

# Discover catalog and pricing (free)
curl https://depegguard-x402-production.up.railway.app/api/catalog

# Trigger 402 Payment Required
curl -i https://depegguard-x402-production.up.railway.app/api/signal

# Inspect the PAYMENT-REQUIRED header
PAYMENT_REQUIRED=$(curl -si https://depegguard-x402-production.up.railway.app/api/signal \
  | grep -i '^payment-required:' \
  | awk '{print $2}' \
  | tr -d '\r')

echo "$PAYMENT_REQUIRED" | base64 -d | python3 -m json.tool

# Call /api/signal with a signed payment
curl -i https://depegguard-x402-production.up.railway.app/api/signal \
  -H "payment-signature: $SIGNED_PAYMENT"
```

---

## Quick start

```bash
cp .env.example .env
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

```
Client                          Server
  │                               │
  │  GET /api/signal              │
  │ ─────────────────────────────►│
  │                               │
  │  402 Payment Required         │
  │  PAYMENT-REQUIRED: <base64>   │
  │◄──────────────────────────────│
  │                               │
  │  (sign EIP-3009 authorization)│
  │                               │
  │  GET /api/signal              │
  │  PAYMENT-SIGNATURE: <base64>  │
  │ ─────────────────────────────►│
  │                               │
  │  (facilitator settles on-chain)│
  │                               │
  │  200 OK                       │
  │  PAYMENT-RESPONSE: <base64>   │
  │◄──────────────────────────────│
```

### Headers

| Header | Direction | Content |
|--------|-----------|---------|
| `PAYMENT-REQUIRED` | Server → Client (402) | base64-encoded JSON with payment requirements |
| `PAYMENT-SIGNATURE` | Client → Server | base64-encoded JSON with signed EIP-3009 authorization |
| `PAYMENT-RESPONSE` | Server → Client (200) | base64-encoded JSON with settlement confirmation |

### PAYMENT-REQUIRED payload (decoded)

```json
{
  "version": 2,
  "scheme": "exact",
  "networkId": "base",
  "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "maxAmountRequired": "1000",
  "payTo": "0xcBB1AD132bB51Cc41210309d6e3bd45598eebb5e",
  "maxTimeoutSeconds": 300,
  "description": "PegCheck depeg signal — USDT, USDC, DAI, FRAX, LUSD, DOLA, PYUSD",
  "resource": "http://localhost:3001/api/signal",
  "extra": { "name": "USDC", "decimals": 6 }
}
```

### PAYMENT-SIGNATURE payload (decoded)

Built by the x402 client. Contains an EIP-3009 `transferWithAuthorization` signed with the caller's private key:

```json
{
  "version": 2,
  "scheme": "exact",
  "networkId": "base",
  "payload": {
    "signature": "0x<v+r+s>",
    "authorization": {
      "from":       "0x<payer>",
      "to":         "0xcBB1AD132bB51Cc41210309d6e3bd45598eebb5e",
      "value":      "1000",
      "validAfter": "0",
      "validBefore":"<unix timestamp + 5 min>",
      "nonce":      "0x<random 32 bytes>"
    }
  }
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

Expected response:

```
HTTP/1.1 402 Payment Required
payment-required: eyJ2ZXJzaW9uIjoyLCJzY2hlbWUiOiJleGFjdCIsIm5ldHdvcmtJZCI6ImJhc2...
Content-Type: application/json

{
  "error": "Payment required",
  "description": "This endpoint costs $0.001 USDC on Base. Include a signed payment in the PAYMENT-SIGNATURE header.",
  "paymentRequired": {
    "version": 2,
    "scheme": "exact",
    "networkId": "base",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "maxAmountRequired": "1000",
    "payTo": "0xcBB1AD132bB51Cc41210309d6e3bd45598eebb5e",
    ...
  }
}
```

### 4 — Inspect the PAYMENT-REQUIRED header

```bash
PAYMENT_REQUIRED=$(curl -si http://localhost:3001/api/signal \
  | grep -i '^payment-required:' \
  | awk '{print $2}' \
  | tr -d '\r')

echo "$PAYMENT_REQUIRED" | base64 -d | python3 -m json.tool
```

### 5 — Call /api/signal with a signed payment (x402 client)

Once you have built or obtained a signed PAYMENT-SIGNATURE (e.g. via the `x402` JS SDK or the `twak` MCP tool), pass it in the header:

```bash
SIGNED_PAYMENT="eyJ2ZXJzaW9uIjoyLCJzY2hlbWUiOiJleGFjdCIsIm5ldHdvcmtJZCI6ImJhc2..."

curl -i http://localhost:3001/api/signal \
  -H "payment-signature: $SIGNED_PAYMENT"
```

Expected response on success:

```
HTTP/1.1 200 OK
payment-response: eyJzdWNjZXNzIjp0cnVlLCJ0eEhhc2giOiIweDEyMy4uLiIsIm5...
Content-Type: application/json

{
  "fetchedAt": "2025-01-15T12:00:00.000Z",
  "summary": {
    "EXIT":   [],
    "HEDGE":  ["FRAX"],
    "STABLE": ["USDT", "USDC", "DAI", "LUSD", "DOLA", "PYUSD"],
    "UNKNOWN": []
  },
  "signals": {
    "USDT":  { "symbol": "USDT",  "signal": "STABLE", "price": 1.0001, "pegDeviation": 0.01, ... },
    "USDC":  { "symbol": "USDC",  "signal": "STABLE", "price": 1.0000, "pegDeviation": 0.00, ... },
    "DAI":   { "symbol": "DAI",   "signal": "STABLE", "price": 0.9998, "pegDeviation": 0.02, ... },
    "FRAX":  { "symbol": "FRAX",  "signal": "HEDGE",  "price": 0.9942, "pegDeviation": 0.58, ... },
    "LUSD":  { "symbol": "LUSD",  "signal": "STABLE", "price": 1.0003, "pegDeviation": 0.03, ... },
    "DOLA":  { "symbol": "DOLA",  "signal": "STABLE", "price": 0.9997, "pegDeviation": 0.03, ... },
    "PYUSD": { "symbol": "PYUSD", "signal": "STABLE", "price": 1.0001, "pegDeviation": 0.01, ... }
  }
}
```

### 6 — Inspect the PAYMENT-RESPONSE header

```bash
PAYMENT_RESPONSE=$(curl -si http://localhost:3001/api/signal \
  -H "payment-signature: $SIGNED_PAYMENT" \
  | grep -i '^payment-response:' \
  | awk '{print $2}' \
  | tr -d '\r')

echo "$PAYMENT_RESPONSE" | base64 -d | python3 -m json.tool
# → { "success": true, "txHash": "0x...", "networkId": "base", "amountSettled": "1000" }
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
| `USDC_CONTRACT` | `0x8335...` | USDC contract on Base mainnet |
| `PRICE_MICRO_USDC` | `1000` | Price in USDC micro-units (1000 = $0.001) |
| `FACILITATOR_URL` | `https://x402.org/facilitator` | x402 settlement facilitator |
| `SERVER_URL` | `http://localhost:3001` | Public URL of this server |
| `PEGCHECK_API` | `https://pegcheck.uk/api/depeg-status` | PegCheck API base URL |

---

## x402 client SDKs

- **JS/TS**: [`x402`](https://www.npmjs.com/package/x402) — `import { wrapFetch } from 'x402/client'`
- **Python**: community clients available for EIP-3009 signing
- **twak MCP**: `mcp__twak__x402_request` tool handles payment signing automatically

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     server.js (Express)                      │
│                                                              │
│  GET /             → routes/info.js        (free)           │
│  GET /api/catalog  → routes/catalog.js     (free)           │
│  GET /api/signal   → middleware/x402Payment.js              │
│                       └→ routes/signal.js  (paid, $0.001)   │
│                                                              │
│  middleware/x402Payment.js                                   │
│    1. No PAYMENT-SIGNATURE → 402 + PAYMENT-REQUIRED         │
│    2. POST facilitator/settle → verify on Base              │
│    3. Set PAYMENT-RESPONSE header → call next()             │
│                                                              │
│  routes/signal.js                                            │
│    Promise.all → PegCheck API × 7 coins                     │
│    classify() → STABLE / HEDGE / EXIT per coin              │
└─────────────────────────────────────────────────────────────┘
```
