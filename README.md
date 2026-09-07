# BondStats Bond Market Calendar

Standalone repository for the BondStats live fixed-income calendar.

## Recommended repository name

`bondstats-bond-market-calendar`

## What is live

The GitHub Action refreshes the calendar every 4 hours and can also be started manually.

Current official-source parsers:

- Federal Reserve — FOMC meeting dates
- European Central Bank — monetary-policy meetings
- Bank of England — MPC dates
- Bank of Japan — monetary-policy meetings
- U.S. Bureau of Labor Statistics — CPI and Employment Situation / NFP
- U.S. Treasury — announced coupon auctions
- U.S. Treasury — quarterly borrowing estimates and refunding announcements

No API key is required.

## Data file

`data/bond-market-calendar.json`

The collector is fail-soft: if one official source temporarily fails, the most recent valid events from that source remain in the JSON and the source is marked `fallback`.

## GitHub Actions

Workflow:

`.github/workflows/update-bond-market-calendar.yml`

Schedule:

Every 4 hours (`17 */4 * * *`) plus manual `workflow_dispatch`.

The workflow validates the JSON and commits changed calendar data back to the repository.

## First run

After uploading the repository to GitHub:

1. Open **Actions**
2. Open **Update Bond Market Calendar**
3. Click **Run workflow**
4. Confirm that `data/bond-market-calendar.json` receives a new `generatedAt` timestamp and source-health statuses

## Optional GitHub Pages preview

In **Settings → Pages** choose:

- Source: **Deploy from a branch**
- Branch: **main**
- Folder: **/(root)**

The standalone `index.html` will then render the live JSON directly.

## Later BondStats integration

Keep this repository as the source-of-truth/data pipeline.

The later BondStats site patch should consume the raw JSON from this repo rather than duplicating the scraping logic inside `bondstats-site`.

Suggested raw URL after the GitHub repository exists:

`https://raw.githubusercontent.com/Botapi33/bondstats-bond-market-calendar/main/data/bond-market-calendar.json`

This separation keeps the main Astro site safer: GitHub Actions and source parsing remain isolated in the standalone repository while BondStats only reads the generated JSON.
