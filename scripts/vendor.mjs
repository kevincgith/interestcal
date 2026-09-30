// Copies the browser builds of the export libraries from node_modules into site/vendor.
// Usage: npm run vendor            copy (run after updating xlsx, jspdf or jspdf-autotable)
//        npm run vendor -- --check  exit 1 if site/vendor is out of date (used by the tests)
import { readFile, writeFile } from 'node:fs/promises';

export const FILES = {
  'xlsx.mini.min.js': 'xlsx/dist/xlsx.mini.min.js',
  'xlsx.LICENSE': 'xlsx/LICENSE',
  'jspdf.umd.min.js': 'jspdf/dist/jspdf.umd.min.js',
  'jspdf.LICENSE': 'jspdf/LICENSE',
  'jspdf.plugin.autotable.min.js': 'jspdf-autotable/dist/jspdf.plugin.autotable.min.js',
  'jspdf-autotable.LICENSE': 'jspdf-autotable/LICENSE.txt',
};

const root = new URL('../', import.meta.url);

/** @returns {Promise<string[]>} vendored files that differ from node_modules */
export async function outdated() {
  const stale = [];
  for (const [dest, src] of Object.entries(FILES)) {
    const want = await readFile(new URL(`node_modules/${src}`, root));
    const have = await readFile(new URL(`site/vendor/${dest}`, root)).catch(() => null);
    if (!have || !want.equals(have)) stale.push(dest);
  }
  return stale;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const stale = await outdated();
  if (process.argv.includes('--check')) {
    if (stale.length) {
      console.error(`site/vendor is out of date: ${stale.join(', ')}. Run: npm run vendor`);
      process.exit(1);
    }
    console.log('site/vendor is up to date.');
  } else {
    for (const dest of stale) {
      await writeFile(new URL(`site/vendor/${dest}`, root), await readFile(new URL(`node_modules/${FILES[dest]}`, root)));
      console.log(`Updated site/vendor/${dest}`);
    }
    if (!stale.length) console.log('site/vendor is up to date.');
  }
}
