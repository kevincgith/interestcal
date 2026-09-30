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
