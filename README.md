# Budget planner

A personal budget planner for web, iPhone and Android, built with Expo (one codebase for all three).

## What it does

- **Forecast vs actual.** Plan what you expect to spend each month (Budget tab), record what you actually spent (Spending tab), and compare them on the Overview tab.
- **Categories:** Essentials, Frivolous, Subscriptions, Utility bills, Taxes. Rename them or change their default type in Settings.
- **Every item has a type:**

  | Type | Meaning | Default for |
  |---|---|---|
  | Recurring, fixed | Same amount every month | Subscriptions, rent |
  | Recurring, variable | Every month, amount changes | Essentials, utility bills |
  | One-time, variable | Unplanned, any amount | Frivolous spending |
  | One-time, fixed | Known lump sum in one month | Taxes (e.g. an IRS settlement) |

- **Charts:** forecast vs actual by category and by type, share of spending by category, and a 6-month forecast vs actual trend.
- **Revolut import:** in the Revolut app, go to your account → Statement → Excel/CSV, then use *Import Revolut CSV* on the Spending tab. Top-ups, income, currency exchanges and pending payments are skipped, refunds reduce spending, and importing the same file twice adds nothing. Common merchants are sorted into categories automatically; sort the rest once and the app remembers.
- **Automatic Revolut sync** through Enable Banking, via a Supabase Edge Function. Setup: [docs/revolut-sync.md](docs/revolut-sync.md).

Data is stored on the device only (browser storage on web).

## Run it

```bash
npm install
npm run web        # in the browser
npx expo start     # then scan the QR code with Expo Go on your phone
```

## Checks

```bash
npm test           # logic tests (forecasting, CSV import, categorisation)
npm run typecheck
```

## Code layout

- `src/lib/` – plain TypeScript: types, default categories, forecast/actual maths, Revolut CSV parser, and the app state store.
- `src/components/charts.tsx` – the charts (react-native-svg, works on web and mobile).
- `src/app/` – the four screens: Overview, Budget, Spending, Settings.
- `supabase/` – the Revolut sync Edge Function and its database migration.

## Next

- Sync budget data across devices (Supabase).
