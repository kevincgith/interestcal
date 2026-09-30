// Parses HKMA Monthly Statistical Bulletin table T6.4.1 ("Rates as at effective dates"):
// https://www.hkma.gov.hk/media/eng/doc/market-data-and-statistics/monthly-statistical-bulletin/T060401.xls
// Column A is the effective date (Excel serial), column K is the best lending rate quoted by HSBC.
import XLSX from 'xlsx';

const DATE_COL = 0;
const PRIME_COL = 10;

// Excel 1900 date system serial -> "YYYY-MM-DD". Done by hand because SheetJS's
// cellDates conversion shifts dates by the local timezone.
const serialToIso = (serial) => new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000).toISOString().slice(0, 10);

/** @returns {{effective: string, rate: number}[]} newest first */
export function parsePrimeXls(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, blankrows: false });

  // Sanity check the header so a column reshuffle fails loudly.
  const header = rows.slice(0, 15).map((r) => String(r[PRIME_COL] ?? '')).join(' ').toLowerCase();
  if (!header.includes('lending')) throw new Error('Best lending rate column not found in HKMA table');

  const ascending = rows
    .filter((r) => typeof r[DATE_COL] === 'number' && typeof r[PRIME_COL] === 'number')
    .map((r) => ({ effective: serialToIso(r[DATE_COL]), rate: r[PRIME_COL] }))
    .sort((a, b) => a.effective.localeCompare(b.effective));

  // The table also lists dates where only deposit rates moved; keep actual prime changes.
  const changes = ascending.filter((r, i) => i === 0 || r.rate !== ascending[i - 1].rate);
  return changes.reverse();
}
