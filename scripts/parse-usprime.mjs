// US prime rate: the "Bank prime loan" rate in the Federal Reserve's H.15 release (the rate posted by a majority of the
// top 25 insured US-chartered commercial banks), https://www.federalreserve.gov/releases/h15/
// The release page shows the last five business days:
//   <th id="col1" class="colhead">2026<br>Sep<br>25</th> ...
//   <th ... id="id97faac0" ...>Bank prime loan ...</th> <td class="data" headers="id97faac0 col1">&nbsp;7.00&nbsp;</td> ...
// The history was taken once from the Fed's full H.15 data file (series RIFSPBLP_N.B, daily) and saved as rate changes
// from 2000 (plus the change in force on 1 January 2000) in site/us-prime-rates.json; the daily update adds any change
// it sees on the release page.

export const H15_URL = 'https://www.federalreserve.gov/releases/h15/';
const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

/** @returns {{date: string, rate: number}[]} the prime rate on each day shown, oldest first (holidays left out) */
export function parseH15Html(html) {
  const cols = {};
  for (const m of html.matchAll(/<th[^>]*id="(col\d+)"[^>]*>\s*(\d{4})<br>\s*([A-Z][a-z]{2})<br>\s*(\d{1,2})\s*<\/th>/g)) {
    const [, id, y, mon, d] = m;
    if (!(id in cols) && MONTHS[mon]) cols[id] = `${y}-${String(MONTHS[mon]).padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  if (!Object.keys(cols).length) throw new Error('H.15: no dated columns found');
  const row = html.match(/<th[^>]*id="([^"]+)"[^>]*>\s*Bank prime loan\b/);
  if (!row) throw new Error('H.15: "Bank prime loan" row not found');
  const out = [];
  for (const m of html.matchAll(new RegExp(`<td[^>]*headers="${row[1]} (col\\d+)"[^>]*>([^<]*)</td>`, 'g'))) {
    const rate = Number(m[2].replace(/&nbsp;/g, '').trim());
    if (cols[m[1]] && Number.isFinite(rate) && m[2].replace(/&nbsp;/g, '').trim() !== '') out.push({ date: cols[m[1]], rate });
  }
  if (!out.length) throw new Error('H.15: no prime rate values');
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Add the days seen on the release page to the change list (newest first): a day whose rate differs from the rate
 * in effect becomes a new change from that day.
 */
export function mergeUsPrime(changes, days) {
  const out = [...changes];
  for (const { date, rate } of days) {
    const current = out.find((c) => c.effective <= date);
    if (!current || current.rate !== rate) {
      out.push({ effective: date, rate });
      out.sort((a, b) => b.effective.localeCompare(a.effective));
    }
  }
  return out;
}
