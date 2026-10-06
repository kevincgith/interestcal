// Interest tab wording: rate and source names, labels for each setting, a period's working and note, the daily
// interest text. No page access, so it's shared by the page and the downloads and can be tested on its own.
import { money, fmtDate, fmtRate } from './shared.js?v=__BUILD__';

// "5.000% + 1.000% = 6.000%" when a spread applies, otherwise just the rate
export const fmtRateWithSpread = (p) => {
  const spread = p.spread ?? 0; // each period carries its own spread (it can change at a rate switch)
  if (!spread) return fmtRate(p.rate);
  const sign = spread < 0 ? '−' : '+';
  return `${fmtRate(p.baseRate)} ${sign} ${fmtRate(Math.abs(spread) / 100)} = ${fmtRate(p.rate)}`;
};
// What a combined row covers, e.g. "3 rows combined: new year, principal changed" or "3 rows combined: same rate
// republished"
export function mergedNote(r, p) {
  const why = new Set();
  p.parts.forEach((x, k) => {
    const prev = p.parts[k - 1];
    if (!prev) return;
    if (x.capitalised > 0) why.add('interest compounded');
    else if (x.principal !== prev.principal) why.add('principal changed');
    else if (x.yearDays !== prev.yearDays) why.add('new year');
    else why.add('same rate republished'); // e.g. the judgment rate published again for a new quarter
  });
  const start = p.capitalised > 0 ? `+${r.currency}${money.format(p.capitalised)} interest compounded; ` : '';
  return `${start}${p.parts.length} rows combined${why.size ? `: ${[...why].join(', ')}` : ''}`;
}
// Each period's own principal: it changes after a payment
// Why a row starts where it does, for rows that could otherwise look odd:
// "+HK$21,366.45 interest compounded" on a compounding date, or "New year: ÷ 365 days" for an Actual/Actual year split
export function periodNote(r, p, i) {
  if (p.parts) return mergedNote(r, p);
  if (p.capitalised > 0) return `+${r.currency}${money.format(p.capitalised)} interest compounded`;
  const prev = r.periods[i - 1];
  if (prev && r.basis === 'act/act' && p.start.endsWith('-01-01') && p.yearDays !== prev.yearDays) {
    return `New year: ÷ ${p.yearDays} days`;
  }
  return '';
}

export const formula = (p) => {
  if (p.parts) return mergedFormula(p);
  const [b, r, d, y] = [money.format(p.principal), fmtRate(p.rate), p.days, p.yearDays];
  if (p.compounding === 'daily') return `${b} × ((1 + ${r} ÷ ${y})^${d} − 1)`;
  if (p.compounding === 'continuous') return `${b} × (e^(${r} × ${d} ÷ ${y}) − 1)`;
  return `${b} × ${r} × ${d} ÷ ${y}`;
};

// A combined row (one row per rate period) as one sum, e.g. "100,000.00 × 8.000% × (100 ÷ 365 + 50 ÷ 366)" or, when the
// principal changed inside it, "8.000% × (100,000.00 × 59 ÷ 365 + 90,000.00 × 30 ÷ 365)"
export function mergedFormula(p) {
  if (p.parts.some((x) => x.compounding !== 'simple')) return p.parts.map(formula).join(' + ');
  const r = fmtRate(p.rate);
  const samePrincipal = p.parts.every((x) => x.principal === p.principal);
  if (samePrincipal && typeof p.yearDays === 'number') return `${money.format(p.principal)} × ${r} × ${p.days} ÷ ${p.yearDays}`;
  if (samePrincipal) return `${money.format(p.principal)} × ${r} × (${p.parts.map((x) => `${x.days} ÷ ${x.yearDays}`).join(' + ')})`;
  return `${r} × (${p.parts.map((x) => `${money.format(x.principal)} × ${x.days} ÷ ${x.yearDays}`).join(' + ')})`;
}

export const BASES = {
  'act/act': 'Actual/Actual',
  'act/365': 'Actual/365 Fixed',
  'act/360': 'Actual/360',
};

export const COMPOUNDINGS = {
  none: 'None (simple interest)',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
  daily: 'Daily',
  continuous: 'Continuous',
};

export const PERIOD_NAME = { weekly: 'week', monthly: 'month', quarterly: 'quarter', yearly: 'year' };
// "Monthly (calendar month ends)", "Quarterly (from the start date)", "Daily", ...
export const compoundingLabel = (r) =>
  COMPOUNDINGS[r.compounding] +
  (PERIOD_NAME[r.compounding]
    ? r.compoundDates === 'calendar'
      ? ` (calendar ${PERIOD_NAME[r.compounding]} ends)`
      : ' (from the start date)'
    : '');

// Short names for a rate kind, used when a calculation switches rate on a date
export const KIND_LABEL = { judgment: 'Judgment', prime: 'HSBC prime', usprime: 'US prime', fixed: 'Fixed' };

export const ALLOCATIONS = {
  interest: 'Interest first, then principal',
  principal: 'Principal first, then interest',
};

