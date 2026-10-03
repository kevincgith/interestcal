// 1-month and 3-month HIBOR fixings from the HKMA open API (daily interbank interest rates):
// https://api.hkma.gov.hk/public/market-data-and-statistics/monthly-statistical-bulletin/er-ir/hk-interbank-ir-daily
// Response: { header: { success }, result: { records: [{ end_of_day: "2026-09-29", ir_1m: 3.00518, ir_3m: 3.24, ... }] } }
// The parser only relies on a date field and a field ending in the tenor (1m / 3m), so small naming changes don't
// break it.

export const HIBOR_URL =
  'https://api.hkma.gov.hk/public/market-data-and-statistics/monthly-statistical-bulletin/er-ir/hk-interbank-ir-daily?segment=hibor.fixing&pagesize=60&sortby=end_of_day&sortorder=desc';

export const HIBOR_TENORS = ['1m', '3m'];
export const HIBOR_HISTORY_START = '1996-07-01'; // first fixing in the HKMA series

/** @returns {{effective: string, rate: number}[]} HIBOR for one tenor ('1m' or '3m'), newest first */
export function parseHiborJson(json, { tenor = '1m', allowEmpty = false } = {}) {
  if (json?.header && json.header.success === false) throw new Error(`HKMA API error: ${json.header.err_msg ?? 'unknown'}`);
  const records = json?.result?.records;
  if (!Array.isArray(records) || (!records.length && !allowEmpty)) throw new Error('No HIBOR records in HKMA response');
  const out = [];
  for (const rec of records) {
    const date = rec.end_of_day ?? rec.end_of_date ?? rec.date;
    const key = Object.keys(rec).find((k) => new RegExp(`(^|_)${tenor}$`, 'i').test(k));
    const rate = key == null ? NaN : Number(rec[key]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') && Number.isFinite(rate) && rec[key] !== null && rec[key] !== '') {
      out.push({ effective: date, rate });
    }
  }
  if (!out.length && !allowEmpty) throw new Error(`HIBOR records had no ${tenor} fixing`);
  return out.sort((a, b) => b.effective.localeCompare(a.effective));
}

/** Combine two fixing lists (newest first); for a date in both, `newer` wins */
export function mergeHibor(older, newer) {
  const byDate = new Map(older.map((r) => [r.effective, r.rate]));
  for (const r of newer) byDate.set(r.effective, r.rate);
  return [...byDate].map(([effective, rate]) => ({ effective, rate })).sort((a, b) => b.effective.localeCompare(a.effective));
}

// HKAB (the Hong Kong Association of Banks) sets the fixings each business day at 11:15 HKT and shows them at
// https://www.hkab.org.hk/en/rates/hibor, which loads one day at a time from its own API:
// /api/hibor?year=2026&month=10&day=2 -> { "1 Month": 2.96839, "3 Months": 3.24482, year: 2026, month: 10, day: 2, ... }
// Holidays and Saturdays come back with every rate and the date null. HKMA republishes the same fixings later, so
// HKAB only fills in the recent days HKMA doesn't have yet.
export const HKAB_PAGE = 'https://www.hkab.org.hk/en/rates/hibor';
export const hkabUrl = (iso) =>
  `https://www.hkab.org.hk/api/hibor?year=${+iso.slice(0, 4)}&month=${+iso.slice(5, 7)}&day=${+iso.slice(8, 10)}`;
const HKAB_KEYS = { '1m': '1 Month', '3m': '3 Months' };

/** One day's fixing for a tenor from HKAB, or null when there is none (holiday, weekend, or a different date) */
export function parseHkabJson(json, iso, tenor = '1m') {
  const [y, m, d] = iso.split('-').map(Number);
  if (json?.year !== y || json?.month !== m || json?.day !== d) return null;
  const rate = json[HKAB_KEYS[tenor]];
  return typeof rate === 'number' && Number.isFinite(rate) ? { effective: iso, rate } : null;
}
