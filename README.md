# HK Interest Calc

**Live:** https://app.kevinlhc.com/interestcal/

Hong Kong finance calculators on one page: interest on debts (a web version of the `Interest Calculator.xlsm` workbook), mortgages, present value / IRR / time value of money, and inflation by the official CPI. Rates and CPI are updated daily.

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
    - **Prime (P):** small P (HSBC's prime, the default), big P (small P + 0.25%, e.g. BOCHK, Standard Chartered) or another bank's P (small P + an amount you enter). The discount and the HIBOR cap apply to the P chosen. Banks move their P together, so big P and other banks' past P are estimated from HSBC's history plus the gap.
    - **HIBOR-based (H + x%, capped at P − y%):** choose 1-month or 3-month HIBOR. Either way the rate resets at every monthly due date; the tenor only decides which fixing is used. Past resets use the actual fixing on or before each reset date, from HKMA history back to 1996, with the days since HKMA's latest from HKAB. Resets after the latest fixing use the "Current HIBOR" rate, which defaults to the latest fixing (updated by the daily run); a shared link keeps a HIBOR only if it was typed in. The prime cap follows the real prime history.
    - **Fixed.**
  - **Interest:** each month's interest = balance × rate × actual days ÷ 365. The instalment is recalculated when the rate changes.
  - **Extra repayments:** these keep the instalment the same, so the loan ends sooner. The results show interest and months saved.
  - **Stress test:** +2% or +3%: the instalment at that higher rate, shown beside the monthly instalment, plus the debt servicing ratio (DSR: first instalment ÷ monthly income, now and under the stress test) when you enter your income. A DSR above the usual 50% limit, or 60% under the stress test, turns red with a warning (also in the downloads).
  - **Cash rebate** (% of the loan) for each plan, with net cost and an **effective rate** after the rebate: the monthly rate at which the instalments repay the loan plus the rebate, × 12.
  - **Compare plans:** HIBOR-based, prime-based and fixed for the same loan, each with its own settings. The lowest net cost is marked.
  - **HIBOR plans:** the schedule shows both HIBOR + margin and the prime cap for each due date, and ticks whichever set the rate.
  - **Each year:** a chart of principal and interest (plus extra repayments) per loan year, and a Monthly / Yearly switch for the schedule.
  - **Also:** the full schedule, a shareable link (`?tab=mortgage&...`), and PDF / Excel downloads.

- **Present value tab** (labelled **PV**): the value today of amounts due on future dates, at one discount rate.
  - **Inputs:** a valuation date, a discount rate (% p.a., may be negative), compounding (yearly by default, half-yearly, quarterly, monthly, daily, continuous or none) and a day count basis (Actual/365 by default, Actual/360 or Actual/Actual). Amounts are in HK$.
  - **Cash flows:** any number of date + amount rows with an optional description. A minus sign (or brackets) marks money paid out, so the total is a net present value. An amount dated before the valuation date is grown forward to it at the same rate, and the page says so.
  - **Repeating cash flows:** one row for an amount every month, quarter, half-year or year, from a first date, for up to 1,200 times (e.g. rent or instalments). It becomes a dated row for each time, e.g. "Rent (3 of 12)", keeping the first date's day of the month where the month has it (31 Jan, 28/29 Feb, 31 Mar, ...). The form shows the last date as you type.
  - **Solve for the rate (IRR):** instead of entering a rate, find the rate at which the cash flows are worth zero on the valuation date, under the compounding and day count chosen. It needs money paid out and money received, and looks from −99% to 1,000% p.a. With Actual/365 and yearly compounding it's Excel's `XIRR` (Microsoft's example gives 37.336253%, as Excel does). If more than one rate works (cash flows that switch between paid and received more than once), it shows the one closest to 0% and lists the others. Switching back to Present value starts from the rate found.
  - **Timing: dates or periods.** Periods (T0, T+1, T+2, ...) put each cash flow at a whole period from now instead of a date, with each period a year, half-year, quarter or month. The rate is still % p.a. and the page shows it a period (e.g. 8% p.a. = 2% a quarter), so nobody divides by 4 or 12 by hand; the discount factor at T+n is `(1 + rate ÷ periods a year)^(−n)`. With yearly periods this is Excel's `NPV` (whose first value is T+1) and `IRR` (whose first value is T0): Microsoft's examples give 1,188.44, −2.1% and 8.7%, as in Excel. An IRR by periods is quoted a year (the rate a period × periods a year) and a period, plus the yearly rate with compounding. Links carry `tm=p&pl=quarter`, with the period number in place of the date.
  - **Discount factor:** `(1 + rate ÷ m)^(−m × years)` for m compounding periods a year; daily `(1 + rate ÷ year days)^(−days)`; continuous `e^(−rate × years)`; none `1 ÷ (1 + rate × years)`. Years = days ÷ 365 (or 360); under Actual/Actual, the days in each calendar year ÷ 365 or 366, added up.
  - **Results:** the present value, the total of the amounts and the discount, plus a row per cash flow with its days, years, discount factor, present value and the working, e.g. `100,000.00 ÷ (1 + 5.000%)^(731 ÷ 365)`. Rows keep full precision; only the totals are rounded to cents.
  - Actual/365 with yearly compounding matches Excel's `XNPV` with the valuation date as its first date.
  - **Downloads:** PDF and Excel, each with the inputs, totals, every row and its working, and the disclaimer. In Excel the valuation date and the rate are cells at the top, and each row's days, years, discount factor and present value are live formulas that use them (Actual/Actual writes its 1 January splits as `DATE(...)`), with the totals as `SUM`s.
  - **Also:** a shareable link (`?tab=pv&v=...&r=...&cf=date,amount,description`; a repeating one is `rf=date,amount,every,times,description`, and `s=irr` solves for the rate), and Recent and Saved like the other tabs.

- **Time Value of Money calculator** (PV tab, switch at the top: Cash flows | Time Value of Money; N, I/Y, PV, PMT, FV): the financial-calculator equation, as on a BA II Plus or HP 12C. Choose what to solve for and fill in the other four.
  - **No ×12 or ÷12:** choose how often payments are made (monthly, quarterly, half-yearly, yearly); enter the term in years or as a number of payments and the rate as % p.a. The form shows the conversions as you type (e.g. "= 360 monthly payments", "= 0.416667% a month").
  - **Signs:** + for money received, − for money paid (a loan you receive is PV +, its payments PMT −). Wrong signs get a message saying so.
  - **Equation:** `PV (1+i)^N + PMT (1 + i·due) ((1+i)^N − 1) ÷ i + FV = 0`, where i = (1 + rate ÷ C/Y)^(C/Y ÷ P/Y) − 1, so compounding can differ from payments (e.g. half-yearly compounding, monthly payments); payments can be at the start of each period. N comes from logs; I/Y is found numerically and closest to 0%.
  - **Examples:** one click fills and works out a loan payment, a savings goal, how long to repay, what rate, and a future sum's value today.
  - **Results:** the answer (also filled into its box), total of payments, interest earned or paid, the rate with compounding, and a year-by-year table of payments, interest and balance. A term that isn't a whole number of payments ends with a smaller last payment. Shareable link (`?tab=pv&m=tvm&ts=pmt&py=12&n=30&r=5&pv=1000000&fv=0`), Recent and Saved.

- **Inflation tab:** what an amount at one time is worth at another by the Hong Kong Composite Consumer Price Index from the [Census and Statistics Department, table 510-60001](https://www.censtatd.gov.hk/en/web_table.html?id=510-60001), through its open data API.
  - **Calculator, in the same style as the other tabs, worked out as you type:** Amount (HK$), In (when the amount is from) and Worth in (when to value it), either way round: HK$100 in 2000 is worth HK$156.28 now; HK$100 now was worth HK$63.99 in 2000. Each is a year list ("Now" = the latest month published) and a month list ("full year" = C&SD's yearly average, or a month); shortcuts under In set 1, 5, 10, 20 or 30 years ago (the same month that many years before the latest) worth now; months without figures are greyed out, and two times that overlap (e.g. 2010 and Mar 2010) ask for two different times. Value = amount × CPI(worth in) ÷ CPI(in), shown in the first result box with the change in prices, the average a year, `(CPI ratio)^(1 ÷ years) − 1` (a year counting from its middle), and the CPI at each end.
  - **Price level chart:** the monthly Composite CPI rebased so a start month you pick = 100, up to the latest month.
  - **History, back-filled in full:** monthly from October 1980 (index, year-on-year and month-to-month) and yearly from 1981, as tables and a chart of year-on-year inflation each month (5, 10, 20 years or all). The rates of change are C&SD's published figures; before October 2020 C&SD worked them out on the index base in use at the time, so they can differ slightly from changes in today's rebased index (published to 1 decimal place).
  - **Header:** the latest year-on-year inflation, e.g. "HK inflation 1.7% Aug 2026". The rates ("Rates updated as at ..." and today's rates) sit at the top of each tab's panel, joined to its card, and show only what that tab uses: Interest (judgment debt, HSBC prime, US prime), Mortgage (HSBC prime, 1M and 3M HIBOR), Inflation (HK inflation) and none on PV. The tab bar stays put under the title and its one-line description.
  - **Daily update:** `scripts/update-cpi.mjs` (run by `npm run fetch-rates`, or on its own) downloads the whole series, checks it (500+ months, no gaps, plausible figures, each full year's average of the months matching C&SD's yearly index, latest month no more than 4 months old) and rewrites `site/cpi.json` when it changes. The page only uses it on this tab, so an outage is a warning and the saved figures stay.
  - **Also:** a shareable link (`?tab=inflation&a=100&in=2000&w=now`; months as `2000-01`; `now` keeps following the latest month; older `f` / `t` / `d=back` links still open), Recent and Saved.

- **Advanced settings** (collapsed by default, so the basic form stays simple):
  - **Day count basis** (Actual/Actual by default) and **rounding** (round the total only, by default).
  - **Days counted** (next to the dates, not under Advanced settings): **End date included** (the default, and usually how it is counted in court: both the start and end dates earn interest), or **End date not included** (as in Excel and the original workbook: the start date earns interest, the end date doesn't). With the end date included each period shows its last day counted (1 January to 31 March is 90 days), the same start and end date is one day, and the downloads follow (in Excel, days = end − start + 1).
  - **Calculation rows:** **Detailed (each published rate)**, the default, with a row for each published rate (even when a quarter repeats the same rate), payment and new year; or **Combined (per rate period)**, which combines consecutive rows at the same rate, including rows split only by a republished rate, a new year (Actual/Actual), a payment, principal added or compounding, and shows the working as one sum, e.g. `100,000.00 × 8.000% × (184 ÷ 365 + 182 ÷ 366)`. Totals don't change. The downloads follow the same choice; in Excel a combined row is one live formula summing its pieces.
  - **Compounding:** None (simple interest, the default), monthly, quarterly, yearly, daily or continuous.
    - **Monthly / quarterly / yearly:** unpaid interest is added to principal on each compounding date. **Compounding dates** can be:
      - **From the start date** (default): anniversaries of the start date. For a start on 31 Jan, monthly dates are 28/29 Feb, 31 Mar, and so on.
      - **Calendar period ends:** interest to each month/quarter/year end joins the principal from the 1st of the next month, i.e. 1 Jan/Apr/Jul/Oct for quarterly, or 1 Jan for yearly.
    - **Daily:** `principal × ((1 + rate ÷ year days)^days − 1)` within each period.
    - **Continuous:** `principal × (e^(rate × days ÷ year days) − 1)` within each period.

    Results compare the compounded interest with the same calculation as simple interest. On a compounding date, interest is added to principal first, then principal added later, then payments.
  - **Switch to a different rate from a date:** e.g. prime + 1% before judgment, then the judgment rate after. The new rate (judgment, prime + spread, or fixed) applies from the switch date. Rows show each period's own rate, and the rates-used list labels each rate with its kind.
  - **Currency:** HKD by default, USD by default for the US prime rate; or RMB, the other G10 currencies (EUR, JPY, GBP, CHF, CAD, AUD, NZD, SEK, NOK) or any symbol you type. Amounts on the page and in every download use its symbol (HK$, US$, CN¥, €, JP¥, £, C$, A$, NZ$; codes for CHF, SEK and NOK). Once chosen, it doesn't change with the rate.

- **Cash flows:** principal added later and payments received sit together in a collapsible **Cash flows** pane, which shows a count (e.g. "1 principal added, 2 payments") while closed and opens by itself for a link that has any.
- **Principal added later:** further principal such as costs, each with a date, an amount and an optional description. From its date, each amount joins the principal and earns interest at the same rate. On a day with both, the principal is added before any payment, so the payment can clear it. Amounts dated outside the calculation period are ignored with a warning.
- **Icon and link preview:** a calculator icon for browser tabs and the iPhone home screen, plus a preview card (title, description, image) when the link is shared. After changing `site/favicon.svg` or the preview wording, run `npm run images`.

- **Partial payments:** add any number of payments (date + amount). Choose how they're applied:
  - **Interest first, then principal** (default): each payment clears accrued unpaid interest, and the rest reduces the principal.
  - **Principal first, then interest.**

  Interest stays simple either way: unpaid interest never earns interest. A payment on a date counts from that day. Payments before the start date, or on or after the end date, are ignored with a warning, and any overpayment is flagged. The results show a payments table and the outstanding principal plus unpaid interest. The exports include these too; in Excel, each period's interest uses that period's principal as a live formula.

- **Daily interest thereafter:** principal × the rate in force on the end date ÷ that day's year days. Under Actual/Actual it shows two figures, ÷ 365 for a normal year and ÷ 366 for a leap year, on the page and in every download. Use it for wording like "…plus HK$219.18 per day until payment". It appears on the page and in the Word, PDF and Excel files; in Excel it's a live formula.

- **Download PDF:** downloads a report straight away (built in the browser with [jsPDF](https://github.com/parallax/jsPDF)): inputs, results, the formula for each period, the rates used, and the sources as named, clickable links. No raw URLs are printed.
- **Sortable rate table:** click **Effective date** or **Rate** to sort; click again to reverse. The PDF and Excel exports use the same order.
- **Shareable link:** the inputs are stored in the page address (e.g. `?src=prime&p=1000000&from=2026-01-01&to=2026-09-30&basis=act%2Fact&round=total&spread=1`). **Copy link** copies it.
- **Excel export:** the Excel file uses live formulas and has a second sheet with the rate sources.
- **Word export:** the interest schedule as a table worded like a statutory demand, one row per period: "(i) Interest on the sum of HK$… at the rate of …% per annum from … to … (n days)", the working ("(i.e. principal × rate × days ÷ 365 = amount)") and the amount, then the total, a summary (principal, any principal added or payments, interest, total amount due at the end date) and the daily interest from the end date until payment. Ready to paste into a court document.
- **Today's rates in the header:** under "Rates updated as at…", the judgment debt rate, HSBC prime, US prime, and 1-month and 3-month HIBOR, each in the same style: name, rate in force today (3 decimals, or more when published with more, like HIBOR's 5) and the date it applies from.
- **Word calculation inputs:** the Word file starts with a "Calculation inputs" block (rate, principal, dates, day count, rounding and any compounding or cash flows) above the table, so it explains itself when sent on.
- **Word source note:** the Word file ends with a short note naming where the rates came from and when they were checked, e.g. "Source of rates: HK Judiciary: interest rates on judgment debts (as at 5 October 2026)." There's none for a fixed rate.
- **Recent calculations:** the last 5 calculations you ran (any tab) are kept automatically in a "Recent calculations" list, in your browser only; open one, save it to keep it, or clear the list ("Clear recent calculations"; saved calculations stay). The sample run when the page opens isn't recorded.
- **Help:** a "?" next to each Advanced setting, "Apply payments to" and the End date shows a short explanation; tap again to hide it.
- **Saved calculations:** **Save** (on either tab) keeps the calculation's link and a name in your browser's local storage, never uploaded. The **Saved calculations** card lists them, newest first: rename, open or delete. Up to 50 are kept.
- **Rounding:** **Total** rounds only the total (rows are added unrounded); **Per row** rounds each row of the table to cents first. The second option makes the rows add up exactly to the total.

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
| `site/calc.js` | The calculation, a pure function ported from the VBA macro. `test/excel-parity.test.mjs` checks it against a line-by-line port of the workbook's macro: the workbook's last saved result, its 104 judgment rates (all on the site, unchanged), and 6,000+ random and edge cases (leap years, year ends, rate changes, HK$0.01 to about HK$1bn), which must agree to the cent |
| `site/index.html`, `app.js`, `style.css` | Static web UI. Amounts are shown as `xxx,xxx.xx`, and a spread is shown as `base + spread = rate`. |
| `site/interest-text.js` | Interest tab wording: rate and setting names, each period's working and note, the daily interest text (no page access, so it's unit-tested) |
| `site/cash-flows.js` | Interest tab cash flows: payment and principal-added rows |
| `site/interest-exports.js` | Interest tab downloads: Word, PDF and Excel |
| `site/export-xlsx.js` | Excel export. The **Calculation** sheet has live formulas (days, base + spread, `principal × rate × days ÷ year days`, totals). The **Rates** sheet has the source URL and the rates used. |
| `site/vendor/xlsx.mini.min.js` | SheetJS 0.20.3 mini build (Apache-2.0), loaded only when you click Download Excel. It's copied from `node_modules/xlsx/dist/`. |
| `site/saved.js` | Saved calculations (browser storage) |
| `site/export-docx.js` | Word export. Writes the `.docx` (a zip of a few XML files) directly, so it needs no library. |
| `site/export-pdf.js`, `site/vendor/jspdf*.js` | PDF report, using jsPDF 4 and jsPDF-AutoTable 5 (both MIT). They load only when you click Download PDF and are copied from `node_modules`. |
| `site/rates.json` | Judgment debt rates scraped from the Judiciary site |
| `site/hibor.json`, `hibor-3m.json` | 1-month and 3-month HIBOR fixings since 1996: history from the HKMA API, and the recent days HKMA hasn't republished yet from [HKAB](https://www.hkab.org.hk/en/rates/hibor), which sets them each business day at 11:15 HKT (a few days overlap, as a cross-check). `scripts/backfill-hibor.mjs` fills in older history in small batches, saving after each one (rerun it to carry on). The daily update merges in recent fixings and fetches a few older pages per run until the history reaches 1996. Every download has a time limit, and the job is capped at 20 minutes. These are optional sources: an outage only logs a warning. |
| `site/mortgage.js`, `mortgage-app.js`, `mortgage-export.js` | Mortgage calculation, tab and exports |
| `site/tvm.js`, `tvm-app.js` | Time Value of Money calculator: N, I/Y, PV, PMT, FV (PV tab) |
| `site/inflation.js`, `inflation-app.js`, `cpi.json` | Inflation tab and the HK Composite CPI history (C&SD) |
| `scripts/parse-cpi.mjs`, `update-cpi.mjs` | CPI download, checks and `site/cpi.json` writer, run by the daily update |
| `site/pv.js`, `pv-app.js`, `pv-export.js` | Present value calculation, tab and downloads. `test/pv-export.test.mjs` runs the Excel formulas for every compounding and day count basis and checks they give the page's figures |
| `site/shared.js`, `tabs.js` | Helpers shared by the tabs; tab switching |
| `site/ui-motion.js` | The sliding highlight on segmented controls and the open/close animation of collapsible sections (off with Reduce Motion) |
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
