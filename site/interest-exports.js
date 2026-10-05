// Interest tab downloads: Word, PDF, Excel and CSV of the last calculation. The page passes in what only it knows
// (the result, the loaded rate data and a few helpers); the file builders are in export-*.js.
import { buildWorkbook } from './export-xlsx.js?v=__BUILD__';
import { buildPdf } from './export-pdf.js?v=__BUILD__';
import { buildDocx } from './export-docx.js?v=__BUILD__';
import { DISCLAIMER_WITH_TERMS } from './disclaimer.js?v=__BUILD__';
import { $, money, fmtDate, fmtRate, download, loadXlsx, loadPdf, busy } from './shared.js?v=__BUILD__';
import {
  fmtRateWithSpread, periodNote, formula, BASES, compoundingLabel, ALLOCATIONS, ROUNDINGS, SOURCES, CROSS_CHECK,
  HSBC_PAGE, crossCheckTick, isFixed, rateBasisLabel, perDiemText,
} from './interest-text.js?v=__BUILD__';

const exportName = (r, ext) => `interest_${r.source}_${r.basis.replace('/', '')}_${r.start}_${r.end}.${ext}`;

/**
 * @param {object} deps { getResult, rateData, publishedKinds, usedRatesFor, sortRates, asAt, latestRateLine,
 *   printInputItems, showError }
 */
