'use strict';

const AAVE_POOL      = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';
const COMPOUND_COMET = '0xc3d688B66703497DAA19211EEdff47f25384cdc3';
const MAKER_PROXY_REG   = '0x4678f0a6958e4D2Bc4F1BAF7Bc52E8F3564f3fE4';
const MAKER_CDP_MANAGER = '0x5ef30b9986345249bc32d8928B7ee64DE9435E39';
const MAKER_VAT         = '0x35D1b3F3D7966A1DFe207aa4514C12a259A0492B';
const MAKER_GET_CDPS    = '0x36a724Bd100c39f0Ea4D3A20F7097eE01a8fF573';
const CHAINLINK_ETH_USD = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419';
const ZERO_ADDR = '0x' + '0'.repeat(40);

function isValidAddress(addr) {
  return typeof addr === 'string' && /^0x[0-9a-fA-F]{40}$/i.test(addr);
}

// Compound v3 WETH liquidation factor (from Compound governance)
const COMPOUND_WETH_LIQ_FACTOR = 0.90;

function getRpcUrl() {
  return process.env.ETH_RPC_URL || process.env.ALCHEMY_RPC_URL || 'https://ethereum.publicnode.com';
}

async function rpcCall(to, data, rpcUrl) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
    signal: AbortSignal.timeout(8_000),
  });
  const json = await res.json();
  return json.result ?? null;
}

async function fetchEthPrice(rpcUrl) {
  const r = await rpcCall(CHAINLINK_ETH_USD, '0xfeaf968c', rpcUrl);
  if (!r || r === '0x') return null;
  const hex = r.replace('0x', '');
  return Number(BigInt('0x' + hex.slice(64, 128))) / 1e8;
}

async function aaveLiquidationPrice(address, ethPriceUsd, rpcUrl) {
  const padded = address.toLowerCase().replace('0x', '').padStart(64, '0');
  const r = await rpcCall(AAVE_POOL, '0xbf92857c' + padded, rpcUrl);
  if (!r || r === '0x') return null;
  const hex   = r.replace('0x', '');
  const chunk = (i) => BigInt('0x' + hex.slice(i * 64, (i + 1) * 64));

  const collateralUsd  = Number(chunk(0)) / 1e8;
  const debtUsd        = Number(chunk(1)) / 1e8;
  const liqThreshPct   = Number(chunk(3)) / 1e4; // basis points → fraction
  const hf             = Number(chunk(5)) / 1e18;

  if (debtUsd === 0 || !isFinite(hf)) return null;

  // collateral in ETH terms (approximate — assumes ETH-denominated collateral)
  const collateralEth  = ethPriceUsd ? collateralUsd / ethPriceUsd : null;
  // Liquidation occurs when: collateralEth × ethPrice × liqThresh = debtUsd
  // → liquidationPrice = debtUsd / (collateralEth × liqThresh)
  const liquidationPrice = collateralEth
    ? Math.round((debtUsd / (collateralEth * liqThreshPct)) * 100) / 100
    : null;

  return {
    protocol:        'Aave v3',
    currentEthPrice: ethPriceUsd,
    healthFactor:    Math.round(hf * 1000) / 1000,
    collateralUsd,
    debtUsd,
    liquidationThresholdPct: Math.round(liqThreshPct * 100),
    liquidationPriceUsd: liquidationPrice,
    safetyBuffer: liquidationPrice && ethPriceUsd
      ? Math.round((1 - liquidationPrice / ethPriceUsd) * 10000) / 100
      : null,
  };
}

