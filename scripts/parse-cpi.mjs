// Hong Kong Composite Consumer Price Index from the Census and Statistics Department (C&SD), table 510-60001, through
// its open data API: https://www.censtatd.gov.hk/en/web_table.html?id=510-60001
// Response: { header: { status: { code: 0 }, title }, dataSet: [{ freq: 'M' | 'Y', period: '202608' | '2025',
//   sv: 'CC_CM_1920', svDesc: 'Index' | 'Year-on-year % change' | 'Month-to-month % change', figure: '110.8' }] }
// CC_ is the Composite CPI (A_, B_ and C_ are CPI(A), (B) and (C)); the suffix is the index base (1920 =
// Oct 2019 - Sep 2020 = 100) and changes when C&SD rebases, so the parser doesn't depend on it.
// The rates of change are C&SD's published figures: before Oct 2020 they were worked out on the index base in use at
// the time, so they can differ slightly from changes in today's rebased index. Both are kept as published.

export const CPI_API = 'https://www.censtatd.gov.hk/api/get.php?id=510-60001&lang=en&full_series=1';
export const CPI_PAGE = 'https://www.censtatd.gov.hk/en/web_table.html?id=510-60001';

const num = (s) => (s === '' || s == null || Number.isNaN(Number(s)) ? null : Number(s));

/**
 * @returns {{ title: string, base: string, monthly: {month: string, index: number, yoy: number|null, mom: number|null}[],
 *   yearly: {year: number, index: number, yoy: number|null}[] }}  oldest first, from the first month with an index
 */
export function parseCpiJson(json) {
  const status = json?.header?.status;
  if (status && status.code !== 0) throw new Error(`C&SD API error: ${status.description ?? status.name ?? status.code}`);
  const rows = json?.dataSet;
  if (!Array.isArray(rows) || !rows.length) throw new Error('No CPI records in the C&SD response');
  const composite = rows.filter((r) => /^CC_/.test(r.sv ?? ''));
  if (!composite.length) throw new Error('No Composite CPI series in the C&SD response');
  // During a rebase two Composite series may appear: use the one with the most index figures
  const counts = new Map();
  for (const r of composite) if (r.svDesc === 'Index' && num(r.figure) != null) counts.set(r.sv, (counts.get(r.sv) ?? 0) + 1);
  const sv = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!sv) throw new Error('No Composite CPI index figures in the C&SD response');
  const series = composite.filter((r) => r.sv === sv);

  const pick = (freq, desc) => new Map(series.filter((r) => r.freq === freq && r.svDesc === desc).map((r) => [r.period, num(r.figure)]));
  const mIndex = pick('M', 'Index');
  const mYoy = pick('M', 'Year-on-year % change');
  const mMom = pick('M', 'Month-to-month % change');
  const yIndex = pick('Y', 'Index');
  const yYoy = pick('Y', 'Year-on-year % change');

  const monthly = [...mIndex]
    .filter(([p, v]) => /^\d{6}$/.test(p) && v != null)
    .map(([p, index]) => ({ month: `${p.slice(0, 4)}-${p.slice(4)}`, index, yoy: mYoy.get(p) ?? null, mom: mMom.get(p) ?? null }))
    .sort((a, b) => a.month.localeCompare(b.month));
  const yearly = [...yIndex]
    .filter(([p, v]) => /^\d{4}$/.test(p) && v != null)
    .map(([p, index]) => ({ year: Number(p), index, yoy: yYoy.get(p) ?? null }))
    .sort((a, b) => a.year - b.year);
  const title = json.header?.title ?? '';
  const base = /\(([^()]*=\s*100)\)/.exec(title)?.[1] ?? '';
  return { title, base, monthly, yearly };
}

const nextMonth = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
};

/**
 * Sanity checks before anything is saved: enough history, no gaps, plausible figures, each full year's average of
 * the monthly index matching C&SD's yearly index, and a latest month that isn't stale.
 * @param {{ today?: string }} [opts]  today's date (YYYY-MM-DD) for the staleness check
 */
export function validateCpi({ monthly, yearly }, { today } = {}) {
  if (monthly.length < 500) throw new Error(`Only ${monthly.length} monthly CPI figures (expected 500+ since 1980)`);
  if (yearly.length < 40) throw new Error(`Only ${yearly.length} yearly CPI figures (expected 40+ since 1981)`);
  for (let i = 1; i < monthly.length; i++) {
    if (monthly[i].month !== nextMonth(monthly[i - 1].month)) throw new Error(`CPI gap: ${monthly[i - 1].month} then ${monthly[i].month}`);
  }
  for (const m of monthly) {
    if (!(m.index > 5 && m.index < 500)) throw new Error(`Implausible CPI index ${m.index} for ${m.month}`);
    if (m.yoy != null && !(m.yoy > -20 && m.yoy < 30)) throw new Error(`Implausible CPI year-on-year change ${m.yoy}% for ${m.month}`);
    if (m.mom != null && !(m.mom > -10 && m.mom < 10)) throw new Error(`Implausible CPI month-to-month change ${m.mom}% for ${m.month}`);
  }
  // Each year's index is the average of its 12 months (both rounded to 1 decimal)
  const byYear = new Map();
  for (const m of monthly) {
    const y = Number(m.month.slice(0, 4));
    byYear.set(y, [...(byYear.get(y) ?? []), m.index]);
  }
  for (const y of yearly) {
    const months = byYear.get(y.year);
    if (months?.length !== 12) continue;
    const avg = months.reduce((s, x) => s + x, 0) / 12;
    if (Math.abs(avg - y.index) > 0.11) throw new Error(`CPI ${y.year}: yearly index ${y.index} but the months average ${avg.toFixed(2)}`);
  }
  if (today) {
    const latest = monthly.at(-1).month;
    const [ty, tm] = today.split('-').map(Number);
    const [ly, lm] = latest.split('-').map(Number);
    const behind = (ty - ly) * 12 + (tm - lm);
    if (behind > 4) throw new Error(`Latest CPI is ${latest}, ${behind} months ago (C&SD normally publishes within a month)`);
  }
}
