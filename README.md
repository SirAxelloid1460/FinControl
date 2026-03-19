# FinControl 💶

Personal finance PWA — tracks income, expenses, debts, investments and savings account with Google Sheets sync.

## Features

- **Dashboard** — payroll-period balance, annual forecast, debt tracker
- **Statistics** — monthly income/expenses charts by payroll period
- **History** — BAWAG CSV import with automatic transaction matching
- **Records** — recurring entries (income, monthly, annual, debts) + current month expenses
- **Patrimonio** — net worth, Revolut CSV import, live investment prices via Finnhub
- **Ahorro** — Revolut savings account with compound interest tracking and projections
- **Estado de cuenta** — real running bank balance with estimated charges (interest + maintenance fee)

## Tech Stack

- Vanilla HTML/CSS/JS — no build step, no dependencies
- Google Sheets via Apps Script (JSONP GET + no-cors POST)
- Finnhub API for live stock/ETF/crypto prices
- exchangerate-api.com for EUR conversion
- PWA — installable on Android/iOS

## File Structure

```
index.html   — app shell + HTML layout
style.css    — all styles
app.js       — all logic (~120KB)
```

## Deploy — GitHub Pages

1. Create a new GitHub repository (public)
2. Upload `index.html`, `style.css`, `app.js`, `README.md`
3. Go to **Settings → Pages**
4. Source: **Deploy from a branch** → branch `main` → folder `/root`
5. Save — your app will be live at `https://USERNAME.github.io/REPO/`

> The app works entirely client-side. No server, no build step needed.

## Google Sheets Sync

Set your Apps Script URL in `app.js`:
```js
const GAS_URL = "https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec";
```

## Configuration

Open the app → ⚙ Config in the Estado de cuenta card to set:
- Annual interest rate (e.g. 12.5%)
- Overdraft rate (e.g. 17%)  
- Maintenance fee thresholds (e.g. €2 / €5.90 at €500 threshold)
