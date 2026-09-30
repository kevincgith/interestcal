// Downloads the latest judgment-debt rates and rewrites site/rates.json only if they changed.
// Usage: node scripts/fetch-rates.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { parseRatesHtml, validateRates } from './parse-rates.mjs';

const SOURCE = 'https://www.judiciary.hk/en/court_services_facilities/interest_rate.html';
const OUT = new URL('../site/rates.json', import.meta.url);

const res = await fetch(SOURCE, { headers: { 'User-Agent': 'Mozilla/5.0 (interestcal rate updater)' } });
if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${SOURCE}`);

const rates = parseRatesHtml(await res.text());
validateRates(rates);

let previous = null;
try {
  previous = JSON.parse(await readFile(OUT, 'utf8'));
} catch {}

if (previous && JSON.stringify(previous.rates) === JSON.stringify(rates)) {
  console.log(`No change (${rates.length} rates, latest ${rates[0].effective}).`);
} else {
  const data = { source: SOURCE, updatedAt: new Date().toISOString().slice(0, 10), rates };
  await writeFile(OUT, JSON.stringify(data, null, 2) + '\n');
  console.log(`Updated: ${rates.length} rates, latest ${rates[0].effective} @ ${rates[0].rate}%.`);
}
