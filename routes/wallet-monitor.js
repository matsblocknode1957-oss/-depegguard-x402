'use strict';

// Ethereum mainnet contract addresses
const AAVE_POOL      = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';
const COMPOUND_COMET = '0xc3d688B66703497DAA19211EEdff47f25384cdc3';
const MAKER_PROXY_REG   = '0x4678f0a6958e4D2Bc4F1BAF7Bc52E8F3564f3fE4';
const MAKER_CDP_MANAGER = '0x5ef30b9986345249bc32d8928B7ee64DE9435E39';
const MAKER_VAT         = '0x35D1b3F3D7966A1DFe207aa4514C12a259A0492B';
const MAKER_GET_CDPS    = '0x36a724Bd100c39f0Ea4D3A20F7097eE01a8fF573';
const CHAINLINK_ETH_USD = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419';

const ZERO_ADDR = '0x' + '0'.repeat(40);

function riskLevel(hf) {
  if (hf >= 2)   return 'SAFE';
  if (hf >= 1.5) return 'MODERATE';
  if (hf >= 1.2) return 'ELEVATED';
  if (hf > 1)    return 'CRITICAL';
  return 'LIQUIDATABLE';
}

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
  const result = await rpcCall(CHAINLINK_ETH_USD, '0xfeaf968c', rpcUrl);
  if (!result || result === '0x') return null;
  const hex = result.replace('0x', '');
  return Number(BigInt('0x' + hex.slice(64, 128))) / 1e8;
}

async function fetchAave(address, rpcUrl) {
  const padded = address.toLowerCase().replace('0x', '').padStart(64, '0');
  const result = await rpcCall(AAVE_POOL, '0xbf92857c' + padded, rpcUrl);
  if (!result || result === '0x') return null;
  const hex = result.replace('0x', '');
  const chunk = (i) => BigInt('0x' + hex.slice(i * 64, (i + 1) * 64));
  const collateralUsd = Number(chunk(0)) / 1e8;
  const debtUsd       = Number(chunk(1)) / 1e8;
  const hf            = Number(chunk(5)) / 1e18;
  if (debtUsd === 0 || hf > 1e6 || !isFinite(hf)) return null;
  return { protocol: 'Aave v3', healthFactor: hf, collateralUsd, debtUsd, riskLevel: riskLevel(hf) };
}

async function fetchCompound(address, rpcUrl) {
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
  const raw = BigInt(lj.result || '0x0');
  const TWO256 = BigInt('0x10000000000000000000000000000000000000000000000000000000000000000');
  const signed = raw > TWO256 / 2n - 1n ? raw - TWO256 : raw;
  const liquidityUsd = Number(signed) / 1e6;
  const hf = (debtUsd + liquidityUsd) / debtUsd;
  if (!isFinite(hf) || hf <= 0) return null;
  return { protocol: 'Compound v3', healthFactor: hf, collateralUsd: Math.round(debtUsd * hf), debtUsd, riskLevel: riskLevel(hf) };
}

