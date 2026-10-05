// Downloads the latest rates and rewrites site/<source>.json only if they changed.
// Each source is independent: a failure in one still lets the other update, but exits non-zero.
// Usage: node scripts/fetch-rates.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { parseRatesHtml, validateRates } from './parse-judiciary.mjs';
import { parsePrimeXls } from './parse-prime.mjs';
import { HSBC_URL, parseHsbcHtml, crossCheckPrime } from './parse-hsbc.mjs';
import { H15_URL, parseH15Html, mergeUsPrime } from './parse-usprime.mjs';
import {
  HIBOR_URL, HIBOR_TENORS, HIBOR_HISTORY_START, HKAB_PAGE, hkabUrl, parseHiborJson, parseHkabJson, mergeHibor,
} from './parse-hibor.mjs';
import { updateCpi } from './update-cpi.mjs';

// Older HIBOR pages (newest first, 100 per page), shared by both tenors within a run
const hiborPages = new Map();
function hiborPage(offset) {
  if (!hiborPages.has(offset)) {
    const url = `${HIBOR_URL.replace(/pagesize=\d+/, 'pagesize=100')}&offset=${offset}`;
    hiborPages.set(offset, fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20_000) }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }));
  }
  return hiborPages.get(offset);
}

/** Until the history reaches 1996, fetch a few older pages per run; failures just wait for the next run */
async function fillOlderHibor(rates, tenor, pagesPerRun = 5) {
  let merged = rates;
  for (let i = 0; i < pagesPerRun && merged.at(-1)?.effective > HIBOR_HISTORY_START; i++) {
    const offset = Math.max(0, merged.length - 20); // overlap a little: some days have no fixing for a tenor
    try {
      const older = parseHiborJson(await hiborPage(offset), { tenor, allowEmpty: true });
      const before = merged.length;
      merged = mergeHibor(merged, older);
      if (merged.length === before) break; // nothing new (end of the series)
    } catch (err) {
      console.log(`${tenor} HIBOR history: older page not fetched (${err.message}); will retry next run.`);
      break;
    }
  }
  return merged;
}

const HEADERS = { 'User-Agent': 'Mozilla/5.0 (interestcal rate updater)' };

// HKAB's fixings by day, shared by both tenors within a run (one request per day, a short pause between them)
const hkabDays = new Map();
function hkabDay(iso) {
  if (!hkabDays.has(iso)) {
    hkabDays.set(iso, (async () => {
      await new Promise((r) => setTimeout(r, 300));
      const res = await fetch(hkabUrl(iso), { headers: HEADERS, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })());
  }
  return hkabDays.get(iso);
}
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);

/**
 * Add the recent days HKMA doesn't have yet from HKAB: every day from a few days before the newest saved fixing
 * (an overlap that cross-checks the two sources) up to today in Hong Kong, at most 45 days back. A fixing already
 * saved is kept; if HKAB disagrees with it, that's a warning.
 */
async function addRecentHkab(rates, tenor, warnings) {
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); // Hong Kong date
  let day = [addDays(rates[0]?.effective ?? today, -5), addDays(today, -45)].sort().at(-1);
  const saved = new Map(rates.map((r) => [r.effective, r.rate]));
  const found = [];
  for (; day <= today; day = addDays(day, 1)) {
    let fixing;
    try {
      fixing = parseHkabJson(await hkabDay(day), day, tenor);
    } catch (err) {
      warnings.push(`HKAB ${day}: not fetched (${err.message}); will retry next run`);
      break;
    }
    if (!fixing) continue;
    if (!saved.has(day)) found.push(fixing);
    else if (Math.abs(saved.get(day) - fixing.rate) > 1e-9) {
      warnings.push(`HKAB ${day}: ${fixing.rate}% but the saved fixing is ${saved.get(day)}%; kept the saved one`);
    }
  }
  return mergeHibor(rates, found);
}

