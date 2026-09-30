// Parses the rate table on https://www.judiciary.hk/en/court_services_facilities/interest_rate.html
// Rows look like: <tr><td>8.107</td><td>01-01-2026</td></tr>  (date is DD-MM-YYYY)

const decode = (s) =>
  s
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();

/** @returns {{effective: string, rate: number}[]} newest first */
export function parseRatesHtml(html) {
  const rates = [];
  for (const [, row] of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => decode(m[1]));
    if (cells.length < 2) continue;

    const rate = Number(cells[0]);
    const date = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(cells[cells.length - 1]);
    if (!Number.isFinite(rate) || !date) continue;

    const [, d, m, y] = date;
    rates.push({ effective: `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`, rate });
  }
  return rates.sort((a, b) => b.effective.localeCompare(a.effective));
}

/** Throws if the scrape looks wrong, so a site redesign never overwrites good data. */
export function validateRates(rates) {
  if (rates.length < 50) throw new Error(`Only ${rates.length} rates parsed; page layout may have changed`);
  const seen = new Set();
  for (const { effective, rate } of rates) {
    if (!(rate > 0 && rate < 50)) throw new Error(`Implausible rate ${rate} on ${effective}`);
    const d = new Date(`${effective}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== effective) {
      throw new Error(`Invalid effective date ${effective}`);
    }
    if (seen.has(effective)) throw new Error(`Duplicate effective date ${effective}`);
    seen.add(effective);
  }
}