async function fetchMaker(address, ethPriceUsd, rpcUrl) {
  const paddedWallet  = address.toLowerCase().replace('0x', '').padStart(64, '0');
  const paddedManager = MAKER_CDP_MANAGER.replace('0x', '').padStart(64, '0');

  const proxyRaw = await rpcCall(MAKER_PROXY_REG, '0xc4552791' + paddedWallet, rpcUrl);
  const proxyAddr = proxyRaw && proxyRaw !== '0x' ? '0x' + proxyRaw.slice(-40) : null;
  const candidates = [...new Set([proxyAddr, address].filter((a) => a && a !== ZERO_ADDR))];

  let cdpsRaw = null;
  for (const addr of candidates) {
    const padded = addr.replace('0x', '').padStart(64, '0');
    const r = await rpcCall(MAKER_GET_CDPS, '0x1ce03f38' + paddedManager + padded, rpcUrl);
    if (r && r !== '0x' && r.length > 2) { cdpsRaw = r; break; }
  }
  if (!cdpsRaw) return null;

  const hex    = cdpsRaw.replace('0x', '');
  const wordN  = (i) => Number(BigInt('0x' + hex.slice(i * 64, (i + 1) * 64)));
  const off1 = wordN(0) / 32, off2 = wordN(1) / 32, off3 = wordN(2) / 32;
  const len = wordN(off1);
  if (len === 0) return null;

  const cdps = [];
  for (let i = 0; i < len; i++) {
    const urnWord = off2 + 1 + i;
    const ilkWord = off3 + 1 + i;
    const urn  = '0x' + hex.slice(urnWord * 64 + 24, urnWord * 64 + 64);
    const ilkHex = hex.slice(ilkWord * 64, ilkWord * 64 + 64);
    let ilkStr = '';
    for (let j = 0; j < ilkHex.length; j += 2) {
      const b = parseInt(ilkHex.slice(j, j + 2), 16);
      if (!b) break;
      ilkStr += String.fromCharCode(b);
    }
    if (ilkStr.startsWith('ETH')) cdps.push({ urn, ilk: ilkHex });
  }
  if (cdps.length === 0) return null;

  const ethPrice = ethPriceUsd ?? 3000;
  const resolved = await Promise.all(cdps.map(async ({ urn, ilk }) => {
    const paddedUrn = urn.replace('0x', '').padStart(64, '0');
    const [urnData, ilkData] = await Promise.all([
      rpcCall(MAKER_VAT, '0x2424be5c' + ilk + paddedUrn, rpcUrl),
      rpcCall(MAKER_VAT, '0xd9638d36' + ilk, rpcUrl),
    ]);
    if (!urnData || urnData === '0x' || !ilkData || ilkData === '0x') return null;
    const uh = urnData.replace('0x', '');
    const inkBig = BigInt('0x' + uh.slice(0, 64));
    const artBig = BigInt('0x' + uh.slice(64, 128));
    if (artBig === 0n) return null;
    const ih = ilkData.replace('0x', '');
    const rateBig = BigInt('0x' + ih.slice(64, 128));
    const spotBig = BigInt('0x' + ih.slice(128, 192));
    const inkEth  = Number(inkBig) / 1e18;
    const debtDai = Number(artBig * rateBig / (10n ** 27n)) / 1e18;
    const spotUsd = Number(spotBig) / 1e27;
    if (debtDai === 0 || inkEth === 0 || spotUsd === 0) return null;
    return { hf: (inkEth * spotUsd) / debtDai, col: Math.round(inkEth * ethPrice), debt: Math.round(debtDai) };
  }));

  const valid = resolved.filter(Boolean);
  if (valid.length === 0) return null;
  const worst = valid.reduce((a, b) => a.hf < b.hf ? a : b);
  if (!isFinite(worst.hf) || worst.hf <= 0) return null;
  return { protocol: 'MakerDAO', healthFactor: worst.hf, collateralUsd: worst.col, debtUsd: worst.debt, riskLevel: riskLevel(worst.hf) };
}

async function walletMonitorHandler(req, res) {
  const { address } = req.query;
  if (!address) return res.status(400).json({ error: 'Required: ?address=0x… (EVM wallet address)' });

  const { isAddress } = await import('viem');
  if (!isAddress(address)) return res.status(400).json({ error: 'Invalid EVM address' });

  const rpcUrl = getRpcUrl();

  const [ethPrice, aave, compound] = await Promise.all([
    fetchEthPrice(rpcUrl),
    fetchAave(address, rpcUrl),
    fetchCompound(address, rpcUrl),
  ]);

  const maker = await fetchMaker(address, ethPrice, rpcUrl);

  const positions = [aave, compound, maker].filter(Boolean);
  const worstHf   = positions.length > 0 ? Math.min(...positions.map((p) => p.healthFactor)) : null;

  res.json({
    fetchedAt:       new Date().toISOString(),
    address,
    chain:           'ethereum',
    ethPriceUsd:     ethPrice,
    overallRisk:     worstHf != null ? riskLevel(worstHf) : 'NO_POSITIONS',
    worstHealthFactor: worstHf,
    positions,
  });
}

module.exports = walletMonitorHandler;