async function get(url) {
  // A stalled server must not hold the daily job: give up after a minute (the next run retries)
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
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
  // US prime: the Fed's H.15 release shows the last five business days; any change is added to the saved history
  {
    name: 'US prime rates',
    url: H15_URL,
    out: 'us-prime-rates.json',
    validate: { minRows: 50, maxRate: 30 }, // 76 changes since 2000
    parse: async (res, previous) => {
      if (!previous?.rates?.length) throw new Error('No saved US prime history to add to');
      return { rates: mergeUsPrime(previous.rates, parseH15Html(await res.text())) };
    },
  },
  // HIBOR: HKMA's recent fixings (a small, reliable request) merged into the history (scripts/backfill-hibor.mjs),
  // then the days since from HKAB, which sets the fixings (HKMA republishes them weeks later). Only pre-fills the
  // mortgage tab (the HIBOR box stays editable), so an outage is a warning, not a failure; each source can fail alone.
  ...HIBOR_TENORS.map((tenor) => ({
    name: `${tenor.replace('m', '-month')} HIBOR`,
    url: HIBOR_URL,
    out: tenor === '1m' ? 'hibor.json' : `hibor-${tenor}.json`,
    selfFetch: true,
    parse: async (_, previous) => {
      const warnings = [];
      let rates = previous?.rates ?? [];
      let hkmaLatest = previous?.hkmaLatest ?? rates[0]?.effective;
      try {
        const hkma = parseHiborJson(await (await get(HIBOR_URL)).json(), { tenor });
        rates = await fillOlderHibor(mergeHibor(rates, hkma), tenor);
        if (!hkmaLatest || hkma[0].effective > hkmaLatest) hkmaLatest = hkma[0].effective;
      } catch (err) {
        warnings.push(`HKMA: ${err.message}`);
      }
      rates = await addRecentHkab(rates, tenor, warnings);
      return { rates, meta: { hkmaLatest, recentSource: HKAB_PAGE }, warnings };
    },
    validate: { minRows: 1, maxRate: 100 }, // HIBOR spiked above 30% in 1997
    compact: true, // thousands of daily fixings: keep the file small
    optional: true,
  })),
];

async function update(source) {
  const { name, url, out } = source;
  const file = new URL(`../site/${out}`, import.meta.url);
  let previous = null;
  try {
    previous = JSON.parse(await readFile(file, 'utf8'));
  } catch {}

  const { rates, meta = {}, warnings = [] } = await source.parse(source.selfFetch ? null : await get(url), previous);
  validateRates(rates, source.validate);

  const latest = `${rates.length} rates, latest ${rates[0].effective} @ ${rates[0].rate}%`;
  const hkNow = new Date(Date.now() + 8 * 3600e3).toISOString(); // Hong Kong time (UTC+8, no daylight saving)
  const today = hkNow.slice(0, 10);
  const time = hkNow.slice(11, 16);
  const content = { rates, ...meta };
  const changed = !previous ||
    JSON.stringify({ rates: previous.rates, crossCheck: previous.crossCheck }) !==
      JSON.stringify({ rates: content.rates, crossCheck: content.crossCheck });

  // updatedAt: when the rates last changed. checkedAt / checkedTime: the Hong Kong date and time (HH:MM) they were last
  // fully confirmed against the source (only advanced when every check passed, so the page never claims a check that
  // did not happen).
  const data = {
    source: url,
    updatedAt: changed ? today : previous.updatedAt,
    checkedAt: warnings.length ? (previous?.checkedAt ?? previous?.updatedAt ?? today) : today,
    ...(warnings.length ? (previous?.checkedTime ? { checkedTime: previous.checkedTime } : {}) : { checkedTime: time }),
    ...content,
  };
  await writeFile(file, (source.compact ? JSON.stringify(data) : JSON.stringify(data, null, 2)) + '\n');
  console.log(`${name}: ${changed ? 'updated' : 'no change'} (${latest}), checked ${data.checkedAt}${data.checkedTime ? ` ${data.checkedTime} HKT` : ''}.`);
  if (meta.crossCheck) console.log(`${name}: HSBC cross-check ${meta.crossCheck.status}.`);
  if (warnings.length) throw Object.assign(new Error(warnings.join('\n  ')), { saved: true });
}

for (const source of SOURCES) {
  try {
    await update(source);
  } catch (err) {
    if (source.optional) {
      console.log(`::warning::${source.name}: ${err.saved ? 'saved, with warnings' : 'not updated'} - ${err.message}`);
    } else {
      console.error(`${source.name}: FAILED - ${err.message}`);
      process.exitCode = 1;
    }
  }
}

// HK inflation (Composite CPI, the full history from C&SD): only used by the Inflation tab, so an outage is a warning
// and the saved figures stay
try {
  await updateCpi();
} catch (err) {
  console.log(`::warning::HK CPI: not updated - ${err.message}`);
}
