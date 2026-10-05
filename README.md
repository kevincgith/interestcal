# HK Interest Calculator

**Live:** https://app.kevinlhc.com/interestcal/

This tool calculates simple interest on Hong Kong debts. It is a web version of the `Interest Calculator.xlsm` workbook.

You can choose one of three rates:

- **Judgment debt rate**, as [published by the HK Judiciary](https://www.judiciary.hk/en/court_services_facilities/interest_rate.html). This is the default.
- **HSBC best lending (prime) rate**, taken from [HKMA Monthly Statistical Bulletin table 6.4.1](https://www.hkma.gov.hk/media/eng/doc/market-data-and-statistics/monthly-statistical-bulletin/T060401.xls). You can add a spread over prime, e.g. prime + 2%.
  The rates are cross-checked daily against [HSBC's own prime rate page](https://www.hsbc.com.hk/investments/market-information/hk/lending-rate/), which lists the current rate and the last 5 changes:
  - **Match:** the page says so.
  - **HSBC has a newer change:** the HKMA table is updated monthly, so HSBC can be ahead. The newer change is added and marked "HSBC".
  - **Disagreement:** the HKMA data is kept, the page shows a warning, and the daily workflow fails so you get an email.

- **US prime rate** (Interest tab), the "Bank prime loan" rate in the Federal Reserve's [H.15 release](https://www.federalreserve.gov/releases/h15/): the rate posted by most of the top 25 US banks. You can add a spread. Choosing it switches the currency to USD (US$) unless you've picked one in Advanced settings. The history since 2000 comes from the Fed's full H.15 data file (series RIFSPBLP_N.B); the daily update reads the release page, which shows the last five business days, and adds any change.

- **Fixed rate**, e.g. 8% p.a., for contract rates not tied to a published rate.

## Features

- **Mortgage tab:** equal monthly instalments on HK bank conventions.
  - **Loan:** property price × loan-to-value (100% by default) gives the loan and down payment. Choose a tenor and a drawdown date; instalments fall due on the drawdown day each month.
  - **Rate:**
    - **Prime-based (P − x%):** uses the HSBC prime history; future months use the latest prime.
    - **HIBOR-based (H + x%, capped at P − y%):** choose 1-month or 3-month HIBOR. Either way the rate resets at every monthly due date; the tenor only decides which fixing is used. Past resets use the actual fixing on or before each reset date, from HKMA history back to 1996, with the days since HKMA's latest from HKAB. Resets after the latest fixing use the "Current HIBOR" rate, which defaults to the latest fixing (updated by the daily run); a shared link keeps a HIBOR only if it was typed in. The prime cap follows the real prime history.
    - **Fixed.**
  - **Interest:** each month's interest = balance × rate × actual days ÷ 365. The instalment is recalculated when the rate changes.
  - **Extra repayments:** these keep the instalment the same, so the loan ends sooner. The results show interest and months saved.
  - **Stress test:** +2% or +3%, plus a debt-servicing ratio from monthly income.
  - **Cash rebate** (% of the loan) for each plan, with net cost and an **effective rate** after the rebate: the monthly rate at which the instalments repay the loan plus the rebate, × 12.
  - **Compare plans:** HIBOR-based, prime-based and fixed for the same loan, each with its own settings. The lowest net cost is marked.
  - **HIBOR plans:** the schedule shows both HIBOR + margin and the prime cap for each due date, and ticks whichever set the rate.
  - **Each year:** a chart of principal and interest (plus extra repayments) per loan year, and a Monthly / Yearly switch for the schedule.
  - **Also:** the full schedule, a shareable link (`?tab=mortgage&...`), and PDF / Excel / CSV downloads.

- **Advanced settings** (collapsed by default, so the basic form stays simple):
  - **Currency:** HKD by default, USD by default for the US prime rate; or RMB, the other G10 currencies (EUR, JPY, GBP, CHF, CAD, AUD, NZD, SEK, NOK) or any symbol you type. Amounts on the page and in every download use its symbol (HK$, US$, CN¥, €, JP¥, £, C$, A$, NZ$; codes for CHF, SEK and NOK). Once chosen, it doesn't change with the rate.
  - **Day count basis** (Actual/Actual by default) and **rounding** (round the total only, by default).
  - **Calculation rows:** **Detailed (each published rate)**, the default, with a row for each published rate (even when a quarter repeats the same rate), payment and new year; or **Combined (per rate period)**, which combines consecutive rows at the same rate, including rows split only by a republished rate, a new year (Actual/Actual), a payment, principal added or compounding, and shows the working as one sum, e.g. `100,000.00 × 8.000% × (184 ÷ 365 + 182 ÷ 366)`. Totals don't change. The downloads follow the same choice; in Excel a combined row is one live formula summing its pieces.
  - **Compounding:** None (simple interest, the default), monthly, quarterly, yearly, daily or continuous.
    - **Monthly / quarterly / yearly:** unpaid interest is added to principal on each compounding date. **Compounding dates** can be:
      - **From the start date** (default): anniversaries of the start date. For a start on 31 Jan, monthly dates are 28/29 Feb, 31 Mar, and so on.
      - **Calendar period ends:** interest to each month/quarter/year end joins the principal from the 1st of the next month, i.e. 1 Jan/Apr/Jul/Oct for quarterly, or 1 Jan for yearly.
    - **Daily:** `principal × ((1 + rate ÷ year days)^days − 1)` within each period.
    - **Continuous:** `principal × (e^(rate × days ÷ year days) − 1)` within each period.

    Results compare the compounded interest with the same calculation as simple interest. On a compounding date, interest is added to principal first, then principal added later, then payments.
  - **Switch to a different rate from a date:** e.g. prime + 1% before judgment, then the judgment rate after. The new rate (judgment, prime + spread, or fixed) applies from the switch date. Rows show each period's own rate, and the rates-used list labels each rate with its kind.

- **Cash flows:** principal added later and payments received sit together in a collapsible **Cash flows** pane, which shows a count (e.g. "1 principal added, 2 payments") while closed and opens by itself for a link that has any.
- **Principal added later:** further principal such as costs, each with a date, an amount and an optional description. From its date, each amount joins the principal and earns interest at the same rate. On a day with both, the principal is added before any payment, so the payment can clear it. Amounts dated outside the calculation period are ignored with a warning.
- **Icon and link preview:** a calculator icon for browser tabs and the iPhone home screen, plus a preview card (title, description, image) when the link is shared. After changing `site/favicon.svg` or the preview wording, run `npm run images`.

- **Partial payments:** add any number of payments (date + amount). Choose how they're applied:
  - **Interest first, then principal** (default): each payment clears accrued unpaid interest, and the rest reduces the principal.
  - **Principal first, then interest.**

  Interest stays simple either way: unpaid interest never earns interest. A payment on a date counts from that day. Payments before the start date, or on or after the end date, are ignored with a warning, and any overpayment is flagged. The results show a payments table and the outstanding principal plus unpaid interest. The exports include these too; in Excel, each period's interest uses that period's principal as a live formula.

- **Daily interest thereafter:** principal × the rate in force on the end date ÷ that day's year days. Under Actual/Actual it shows two figures, ÷ 365 for a normal year and ÷ 366 for a leap year, on the page and in every download. Use it for wording like "…plus HK$219.18 per day until payment". It appears on the page and in the PDF, Excel and CSV files; in Excel it's a live formula.

- **Download PDF:** downloads a report straight away (built in the browser with [jsPDF](https://github.com/parallax/jsPDF)): inputs, results, the formula for each period, the rates used, and the sources as named, clickable links. No raw URLs are printed.
- **Sortable rate table:** click **Effective date** or **Rate** to sort; click again to reverse. The PDF and Excel exports use the same order.
- **Shareable link:** the inputs are stored in the page address (e.g. `?src=prime&p=1000000&from=2026-01-01&to=2026-09-30&basis=act%2Fact&round=total&spread=1`). **Copy link** copies it.
- **Excel and CSV export:** the Excel file uses live formulas and has a second sheet with the rate sources.
- **Word export:** the interest schedule as a table worded like a statutory demand, one row per period: "(i) Interest on the sum of HK$… at the rate of …% per annum from … to … (n days)", the working ("(i.e. principal × rate × days ÷ 365 = amount)") and the amount, then the total, a summary (principal, any principal added or payments, interest, total amount due at the end date) and the daily interest from the end date until payment. Ready to paste into a court document.
- **What's new:** for a week after a refresh picks up a newly published rate, a line under the header says so, e.g. "New: judgment debt rate 8.107% → 8.000% from 01-Jan-2027" (or "stays at" when the same rate is republished). HIBOR changes daily, so it isn't included.
- **Word source note:** the Word file ends with a short note naming where the rates came from and when they were checked, e.g. "Source of rates: HK Judiciary: interest rates on judgment debts (as at 5 October 2026)." There's none for a fixed rate.
- **Word download with inputs:** in Advanced settings, "Word download: With calculation inputs" adds the inputs (rate, principal, dates, day count and so on) above the table. The choice is remembered in your browser.
- **Saved calculations:** **Save** (on either tab) keeps the calculation's link and a name in your browser's local storage, never uploaded. The **Saved calculations** card lists them, newest first: rename, open or delete. Up to 50 are kept.
- **Rounding:** you can round only the total (periods are added unrounded) or round each period to cents first. The second option makes the rows add up exactly to the total.

## How interest is calculated

- Each published rate applies from its effective date up to, but not including, the next rate's effective date.
- The start date earns interest and the end date does not. For example, 1 Jan → 2 Jan is **1 day** at the rate effective on 1 Jan.
- Interest for each period is `principal × rate × days ÷ year days`. The results table shows this formula for every row. The **rounding** option sets whether the total is the sum of unrounded amounts (the default) or of amounts already rounded to cents. Rounding is half away from zero, the same as Excel's `ROUND`.
- The year days depend on the day count basis you choose:

  | Basis | Year days | Notes |
  |---|---|---|
  | **Actual/Actual** (default) | 366 in a leap year, 365 otherwise | Periods are split at 1 January so each day uses its own year's count (ISDA style). This is the convention the HK courts use. |
  | Actual/365 Fixed | always 365 | |
  | Actual/360 | always 360 | |

- The latest published rate keeps applying after its effective date.
- Days before the earliest published rate earn no interest, and the page shows a warning when that happens. The earliest rates are currently 1 Jul 2000 for the judgment rate and 5 May 1971 for prime.
- Prime rates change on any date, not just at quarter starts, and the same rules apply. Some dates in the HKMA table record only a deposit-rate change; those rows are dropped, so every row kept is a real prime change.

## Project layout

| Path | Purpose |
|---|---|
| `site/calc.js` | The calculation, a pure function ported from the VBA macro |
| `site/index.html`, `app.js`, `style.css` | Static web UI. Amounts are shown as `xxx,xxx.xx`, and a spread is shown as `base + spread = rate`. |
| `site/interest-text.js` | Interest tab wording: rate and setting names, each period's working and note, the daily interest text (no page access, so it's unit-tested) |
| `site/cash-flows.js` | Interest tab cash flows: payment and principal-added rows |
| `site/interest-exports.js` | Interest tab downloads: Word, PDF, Excel and CSV |
| `site/export-xlsx.js` | Excel export. The **Calculation** sheet has live formulas (days, base + spread, `principal × rate × days ÷ year days`, totals). The **Rates** sheet has the source URL and the rates used. A CSV export is also available. |
| `site/vendor/xlsx.mini.min.js` | SheetJS 0.20.3 mini build (Apache-2.0), loaded only when you click Download Excel. It's copied from `node_modules/xlsx/dist/`. |
| `site/saved.js` | Saved calculations (browser storage) |
| `site/export-docx.js` | Word export. Writes the `.docx` (a zip of a few XML files) directly, so it needs no library. |
| `site/export-pdf.js`, `site/vendor/jspdf*.js` | PDF report, using jsPDF 4 and jsPDF-AutoTable 5 (both MIT). They load only when you click Download PDF and are copied from `node_modules`. |
| `site/rates.json` | Judgment debt rates scraped from the Judiciary site |
| `site/hibor.json`, `hibor-3m.json` | 1-month and 3-month HIBOR fixings since 1996: history from the HKMA API, and the recent days HKMA hasn't republished yet from [HKAB](https://www.hkab.org.hk/en/rates/hibor), which sets them each business day at 11:15 HKT (a few days overlap, as a cross-check). `scripts/backfill-hibor.mjs` fills in older history in small batches, saving after each one (rerun it to carry on). The daily update merges in recent fixings and fetches a few older pages per run until the history reaches 1996. Every download has a time limit, and the job is capped at 20 minutes. These are optional sources: an outage only logs a warning. |
| `site/mortgage.js`, `mortgage-app.js`, `mortgage-export.js` | Mortgage calculation, tab and exports |
| `site/shared.js`, `tabs.js` | Helpers shared by both tabs; tab switching |
| `site/prime-rates.json` | HSBC prime rates parsed from the HKMA spreadsheet |
| `site/us-prime-rates.json` | US prime rate changes since 2000 (Federal Reserve H.15) |
| `scripts/fetch-rates.mjs` | Fetches and validates both sources, and rewrites a JSON file only when its rates change |
| `scripts/parse-judiciary.mjs`, `parse-prime.mjs`, `parse-hsbc.mjs`, `parse-usprime.mjs` | Parsers for each source, plus the HSBC cross-check |
| `test/` | Tests, including the workbook's saved example (HK$135,436.48, 24 Nov 2025 → 20 Apr 2026 = HK$4,434.64) |
| `.github/workflows/pages.yml` | Refreshes the rates daily and deploys to GitHub Pages |

The website has no build step. [SheetJS](https://sheetjs.com) is used by the rate updater to read the HKMA `.xls` file, and by the page's Excel export through the vendored build. You need Node 20 or later to run the tests and the updater.

## Development

```bash
npm install          # install dev tools (SheetJS, jsPDF, Playwright)
npm test             # unit tests: calculation, parsers, exports, vendored libraries
npm run test:e2e     # browser tests (desktop Chrome + iPhone Safari engine); first run: npx playwright install chromium webkit
npm run fetch-rates  # refresh both rate files
npm run vendor       # re-copy the export libraries into site/vendor after updating them
npm start            # serve site/ at http://127.0.0.1:4173 (no dependencies)
```

The browser tests check the page itself: the sample calculation, shared links, no recalculation before **Calculate**, the fixed rate, field layout (one height, no overlap, no sideways scrolling, including on iPhone), rate sorting, and the three downloads. Every deploy runs them first, so a broken page is not published.

### Library updates

Dependabot opens a weekly pull request when jsPDF, jsPDF-AutoTable, Playwright or a GitHub Action has a new version. On those PRs the test workflow re-copies the updated libraries into `site/vendor` and runs all tests; merge when it's green. SheetJS (`xlsx`) is installed from `cdn.sheetjs.com`, which Dependabot can't track. To update it, change the version in `package.json`, then run `npm install && npm run vendor`.

## Deployment

1. Push to GitHub on the `main` branch.
2. Go to **Settings → Pages** and set the **Source** to **GitHub Actions**.
3. Every push to `main` deploys the site. A daily schedule (11:15 HKT, when HKAB publishes the HIBOR fixing) re-fetches both rate sources, commits any change and redeploys only when something changed. You can also start it manually from the Actions tab, and a manual run always redeploys.

If either source changes its layout, validation stops that source from overwriting good data. The other source still updates, and the workflow is marked as failed so GitHub emails you.

## Licence

[MIT](LICENSE)
