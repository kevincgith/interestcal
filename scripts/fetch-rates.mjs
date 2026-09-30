// Downloads the latest rates and rewrites site/<source>.json only if they changed.
// Each source is independent: a failure in one still lets the other update, but exits non-zero.
// Usage: node scripts/fetch-rates.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { parseRatesHtml, validateRates } from './parse-judiciary.mjs';
import { parsePrimeXls } from './parse-prime.mjs';
import { HSBC_URL, parseHsbcHtml, crossCheckPrime } from './parse-hsbc.mjs';
import { HIBOR_URL, parseHiborJson } from './parse-hibor.mjs';

const HEADERS = { 'User-Agent': 'Mozilla/5.0 (interestcal rate updater)' };

async function get(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res;
}

const SOURCES = [
  {
    name: 'Judgment debt rates',
    url: 'https://www.judiciary.hk/en/court_services_facilities/interest_rate.html',
    out: 'rates.json',
    parse: async (res) => ({ rates: parseRatesHtml(await res.text()) }),
    validate: { minRows: 50, maxRate: 50 },
  },
  {
    name: 'HSBC prime rates',
    url: 'https://www.hkma.gov.hk/media/eng/doc/market-data-and-statistics/monthly-statistical-bulletin/T060401.xls',
    out: 'prime-rates.json',
    validate: { minRows: 100, maxRate: 30 },
    // HKMA is the full history; HSBC's own page cross-checks it and fills the HKMA's monthly lag.
    async parse(res, previous) {
      const hkma = parsePrimeXls(Buffer.from(await res.arrayBuffer()));
      validateRates(hkma, this.validate);
      try {
        const hsbc = parseHsbcHtml(await (await get(HSBC_URL)).text());
        const { rates, crossCheck } = crossCheckPrime(hkma, hsbc);
        const warnings = crossCheck.status === 'mismatch' ? crossCheck.notes.map((n) => `HSBC cross-check mismatch: ${n}`) : [];
        return { rates, meta: { crossCheck }, warnings };
      } catch (err) {
        // HSBC unreachable or redesigned: keep HKMA data and the last known cross-check result
        return {
          rates: hkma,
          meta: previous?.crossCheck ? { crossCheck: previous.crossCheck } : {},
          warnings: [`HSBC cross-check failed: ${err.message}`],
        };
      }
    },
  },
  {
    name: '1-month HIBOR',
    url: HIBOR_URL,
    out: 'hibor.json',
    parse: async (res) => ({ rates: parseHiborJson(await res.json()) }),
    validate: { minRows: 1, maxRate: 30 },
    // Only pre-fills the mortgage tab (the HIBOR box stays editable), so an outage is a warning, not a failure
    optional: true,
  },
];

async function update(source) {
  const { name, url, out } = source;
  const file = new URL(`../site/${out}`, import.meta.url);
  let previous = null;
  try {
    previous = JSON.parse(await readFile(file, 'utf8'));
  } catch {}

  const { rates, meta = {}, warnings = [] } = await source.parse(await get(url), previous);
  validateRates(rates, source.validate);

  const latest = `${rates.length} rates, latest ${rates[0].effective} @ ${rates[0].rate}%`;
  const today = new Date().toISOString().slice(0, 10);
  const content = { rates, ...meta };
  const changed = !previous ||
    JSON.stringify({ rates: previous.rates, crossCheck: previous.crossCheck }) !==
      JSON.stringify({ rates: content.rates, crossCheck: content.crossCheck });

  // updatedAt: when the rates last changed. checkedAt: when they were last fully confirmed against the source
  // (only advanced when every check passed, so the page never claims a check that did not happen).
  const data = {
    source: url,
    updatedAt: changed ? today : previous.updatedAt,
    checkedAt: warnings.length ? (previous?.checkedAt ?? previous?.updatedAt ?? today) : today,
    ...content,
  };
  await writeFile(file, JSON.stringify(data, null, 2) + '\n');
  console.log(`${name}: ${changed ? 'updated' : 'no change'} (${latest}), checked ${data.checkedAt}.`);
  if (meta.crossCheck) console.log(`${name}: HSBC cross-check ${meta.crossCheck.status}.`);
  if (warnings.length) throw new Error(warnings.join('\n  '));
}

for (const source of SOURCES) {
  try {
    await update(source);
  } catch (err) {
    if (source.optional) {
      console.log(`::warning::${source.name}: not updated - ${err.message}`);
    } else {
      console.error(`${source.name}: FAILED - ${err.message}`);
      process.exitCode = 1;
    }
  }
}