async function compoundLiquidationPrice(address, ethPriceUsd, rpcUrl) {
  const padded = address.toLowerCase().replace('0x', '').padStart(64, '0');
  const [brRes, lrRes] = await Promise.all([
    fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: COMPOUND_COMET, data: '0x374c49b4' + padded }, 'latest'] }),
      signal: AbortSignal.timeout(8_000) }),
    fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'eth_call', params: [{ to: COMPOUND_COMET, data: '0x5e96c5ce' + padded }, 'latest'] }),
      signal: AbortSignal.timeout(8_000) }),
  ]);
  const [bj, lj] = await Promise.all([brRes.json(), lrRes.json()]);
  const debtUsd = Number(BigInt(bj.result || '0x0')) / 1e6;
  if (debtUsd === 0) return null;

  const raw    = BigInt(lj.result || '0x0');
  const TWO256 = BigInt('0x10000000000000000000000000000000000000000000000000000000000000000');
  const signed = raw > TWO256 / 2n - 1n ? raw - TWO256 : raw;
  const liquidityUsd = Number(signed) / 1e6;
  const collateralUsd = debtUsd + liquidityUsd;
  const hf = collateralUsd / debtUsd;

  // collateralEth ≈ collateralUsd / ethPrice (WETH collateral assumption)
  const collateralEth = ethPriceUsd ? collateralUsd / ethPriceUsd : null;
  // Liquidation: debtUsd = collateralEth × ethPrice × COMPOUND_WETH_LIQ_FACTOR
  const liquidationPrice = collateralEth
    ? Math.round((debtUsd / (collateralEth * COMPOUND_WETH_LIQ_FACTOR)) * 100) / 100
    : null;

  return {
    protocol:        'Compound v3',
    currentEthPrice: ethPriceUsd,
    healthFactor:    Math.round(hf * 1000) / 1000,
    collateralUsd:   Math.round(collateralUsd),
    debtUsd,
    liquidationThresholdPct: COMPOUND_WETH_LIQ_FACTOR * 100,
    liquidationPriceUsd: liquidationPrice,
    safetyBuffer: liquidationPrice && ethPriceUsd
      ? Math.round((1 - liquidationPrice / ethPriceUsd) * 10000) / 100
      : null,
  };
}

