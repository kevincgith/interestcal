# HK Judgment Debt Interest Calculator

This tool calculates simple interest on Hong Kong debts. It is a web version of the `Interest Calculator.xlsm` workbook.

You can choose one of two rates:

- **Judgment debt rate**, as [published by the HK Judiciary](https://www.judiciary.hk/en/court_services_facilities/interest_rate.html). This is the default.
- **HSBC best lending (prime) rate**, taken from [HKMA Monthly Statistical Bulletin table 6.4.1](https://www.hkma.gov.hk/media/eng/doc/market-data-and-statistics/monthly-statistical-bulletin/T060401.xls). You can add a spread over prime, e.g. prime + 2%.

## How interest is calculated

- Each published rate applies from its effective date up to, but not including, the next rate's effective date.
- The start date earns interest and the end date does not. For example, 1 Jan → 2 Jan is **1 day** at the rate effective on 1 Jan.
- Periods are split at 1 January. Each day uses its own year's basis: **366** in a leap year, **365** otherwise. This follows HK court practice.
- Interest for each period is `principal × rate × days ÷ basis`. The total is the sum of the unrounded period amounts.
- The latest published rate keeps applying after its effective date.
- Days before the earliest published rate earn no interest, and the page shows a warning when that happens. The earliest rates are currently 1 Jul 2000 for the judgment rate and 5 May 1971 for prime.
- Prime rates change on any date, not just at quarter starts, and the same rules apply. Some dates in the HKMA table record only a deposit-rate change; those rows are dropped, so every row kept is a real prime change.

## Project layout

| Path | Purpose |
|---|---|
| `site/calc.js` | The calculation, a pure function ported from the VBA macro |
| `site/index.html`, `app.js`, `style.css` | Static web UI with a CSV export |
| `site/rates.json` | Judgment debt rates scraped from the Judiciary site |
| `site/prime-rates.json` | HSBC prime rates parsed from the HKMA spreadsheet |
| `scripts/fetch-rates.mjs` | Fetches and validates both sources, and rewrites a JSON file only when its rates change |
| `scripts/parse-judiciary.mjs`, `parse-prime.mjs` | Parsers for each source |
| `test/` | Tests, including the workbook's saved example (HK$135,436.48, 24 Nov 2025 → 20 Apr 2026 = HK$4,434.64) |
| `.github/workflows/pages.yml` | Refreshes the rates daily and deploys to GitHub Pages |

The website itself has no dependencies and no build step. The rate updater uses [SheetJS](https://sheetjs.com) to read the HKMA `.xls` file. You need Node 20 or later to run the tests and the updater.

## Development

```bash
npm install          # install SheetJS for the updater
npm test             # run the tests
npm run fetch-rates  # refresh both rate files
npm start            # serve site/ locally
```

## Deployment

1. Push to GitHub on the `main` branch.
2. Go to **Settings → Pages** and set the **Source** to **GitHub Actions**.
3. Every push to `main` deploys the site. A daily schedule (09:00 HKT) re-fetches both rate sources, commits any change and redeploys only when something changed. You can also start it manually from the Actions tab, and a manual run always redeploys.

If either source changes its layout, validation stops that source from overwriting good data. The other source still updates, and the workflow is marked as failed so GitHub emails you.
