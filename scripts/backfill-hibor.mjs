// One-off: download the full HIBOR history (1-month and 3-month, HKMA API, from 1996) into site/hibor.json and
// site/hibor-3m.json. The daily update then only fetches recent fixings and merges them in.
// The API is slow on some pages, so each page is retried and progress is cached (.hibor-cache.json) so a rerun resumes.
// Usage: node scripts/backfill-hibor.mjs
import { writeFile, readFile } from 'node:fs/promises';
import { HIBOR_TENORS, parseHiborJson, mergeHibor } from './parse-hibor.mjs';

const BASE =
  'https://api.hkma.gov.hk/public/market-data-and-statistics/monthly-statistical-bulletin/er-ir/hk-interbank-ir-daily?segment=hibor.fixing&sortby=end_of_day&sortorder=desc';
const PAGE = 100; // small pages: large ones often hang on the HKMA API
const root = new URL('../', import.meta.url);
const cacheFile = new URL('.hibor-cache.json', root);
const cache = JSON.parse(await readFile(cacheFile, 'utf8').catch(() => '{}')); // offset -> records

async function page(offset) {
  if (cache[offset]) return cache[offset];
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const res = await fetch(`${BASE}&pagesize=${PAGE}&offset=${offset}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (interestcal rate updater)' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      cache[offset] = json;
      await writeFile(cacheFile, JSON.stringify(cache));
      return json;
    } catch (err) {
      console.log(`  offset ${offset}: attempt ${attempt} failed (${err.message})`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw new Error(`Gave up on offset ${offset}; rerun to resume`);
}

// Download pages until the end of the history; if the API gives up part-way, save what we have (the daily update
// keeps filling in older years a few pages at a time)
const pages = [];
try {
  for (let offset = 0; ; offset += PAGE) {
    const json = await page(offset);
    pages.push(json);
    const n = json.result.records.length;
    console.log(`offset ${offset}: ${n} records (${json.result.records.at(-1)?.end_of_day ?? '-'})`);
    if (n < PAGE) break;
  }
} catch (err) {
  console.log(`${err.message}. Saving the ${pages.length} pages downloaded so far.`);
}

const today = new Date().toISOString().slice(0, 10);
for (const tenor of HIBOR_TENORS) {
  const file = new URL(`site/${tenor === '1m' ? 'hibor.json' : `hibor-${tenor}.json`}`, root);
  const previous = JSON.parse(await readFile(file, 'utf8').catch(() => '{}'));
  let rates = previous.rates ?? [];
  for (const json of pages) rates = mergeHibor(rates, parseHiborJson(json, { tenor, allowEmpty: true }));
  const source = previous.source ?? `${BASE}&pagesize=60`;
  await writeFile(file, JSON.stringify({ source, updatedAt: today, checkedAt: today, rates }) + '\n');
  console.log(`${tenor}: wrote ${rates.length} fixings, ${rates.at(-1).effective} to ${rates[0].effective}`);
}