export const ROUNDINGS = {
  total: 'Round the total only (rows added unrounded)',
  period: 'Round each row to cents, then add',
};

export const SOURCES = {
  judgment: {
    file: 'rates.json',
    title: 'Judgment debt rates',
    sourceName: 'HK Judiciary: interest rates on judgment debts',
    label: 'Judgment debt rate (HK Judiciary)',
  },
  prime: {
    file: 'prime-rates.json',
    title: 'HSBC prime rates',
    sourceName: 'HKMA Monthly Statistical Bulletin, table 6.4.1',
    label: 'HSBC best lending rate (HKMA table 6.4.1)',
    spread: true, // takes a spread over prime
  },
  usprime: {
    file: 'us-prime-rates.json',
    title: 'US prime rates',
    sourceName: 'Federal Reserve H.15: bank prime loan rate',
    label: 'US prime rate (Federal Reserve H.15)',
    spread: true,
  },
};
export const hasSpread = (key) => !!SOURCES[key]?.spread;
// Currency (Advanced settings): HKD by default, USD by default for the US prime rate. Once the user picks one
// themselves, changing the rate no longer changes it. RMB and JPY both use ¥, so they're CN¥ and JP¥; SEK and NOK
// both use "kr", so they (and CHF, which has no separate symbol) use their codes. "Other" takes whatever is typed.
export const CURRENCIES = {
  HKD: 'HK$', USD: 'US$', CNY: 'CN¥', EUR: '€', JPY: 'JP¥', GBP: '£', CHF: 'CHF', CAD: 'C$', AUD: 'A$', NZD: 'NZ$',
  SEK: 'SEK', NOK: 'NOK',
};
export const defaultCurrency = (source) => (source === 'usprime' ? 'USD' : 'HKD');

export const CROSS_CHECK = {
  match: 'Cross-checked daily against HSBC’s official prime rate page: matches.',
  supplemented: 'Cross-checked daily against HSBC’s official prime rate page: matches, and newer changes from HSBC (marked “HSBC”) are included.',
  mismatch: 'Cross-check against HSBC’s official prime rate page found differences. Check the rates before relying on this calculation.',
};

export const HSBC_PAGE = 'HSBC’s official prime rate page';
export const crossCheckTick = (cc) => (cc.status === 'mismatch' ? '' : '✓ ');

// A fixed rate has no published table: it is one rate from the start of time. Published sources are in SOURCES.
export const FIXED_FROM = '1900-01-01';
export const isFixed = (r) => r.source === 'fixed';
export const fmtPct = (n) => `${Number(n.toFixed(6)).toLocaleString('en', { minimumFractionDigits: 3, maximumFractionDigits: 6 })}%`;

export const kindLabel = (key, spread, fixedRate) =>
  key === 'fixed'
    ? `Fixed rate of ${fmtPct(fixedRate)} p.a.`
    : SOURCES[key].label + (hasSpread(key) && spread ? ` ${spread < 0 ? '−' : '+'} ${Math.abs(spread)}%` : '');
export const rateBasisLabel = (r) =>
  kindLabel(r.source, r.spreadA ?? r.spread, r.fixedRate) +
  (r.switch ? `; from ${fmtDate(r.switch.date)}: ${kindLabel(r.switch.source, r.switch.spread, r.switch.fixedRate)}` : '');

// "HK$219.18 (at 8.000% ÷ 365)", or a dash when no rate applies on the end date
// "HK$219.18 (at 8.000% ÷ 365)"; under Actual/Actual both years:
// "HK$219.18 (at 8.000% ÷ 365, non-leap year) / HK$218.58 (÷ 366, leap year)"
export const LEAP = { 365: 'non-leap year', 366: 'leap year' };
export const perDiemText = (r) => {
  if (!r.perDiem) return '–';
  const [a, b] = r.perDiem.byYearDays ?? [];
  if (!a) return `${r.currency}${money.format(r.perDiem.amount)} (at ${fmtRate(r.perDiem.rate)} ÷ ${r.perDiem.yearDays})`;
  return `${r.currency}${money.format(a.amount)} (at ${fmtRate(r.perDiem.rate)} ÷ ${a.yearDays}, ${LEAP[a.yearDays]}) / ` +
    `${r.currency}${money.format(b.amount)} (÷ ${b.yearDays}, ${LEAP[b.yearDays]})`;
};

// How days are counted (Days counted)
export const DAYS_COUNTED = { excl: 'End date not included', incl: 'End date included' };
/** "End date not included: 01-Jan-2026 to 05-Oct-2026 = 277 days (the end date doesn't earn interest)" */
export const daysCountedText = (r) =>
  `${DAYS_COUNTED[r.inclusive ? 'incl' : 'excl']}: ${fmtDate(r.start)} to ${fmtDate(r.shownEnd ?? r.end)} = ` +
  `${r.totalDays} ${r.totalDays === 1 ? 'day' : 'days'} (${r.inclusive ? 'both dates earn interest' : 'the end date doesn’t earn interest'})`;
