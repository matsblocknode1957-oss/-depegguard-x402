'use strict';

const EDGAR_SEARCH = 'https://efts.sec.gov/LATEST/search-index';
// SEC policy requires a descriptive User-Agent with contact info
const SEC_UA = 'DepegGuard/1.0 contact@depegguard.com';

const QUERIES = [
  { label: 'Circle',       q: '"Circle Internet" stablecoin' },
  { label: 'Paxos',        q: '"Paxos Trust" stablecoin' },
  { label: 'TrueUSD',      q: '"TrustToken" OR "TrueUSD" stablecoin' },
  { label: 'stablecoin',   q: 'stablecoin "proof of reserve"' },
];

async function searchEdgar(q) {
  const params = new URLSearchParams({
    q,
    forms: '8-K,S-1,10-K,20-F',
    dateRange: 'custom',
    startdt: '2024-01-01',
    hits: '5',
  });
  const url = `${EDGAR_SEARCH}?${params}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': SEC_UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.hits?.hits ?? []).map((h) => ({
    filedAt:     h._source?.file_date     ?? null,
    formType:    h._source?.form_type     ?? null,
    company:     (h._source?.display_names ?? []).join(', ') || null,
    description: h._source?.file_description ?? null,
    period:      h._source?.period_of_report ?? null,
    url:         h._source?.file_date
      ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${h._source?.entity_id}&type=${h._source?.form_type}&dateb=&owner=include&count=1`
      : null,
  }));
}

async function edgarHandler(req, res) {
  const results = await Promise.all(QUERIES.map((q) => searchEdgar(q.q)));
  const flat = results.flat();

  // Deduplicate by company + filedAt + formType
  const seen = new Set();
  const filings = flat.filter((f) => {
    const key = `${f.company}|${f.filedAt}|${f.formType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => (b.filedAt ?? '').localeCompare(a.filedAt ?? '')).slice(0, 20);

  res.json({
    fetchedAt: new Date().toISOString(),
    source:    'SEC EDGAR',
    count:     filings.length,
    filings: Object.fromEntries(filings.map((f, i) => [String(i), f])),
  });
}

module.exports = edgarHandler;
