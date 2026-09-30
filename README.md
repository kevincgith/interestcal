# HK Judgment Debt Interest Calculator

This tool calculates simple interest on Hong Kong judgment debts using the rates the
[HK Judiciary publishes](https://www.judiciary.hk/en/court_services_facilities/interest_rate.html).
It is a web version of the `Interest Calculator.xlsm` workbook.

## How interest is calculated

- Each published rate applies from its effective date up to, but not including, the next rate's effective date.
- The start date earns interest and the end date does not. For example, 1 Jan → 2 Jan is **1 day** at the rate effective on 1 Jan.
- Periods are split at 1 January. Each day uses its own year's basis: **366** in a leap year, **365** otherwise. This follows HK court practice.
- Interest for each period is `principal × rate × days ÷ basis`. The total is the sum of the unrounded period amounts.
- The latest published rate keeps applying after its effective date.
- Days before the earliest published rate (currently 1 Jul 2000) earn no interest, and the page shows a warning when that happens.

## Project layout

| Path | Purpose |
|---|---|
| `site/calc.js` | The calculation, a pure function ported from the VBA macro |
| `site/index.html`, `app.js`, `style.css` | Static web UI with a CSV export |
| `site/rates.json` | Rate table scraped from the Judiciary site |
| `scripts/fetch-rates.mjs` | Scrapes and validates the rates, and rewrites `rates.json` only when they change |
| `test/` | Tests, including the workbook's saved example (HK$135,436.48, 24 Nov 2025 → 20 Apr 2026 = HK$4,434.64) |
| `.github/workflows/pages.yml` | Refreshes the rates weekly and deploys to GitHub Pages |

There are no runtime dependencies and no build step. You need Node 20 or later to run the tests and the scraper.

## Development

```bash
npm test             # run the tests
npm run fetch-rates  # refresh site/rates.json from the Judiciary site
npm start            # serve site/ locally
```

## Deployment

1. Push to GitHub on the `main` branch.
2. Go to **Settings → Pages** and set the **Source** to **GitHub Actions**.
3. Every push to `main` deploys the site. The weekly schedule, which you can also start manually from the Actions tab, re-scrapes the rates, commits any change and redeploys.

If the Judiciary changes its page layout, the scraper's validation fails the workflow instead of overwriting good data with bad.
