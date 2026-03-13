# Database on Vercel (read-only filesystem)

On **Vercel**, the serverless filesystem is **read-only**. The app is built to **not crash** when writes fail:

- **Predictions** (`predictions.json` or SQLite): writes are wrapped in try-catch; failed writes are skipped and the server returns 200.
- **Backtests** (`backtests.jsonl`): append is wrapped in try-catch; no 500 on write failure.
- **Strategy insights** (`strategy-insights.json`): saves are wrapped in try-catch; no 500 on write failure.

So the site will **run** on Vercel with `DB_DRIVER=file` or `sqlite`, but **predictions and backtests will not persist** (each request may see empty or stale data).

## To persist data on Vercel

Use a **hosted database** and set:

1. **`DB_DRIVER=postgres`**
2. **`DATABASE_URL`** = connection string from your provider.

Options:

- **Vercel Postgres** (recommended, free tier): In Vercel dashboard → Storage → Create Database → Postgres. Copy `POSTGRES_URL` into `DATABASE_URL` in Environment Variables.
- **Upstash** (serverless Redis): for rate-limiting/cache; predictions still need Postgres or another SQL DB if you use the existing repo interface.
- **Any Postgres host** (e.g. Neon, Supabase, Railway): create a DB, get the connection string, set `DATABASE_URL`.

After setting `DB_DRIVER=postgres` and `DATABASE_URL`, run the app (and any migrations) so predictions and evaluations are stored in the hosted DB instead of the local filesystem.

## Environment separation (Neon / Vercel)

- **Vercel**: In Project Settings → Environment Variables, ensure `DATABASE_URL` points to the correct Neon project. Use separate Neon projects (or branches) per environment (e.g. Preview vs Production) so that "Mon Chéri" production and other systems do not share the same DB.
- **Neon**: Create one project per app/environment; attach the pooler connection string to `DATABASE_URL` in Vercel to avoid "Too many connections" under load.