export function setupInterestExports({
  getResult, rateData, publishedKinds, usedRatesFor, sortRates, asAt, latestRateLine, printInputItems, showError,
}) {
  $('xlsx').addEventListener('click', () => {
    const r = getResult();
    if (!r) return;
    busy($('xlsx'), async () => {
      const XLSX = await loadXlsx();
      const wb = buildWorkbook(XLSX, r, {
        currency: r.currency,
        rateBasis: rateBasisLabel(r),
        dayCount: BASES[r.basis],
        rounding: ROUNDINGS[r.rounding],
        allocation: ALLOCATIONS[r.allocation],
        formulaText: formula,
        periodNote: (p, i) => periodNote(r, p, i),
        compounding: compoundingLabel(r),
        // A fixed rate has no published source: the Rates sheet just states the rate
        ...(publishedKinds(r).length === 0
          ? { ratesTitle: 'Fixed rate', rates: [] }
          : {
              ratesTitle: r.switch ? 'Rates' : SOURCES[r.source].title,
              sources: publishedKinds(r).map((k) => ({ title: SOURCES[k].title, url: rateData[k].source, asAt: asAt(k) })),
              sourceUrl: rateData[publishedKinds(r)[0]].source,
              updatedAt: asAt(publishedKinds(r)[0]),
              crossCheck: publishedKinds(r).includes('prime') && rateData.prime.crossCheck && {
                ...rateData.prime.crossCheck,
                summary: crossCheckTick(rateData.prime.crossCheck) + CROSS_CHECK[rateData.prime.crossCheck.status],
              },
              rates: sortRates(usedRatesFor(r)),
            }),
      });
      const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      download(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), exportName(r, 'xlsx'));
    }, showError);
  });

  // Word: the interest schedule as a table, worded like a statutory demand ("Interest on the sum of HK$... at the rate of
  // ... per annum from ... to ... (n days)")
  $('docx').addEventListener('click', () => {
    const r = getResult();
    if (!r) return;
    const bytes = buildDocx(r, {
      money: (n) => money.format(n), rate: fmtRate, formula, currency: r.currency,
      inputs: printInputItems(r), // always: the document says how it was calculated
    sources: publishedKinds(r).map((k) => ({ name: SOURCES[k].sourceName, asAt: asAt(k) })),
    });
    download(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), exportName(r, 'docx'));
  });

  $('pdf').addEventListener('click', () => {
    const r = getResult();
    if (!r) return;
    busy($('pdf'), async () => {
      const lib = await loadPdf();
      const kinds = publishedKinds(r);
      const used = usedRatesFor(r);
      const cc = kinds.includes('prime') ? rateData.prime.crossCheck : null;
      const doc = buildPdf(lib, r, {
        inputs: printInputItems(r),
        warnings: [...$('warnings').querySelectorAll('.warning')].map((el) => el.textContent),
        crossCheck: cc && cc.status !== 'mismatch' ? { text: CROSS_CHECK[cc.status], linkText: HSBC_PAGE, url: cc.source, tick: true } : null,
        summaryLine: latestRateLine(r),
        perDiem: perDiemText(r),
        currency: r.currency,
        allocation: `Payments applied ${ALLOCATIONS[r.allocation].toLowerCase()}.`,
        compareLine: r.compounding === 'none' ? null : $('compareLine').textContent,
        // No "rates used" section for a fixed rate
        ...(kinds.length === 0
          ? {}
          : {
              ratesHeading: r.switch
                ? `Rates used (${used.length}, switching on ${fmtDate(r.switch.date)})`
                : `${SOURCES[r.source].title} (${used.length} of ${rateData[r.source].rates.length} rates, used from ${fmtDate(r.start)} to ${fmtDate(r.end)})`,
              source: { name: SOURCES[kinds[0]].sourceName, url: rateData[kinds[0]].source },
              extraSources: kinds.slice(1).map((k) => ({ name: SOURCES[k].sourceName, url: rateData[k].source })),
              rates: sortRates(used),
            }),
        fmt: {
          money: (n) => money.format(n), date: fmtDate, rate: fmtRate, rateWithSpread: fmtRateWithSpread, formula,
          note: (p, i) => periodNote(r, p, i),
        },
        generatedOn: fmtDate(new Date().toLocaleDateString('en-CA')),
      });
      download(doc.output('blob'), exportName(r, 'pdf'));
    }, showError);
  });

  $('csv').addEventListener('click', () => {
    const r = getResult();
    if (!r) return;
    const hasNotes = r.periods.some((p, i) => periodNote(r, p, i));
    const lines = [
      ['Rate Basis', rateBasisLabel(r)],
      ['Day Count Basis', BASES[r.basis]],
      ['Rounding', ROUNDINGS[r.rounding]],
      ...(r.rows === 'rate' ? [['Calculation rows', 'Combined (per rate period)']] : []),
      ...(r.compounding !== 'none'
        ? [
            ['Compounding', compoundingLabel(r)],
            ['Simple Interest (For Comparison)', money.format(r.simpleInterest)],
            ['Interest Added To Principal', money.format(r.totalCapitalised)],
          ]
        : []),
      ['Principal', money.format(r.principal)],
      ['Start Date', r.start],
      ['End Date', r.end],
      ['Total Interest', money.format(r.totalInterest)],
      ...(r.additions.length ? [['Principal Added', money.format(r.totalAdded)]] : []),
      ...(r.payments.length
        ? [
            ['Payments Received', money.format(r.totalPaid)],
            ['Payments Applied', ALLOCATIONS[r.allocation]],
            ['Outstanding Principal', money.format(r.outstandingPrincipal)],
            ['Unpaid Interest', money.format(r.outstandingInterest)],
          ]
        : []),
      ['Total Amount Due', money.format(r.totalDue)],
      ['Total No. of Days', r.totalDays],
      ['Daily Interest Thereafter', perDiemText(r)],
      ...(isFixed(r) ? [] : [['Rates As At', asAt(r.source)]]),
      ...(rateData[r.source]?.crossCheck
        ? [['Cross-check', `${crossCheckTick(rateData[r.source].crossCheck)}${CROSS_CHECK[rateData[r.source].crossCheck.status]} ${rateData[r.source].crossCheck.source}`]]
        : []),
      [],
      [
        'Period Start', 'Period End', 'No. of Days',
        ...(r.payments.length || r.additions.length || r.compounding !== 'none' ? ['Principal'] : []),
        ...(r.periods.some((p) => p.spread) ? ['Base Rate', 'Spread'] : []),
        'Interest Rate', 'Year Days', 'Formula', 'Interest Amount',
        ...(hasNotes ? ['Note'] : []),
      ],
      ...r.periods.map((p, i) => [
        p.start, p.end, p.days,
        ...(r.payments.length || r.additions.length || r.compounding !== 'none' ? [money.format(p.principal)] : []),
        ...(r.periods.some((x) => x.spread) ? [fmtRate(p.baseRate), fmtRate(p.spread / 100)] : []),
        fmtRate(p.rate), p.yearDays, formula(p), money.format(p.interest),
        ...(hasNotes ? [periodNote(r, p, i)] : []),
      ]),
      ...(r.additions.length
        ? [
            [],
            ['Added Principal Date', 'Description', 'Amount', 'Principal After'],
            ...r.additions.map((a) => [a.date, a.label, money.format(a.amount), money.format(a.principalAfter)]),
          ]
        : []),
      ...(r.payments.length
        ? [
            [],
            ['Payment Date', 'Amount', 'To Interest', 'To Principal', 'Principal After', 'Unpaid Interest After'],
            ...r.payments.map((p) => [
              p.date, money.format(p.amount), money.format(p.toInterest), money.format(p.toPrincipal),
              money.format(p.principalAfter), money.format(p.unpaidInterestAfter),
            ]),
          ]
        : []),
    ];
    lines.push([], [DISCLAIMER_WITH_TERMS]);
    const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
    // BOM so Excel reads the × and ÷ in the formula column as UTF-8
    const csv = '\uFEFF' + lines.map((l) => l.map(cell).join(',')).join('\n') + '\n';
    download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), exportName(r, 'csv'));
  });
}