async function makerLiquidationPrice(address, ethPriceUsd, rpcUrl) {
  const paddedWallet  = address.toLowerCase().replace('0x', '').padStart(64, '0');
  const paddedManager = MAKER_CDP_MANAGER.replace('0x', '').padStart(64, '0');

  const proxyRaw  = await rpcCall(MAKER_PROXY_REG, '0xc4552791' + paddedWallet, rpcUrl);
  const proxyAddr = proxyRaw && proxyRaw !== '0x' ? '0x' + proxyRaw.slice(-40) : null;
  const candidates = [...new Set([proxyAddr, address].filter((a) => a && a !== ZERO_ADDR))];

  const cdpResults = await Promise.all(
    candidates.map((addr) => {
      const padded = addr.replace('0x', '').padStart(64, '0');
      return rpcCall(MAKER_GET_CDPS, '0x1ce03f38' + paddedManager + padded, rpcUrl)
        .catch(() => null);
    })
  );
  const cdpsRaw = cdpResults.find((r) => r && r !== '0x' && r.length > 2) ?? null;
  if (!cdpsRaw) return null;

  const hex   = cdpsRaw.replace('0x', '');
  const wordN = (i) => Number(BigInt('0x' + hex.slice(i * 64, (i + 1) * 64)));
  const off1 = wordN(0) / 32, off2 = wordN(1) / 32, off3 = wordN(2) / 32;
  const len = wordN(off1);
  if (len === 0) return null;

  const cdps = [];
  for (let i = 0; i < len; i++) {
    const urnWord = off2 + 1 + i;
    const ilkWord = off3 + 1 + i;
    const urn    = '0x' + hex.slice(urnWord * 64 + 24, urnWord * 64 + 64);
    const ilkHex = hex.slice(ilkWord * 64, ilkWord * 64 + 64);
    let ilkStr   = '';
    for (let j = 0; j < ilkHex.length; j += 2) {
      const b = parseInt(ilkHex.slice(j, j + 2), 16);
      if (!b) break;
      ilkStr += String.fromCharCode(b);
    }
    if (ilkStr.startsWith('ETH')) cdps.push({ urn, ilk: ilkHex });
  }
  if (cdps.length === 0) return null;

  const positions = await Promise.all(cdps.map(async ({ urn, ilk }) => {
    const paddedUrn = urn.replace('0x', '').padStart(64, '0');
    const [urnData, ilkData] = await Promise.all([
      rpcCall(MAKER_VAT, '0x2424be5c' + ilk + paddedUrn, rpcUrl),
      rpcCall(MAKER_VAT, '0xd9638d36' + ilk, rpcUrl),
    ]);
    if (!urnData || urnData === '0x' || !ilkData || ilkData === '0x') return null;
    const uh     = urnData.replace('0x', '');
    const inkBig = BigInt('0x' + uh.slice(0, 64));
    const artBig = BigInt('0x' + uh.slice(64, 128));
    if (artBig === 0n) return null;
    const ih      = ilkData.replace('0x', '');
    const rateBig = BigInt('0x' + ih.slice(64, 128));
    const spotBig = BigInt('0x' + ih.slice(128, 192)); // mat-adjusted liquidation price in ray
    const inkEth  = Number(inkBig) / 1e18;
    const debtDai = Number(artBig * rateBig / (10n ** 27n)) / 1e18;
    // spot = pip × (1/mat) in ray; liquidation price = debtDai × mat / inkEth
    // Simplified: spot is the maximum ETH price the vault can sustain / liq ratio
    const liquidationPrice = Number(spotBig) / 1e27; // USD per ETH at liquidation
    const hf = inkEth * liquidationPrice / debtDai;
    return {
      inkEth, debtDai,
      liquidationPriceUsd: Math.round(liquidationPrice * 100) / 100,
      healthFactor: Math.round(hf * 1000) / 1000,
    };
  }));

  const valid = positions.filter(Boolean);
  if (valid.length === 0) return null;
  const worst = valid.reduce((a, b) => a.liquidationPriceUsd > b.liquidationPriceUsd ? a : b);

  return {
    protocol:            'MakerDAO',
    currentEthPrice:     ethPriceUsd,
    healthFactor:        worst.healthFactor,
    collateralEth:       Math.round(worst.inkEth * 1000) / 1000,
    debtDai:             Math.round(worst.debtDai),
    liquidationPriceUsd: worst.liquidationPriceUsd,
    safetyBuffer: ethPriceUsd
      ? Math.round((1 - worst.liquidationPriceUsd / ethPriceUsd) * 10000) / 100
      : null,
  };
}

async function liquidationPriceHandler(req, res) {
  const { address } = req.query;
  if (!address)              return res.status(400).json({ error: 'Required: ?address=0x… (EVM wallet address)' });
  if (!isValidAddress(address)) return res.status(400).json({ error: 'Invalid EVM address' });

  const rpcUrl = getRpcUrl();

  try {
    const ethPrice = await fetchEthPrice(rpcUrl).catch(() => null);

    const [aave, compound, maker] = await Promise.all([
      aaveLiquidationPrice(address, ethPrice, rpcUrl).catch(() => null),
      compoundLiquidationPrice(address, ethPrice, rpcUrl).catch(() => null),
      makerLiquidationPrice(address, ethPrice, rpcUrl).catch(() => null),
    ]);

    const positions = [aave, compound, maker].filter(Boolean);
    const highest   = positions.length > 0
      ? positions.reduce((a, b) => (a.liquidationPriceUsd ?? 0) > (b.liquidationPriceUsd ?? 0) ? a : b)
      : null;

    res.json({
      fetchedAt:       new Date().toISOString(),
      address,
      currentEthPrice: ethPrice,
      mostAtRisk:      highest ? { protocol: highest.protocol, liquidationPriceUsd: highest.liquidationPriceUsd, safetyBuffer: highest.safetyBuffer } : null,
      positions: Object.fromEntries(positions.map((p) => [p.protocol, p])),
      note: 'Liquidation prices assume ETH-denominated collateral. Mixed collateral positions may differ.',
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch liquidation prices', detail: err.message });
  }
}

module.exports = liquidationPriceHandler;
