'use strict';

// DeFi Llama numeric IDs for stablecoins
// Source: https://stablecoins.llama.fi/stablecoins
const COIN_IDS = {
  USDT:  1,
  USDC:  2,
  DAI:   3,
  FRAX:  4,
  TUSD:  5,
  USDP:  7,
  GUSD:  8,
  LUSD:  22,
  PYUSD: 163,
};

const SUPPORTED = Object.keys(COIN_IDS);
const MAX_DAYS  = 30;

function velocitySignal(changePct) {
  if (changePct >  10) return { signal: 'RAPID_EXPANSION',   note: 'Rapid supply growth may indicate leverage build-up or strong demand' };
  if (changePct >   3) return { signal: 'EXPANDING',          note: 'Supply growing — healthy demand or new minting' };
  if (changePct > -3)  return { signal: 'STABLE',             note: 'Supply stable — balanced mint/redeem pressure' };
  if (changePct > -10) return { signal: 'CONTRACTING',        note: 'Supply shrinking — redemptions exceeding minting' };
  return                      { signal: 'RAPID_CONTRACTION',  note: 'Rapid supply decline — possible flight from this stablecoin' };
}

async function velocityHandler(req, res) {
  const coin = (req.query.coin || 'USDC').toUpperCase();
  const days = Math.min(parseInt(req.query.days, 10) || 30, MAX_DAYS);
  const id   = COIN_IDS[coin];

  if (!id) {
    return res.status(400).json({ error: `Unsupported coin. Supported: ${SUPPORTED.join(', ')}` });
  }

  const apiRes = await fetch(`https://stablecoins.llama.fi/stablecoin/${id}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!apiRes.ok) throw new Error(`DeFi Llama stablecoin API returned ${apiRes.status}`);

  const data = await apiRes.json();

  // totalCirculating array: [{ date (unix), totalCirculating: { peggedUSD } }]
  const raw = (data.totalCirculating || data.tokens || [])
    .filter((e) => e.totalCirculating?.peggedUSD != null || e.circulating?.peggedUSD != null)
    .map((e) => ({
      date:   new Date(e.date * 1000).toISOString().slice(0, 10),
      supplyUsd: Math.round(e.totalCirculating?.peggedUSD ?? e.circulating?.peggedUSD ?? 0),
    }))
    .filter((e) => e.supplyUsd > 0);

  const slice     = raw.slice(-days);
  const startEntry = slice[0];
  const endEntry   = slice[slice.length - 1];

  if (!startEntry || !endEntry) throw new Error('Insufficient supply history from DeFi Llama');

  const changeUsd  = endEntry.supplyUsd - startEntry.supplyUsd;
  const changePct  = Math.round((changeUsd / startEntry.supplyUsd) * 10000) / 100;
  const dailyChangePct = Math.round((changePct / days) * 100) / 100;
  const { signal, note } = velocitySignal(changePct);

  res.json({
    fetchedAt:        new Date().toISOString(),
    coin,
    days,
    currentSupplyUsd: endEntry.supplyUsd,
    supplyAtStart:    startEntry.supplyUsd,
    changeUsd:        Math.round(changeUsd),
    changePct,
    dailyChangePct,
    velocitySignal:   signal,
    note,
    history: slice,
  });
}

module.exports = velocityHandler;
