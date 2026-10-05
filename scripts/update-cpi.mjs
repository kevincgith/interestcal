// Downloads the Hong Kong Composite CPI (C&SD table 510-60001, the full monthly and yearly history) and rewrites
// site/cpi.json only if the figures changed. Called by fetch-rates.mjs each day; run on its own to refresh just the CPI:
//   node scripts/update-cpi.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CPI_API, CPI_PAGE, parseCpiJson, validateCpi } from './parse-cpi.mjs';

const FILE = new URL('../site/cpi.json', import.meta.url);
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (interestcal rate updater)' };

export async function updateCpi() {
  let previous = null;
  try {
    previous = JSON.parse(await readFile(FILE, 'utf8'));
  } catch {}
  const res = await fetch(CPI_API, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${CPI_API}`);
  const hkNow = new Date(Date.now() + 8 * 3600e3).toISOString(); // Hong Kong time
  const today = hkNow.slice(0, 10);
  const cpi = parseCpiJson(await res.json());
  validateCpi(cpi, { today });

  const changed = !previous ||
    JSON.stringify({ m: previous.monthly, y: previous.yearly }) !== JSON.stringify({ m: cpi.monthly, y: cpi.yearly });
  const data = {
    source: CPI_PAGE,
    api: CPI_API,
    updatedAt: changed ? today : previous.updatedAt,
    checkedAt: today,
    checkedTime: hkNow.slice(11, 16),
    title: cpi.title,
    base: cpi.base,
    latest: cpi.monthly.at(-1).month,
    monthly: cpi.monthly,
    yearly: cpi.yearly,
  };
  await writeFile(FILE, `${JSON.stringify(data)}\n`);
  const last = cpi.monthly.at(-1);
  console.log(`HK CPI: ${changed ? 'updated' : 'no change'} (${cpi.monthly.length} months to ${last.month}, index ${last.index}, ` +
    `${last.yoy}% a year), checked ${data.checkedAt} ${data.checkedTime} HKT.`);
  return changed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  updateCpi().catch((err) => {
    console.error(`HK CPI: FAILED - ${err.message}`);
    process.exitCode = 1;
  });
}
