// 1-month HIBOR fixings from the HKMA open API (daily interbank interest rates):
// https://api.hkma.gov.hk/public/market-data-and-statistics/monthly-statistical-bulletin/er-ir/hk-interbank-ir-daily
// Response: { header: { success }, result: { records: [{ end_of_day: "2026-09-29", ir_1m: 3.00518, ... }] } }
// The parser only relies on a date field and a 1-month field, so small naming changes don't break it.

export const HIBOR_URL =
  'https://api.hkma.gov.hk/public/market-data-and-statistics/monthly-statistical-bulletin/er-ir/hk-interbank-ir-daily?segment=hibor.fixing&pagesize=60&sortby=end_of_day&sortorder=desc';

/** @returns {{effective: string, rate: number}[]} 1-month HIBOR, newest first */
export function parseHiborJson(json) {
  if (json?.header && json.header.success === false) throw new Error(`HKMA API error: ${json.header.err_msg ?? 'unknown'}`);
  const records = json?.result?.records;
  if (!Array.isArray(records) || !records.length) throw new Error('No HIBOR records in HKMA response');
  const out = [];
  for (const rec of records) {
    const date = rec.end_of_day ?? rec.end_of_date ?? rec.date;
    const key = Object.keys(rec).find((k) => /(^|_)1m$/i.test(k));
    const rate = key == null ? NaN : Number(rec[key]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') && Number.isFinite(rate) && rec[key] !== null && rec[key] !== '') {
      out.push({ effective: date, rate });
    }
  }
  if (!out.length) throw new Error('HIBOR records had no 1-month fixing');
  return out.sort((a, b) => b.effective.localeCompare(a.effective));
}
