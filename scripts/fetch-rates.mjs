// Downloads the latest rates and rewrites site/<source>.json only if they changed.
// Each source is independent: a failure in one still lets the other update, but exits non-zero.
// Usage: node scripts/fetch-rates.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { parseRatesHtml, validateRates } from './parse-judiciary.mjs';
import { parsePrimeXls } from './parse-prime.mjs';

const HEADERS = { 'User-Agent': 'Mozilla/5.0 (interestcal rate updater)' };

const SOURCES = [
  {
    name: 'Judgment debt rates',
    url: 'https://www.judiciary.hk/en/court_services_facilities/interest_rate.html',
    out: 'rates.json',
    parse: async (res) => parseRatesHtml(await res.text()),
    validate: { minRows: 50, maxRate: 50 },
  },
  {
    name: 'HSBC prime rates',
    url: 'https://www.hkma.gov.hk/media/eng/doc/market-data-and-statistics/monthly-statistical-bulletin/T060401.xls',
    out: 'prime-rates.json',
    parse: async (res) => parsePrimeXls(Buffer.from(await res.arrayBuffer())),
    validate: { minRows: 100, maxRate: 30 },
  },
];

async function update({ name, url, out, parse, validate }) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const rates = await parse(res);
  validateRates(rates, validate);

  const file = new URL(`../site/${out}`, import.meta.url);
  let previous = null;
  try {
    previous = JSON.parse(await readFile(file, 'utf8'));
  } catch {}

  const latest = `${rates.length} rates, latest ${rates[0].effective} @ ${rates[0].rate}%`;
  if (previous && JSON.stringify(previous.rates) === JSON.stringify(rates)) {
    console.log(`${name}: no change (${latest}).`);
    return;
  }
  const data = { source: url, updatedAt: new Date().toISOString().slice(0, 10), rates };
  await writeFile(file, JSON.stringify(data, null, 2) + '\n');
  console.log(`${name}: updated (${latest}).`);
}

for (const source of SOURCES) {
  try {
    await update(source);
  } catch (err) {
    console.error(`${source.name}: FAILED - ${err.message}`);
    process.exitCode = 1;
  }
}
