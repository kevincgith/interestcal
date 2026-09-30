// Cross-checks the HKMA prime rate history against HSBC's own page:
// https://www.hsbc.com.hk/zh-hk/investments/market-information/hk/lending-rate/
// The page shows the current HKD prime rate and the last 5 changes, e.g.
//   現時滙豐的港元最優惠利率：5.00% (只供參考)
//   生效日 | 滙豐的港元最優惠利率 | 2025年10月31日 | 5.00% | 2025年9月19日 | 5.125% | ...

export const HSBC_URL = 'https://www.hsbc.com.hk/zh-hk/investments/market-information/hk/lending-rate/';

const pad = (n) => String(n).padStart(2, '0');

/** @returns {{current: number, history: {effective: string, rate: number}[]}} history newest first */
export function parseHsbcHtml(html) {
  // The page repeats the table for desktop and mobile layouts; the first one is enough.
  const table = /<table[\s\S]*?<\/table>/i.exec(html)?.[0];
  if (!table) throw new Error('HSBC prime rate table not found');
  const text = table.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ');

  const current = /最優惠利率[：:]\s*([\d.]+)\s*%/.exec(text);
  if (!current) throw new Error('HSBC current prime rate not found');

  const history = [...text.matchAll(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*([\d.]+)\s*%/g)].map(([, y, m, d, rate]) => ({
    effective: `${y}-${pad(m)}-${pad(d)}`,
    rate: Number(rate),
  }));
  if (history.length === 0) throw new Error('HSBC prime rate history not found');
  history.sort((a, b) => b.effective.localeCompare(a.effective));
  return { current: Number(current[1]), history };
}

/**
 * Compares HKMA rates (newest first) with the HSBC page.
 * - Changes HSBC lists that are newer than the latest HKMA row are added (the HKMA table lags by up to a month).
 * - Any disagreement where both sources cover the same dates is a mismatch; then HKMA data is kept as-is.
 * @returns {{rates: object[], crossCheck: {source: string, status: 'match' | 'supplemented' | 'mismatch', currentRate: number, notes: string[]}}}
 */
export function crossCheckPrime(hkma, hsbc) {
  const notes = [];
  const latestHkma = hkma[0].effective;
  const oldestHsbc = hsbc.history[hsbc.history.length - 1].effective;
  const hkmaByDate = new Map(hkma.map((r) => [r.effective, r.rate]));
  const hsbcByDate = new Map(hsbc.history.map((r) => [r.effective, r.rate]));

  for (const { effective, rate } of hsbc.history) {
    if (effective > latestHkma) continue;
    if (!hkmaByDate.has(effective)) notes.push(`HSBC lists ${rate}% from ${effective}, which the HKMA table does not have.`);
    else if (hkmaByDate.get(effective) !== rate) {
      notes.push(`${effective}: HKMA has ${hkmaByDate.get(effective)}%, HSBC has ${rate}%.`);
    }
  }
  for (const { effective, rate } of hkma) {
    if (effective < oldestHsbc) break;
    if (!hsbcByDate.has(effective)) notes.push(`HKMA lists ${rate}% from ${effective}, which HSBC's recent changes do not include.`);
  }

  const newer = hsbc.history.filter((r) => r.effective > latestHkma).map((r) => ({ ...r, source: 'HSBC' }));
  const latest = notes.length ? hkma[0] : (newer[0] ?? hkma[0]);
  if (latest.rate !== hsbc.current) {
    notes.push(`Latest rate is ${latest.rate}%, but HSBC shows ${hsbc.current}% as current.`);
  }

  const status = notes.length ? 'mismatch' : newer.length ? 'supplemented' : 'match';
  if (status === 'supplemented') {
    notes.push(`Added ${newer.length} newer change(s) from HSBC not yet in the HKMA table: ${newer.map((r) => `${r.rate}% from ${r.effective}`).join(', ')}.`);
  }
  return {
    rates: status === 'supplemented' ? [...newer, ...hkma] : hkma,
    crossCheck: { source: HSBC_URL, status, currentRate: hsbc.current, notes },
  };
}
