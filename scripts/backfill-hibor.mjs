// Fill in older HIBOR history (1-month and 3-month, HKMA API, back to 1996) in site/hibor.json and site/hibor-3m.json.
// It resumes from the oldest fixing already saved and works in small batches: small pages, a pause between requests,
// and the files are saved after every batch, so stopping it (or the API giving up) loses nothing.
// The daily update does the same a few pages per run; this just gets there sooner.
// Usage: node scripts/backfill-hibor.mjs [pageSize=50] [pagesPerBatch=4] [maxBatches=Infinity]
import { writeFile, readFile } from 'node:fs/promises';
import { HIBOR_TENORS, HIBOR_HISTORY_START, parseHiborJson, mergeHibor } from './parse-hibor.mjs';

const BASE =
  'https://api.hkma.gov.hk/public/market-data-and-statistics/monthly-statistical-bulletin/er-ir/hk-interbank-ir-daily?segment=hibor.fixing&sortby=end_of_day&sortorder=desc';
const [PAGE = 50, BATCH = 4, MAX_BATCHES = Infinity] = process.argv.slice(2).map(Number);
const PAUSE = 3000; // between requests, to go easy on the API
const root = new URL('../', import.meta.url);
const fileFor = (tenor) => new URL(`site/${tenor === '1m' ? 'hibor.json' : `hibor-${tenor}.json`}`, root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function page(offset) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(`${BASE}&pagesize=${PAGE}&offset=${offset}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (interestcal rate updater)' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.log(`  offset ${offset}: attempt ${attempt} failed (${err.message})`);
      await sleep(PAUSE * attempt);
    }
  }
  throw new Error(`Gave up on offset ${offset}; rerun to resume`);
}

const files = {};
for (const tenor of HIBOR_TENORS) files[tenor] = JSON.parse(await readFile(fileFor(tenor), 'utf8'));
const oldest = () => HIBOR_TENORS.map((t) => files[t].rates.at(-1).effective).sort()[0];

async function save() {
  const today = new Date().toISOString().slice(0, 10);
  for (const tenor of HIBOR_TENORS) {
    const data = { ...files[tenor], updatedAt: today, checkedAt: today };
    await writeFile(fileFor(tenor), JSON.stringify(data) + '\n');
  }
}

for (let batch = 1; batch <= MAX_BATCHES && oldest() > HIBOR_HISTORY_START; batch++) {
  let reachedEnd = false;
  try {
    for (let i = 0; i < BATCH; i++) {
      // The API is newest first, so the next older page starts about where our saved history ends (overlap a little:
      // some days have no fixing for a tenor)
      const offset = Math.max(0, Math.min(...HIBOR_TENORS.map((t) => files[t].rates.length)) - 10);
      const json = await page(offset);
      const records = json.result?.records ?? [];
      let added = 0;
      for (const tenor of HIBOR_TENORS) {
        const before = files[tenor].rates.length;
        files[tenor].rates = mergeHibor(files[tenor].rates, parseHiborJson(json, { tenor, allowEmpty: true }));
        added += files[tenor].rates.length - before;
      }
      console.log(`offset ${offset}: ${records.length} records, back to ${records.at(-1)?.end_of_day ?? '-'}`);
      if (records.length < PAGE || !added) {
        reachedEnd = true;
        break;
      }
      await sleep(PAUSE);
    }
  } catch (err) {
    console.log(err.message);
    reachedEnd = true;
  }
  await save();
  console.log(`batch ${batch} saved: history now from ${oldest()} (${files['1m'].rates.length} 1-month fixings)`);
  if (reachedEnd) break;
}
