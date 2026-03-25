# דוח מיגרציה מלאה: SQLite → Vercel Postgres

**תאריך:** מרץ 2025  
**פרויקט:** Mon Cheri Quant AI  
**מטרה:** הסרת כל השימוש ב־SQLite מקומי והעברת שכבת האחסון כולה ל־Vercel Postgres.

---

## 1. סיכום ביצוע

בוצעה מיגרציה מלאה של שכבת מסד הנתונים בתיקייה `lib/db/`. **כל השימוש ב־SQLite (better-sqlite3) הוסר.** האחסון הקבוע מתבצע כעת אך ורק מול **Vercel Postgres** באמצעות החבילה `@vercel/postgres` (פונקציית `sql` ותבניות שאילתות).

---

## 2. טבלאות המאוחסנות כעת ב־Vercel Postgres

| טבלה | תיאור | מודול |
|------|--------|--------|
| **simulation_trades** | עסקאות סימולציה (Paper Trading) — ארנק ו־P&L נגזרים מהטבלה; אין איפוס ברענון. | `lib/db/simulation-trades.ts` |
| **ai_learning_ledger** | זיכרון ארוך טווח ל־AI — תחזית מול מציאות, שולי שגיאה, מסקנות; משמש ל־Retrospective וללמידה מתמשכת. | `lib/db/ai-learning-ledger.ts` |
| **backtest_logs** | לוג דוחות בקטסט — היסטוריית הערכות תחזיות; דוחות שורדים cold starts ב־Vercel. | `lib/db/backtest-repository.ts` |
| **prediction_weights** | משקלות דינמיות (Volume, RSI, Sentiment) לנוסחת P_success. | `lib/db/prediction-weights.ts` |
| **system_configs** | הגדרות מערכת — משקלות פעילות, סף ידני (ai_threshold_override), עדכון אחרון. | `lib/db/prediction-weights.ts` |
| **weight_change_log** | יומן שינויי משקלות (Log Lessons) — סיבות לעדכון לאודיט. | `lib/db/prediction-weights.ts` |
| **accuracy_snapshots** | צילומי דיוק לפי תאריך — מגמות Learning Progress. | `lib/db/prediction-weights.ts` |
| **virtual_portfolio** | תיק סימולציה וירטואלי — פוזיציות פתוחות/סגורות, Take-Profit, Stop-Loss. | `lib/db/virtual-portfolio.ts` |
| **deep_analysis_logs** | לוגי ניתוח עמוק — תוצאות Deep Analysis לאודיט וללולאת למידה. | `lib/db/deep-analysis-logs.ts` |
| **scanner_alert_log** | התראות סורק — ג'מים שאותרו, dedup 4h, "ג'מים היום". | `lib/db/scanner-alert-log.ts` |
| **learning_reports** | דוחות "לקחים שנלמדו" (Retrospective) — סיכומים בעברית. | `lib/db/learning-reports.ts` |
| **historical_predictions** | תחזיות שאומתו — feedback loop, דיוק לפי confidence, בקטסט. | `lib/db/historical-predictions.ts` |

בנוסף, טבלאות קיימות של הפרויקט (`prediction_records`, `settings`) ממשיכות לעבוד עם Postgres דרך `lib/db.ts` ו־`lib/db/postgres-repository.ts` (Neon/Vercel).

---

## 3. הסרת SQLite

- **קובץ שנמחק:** `lib/db/sqlite-repository.ts` — הוסר לחלוטין.
- **תלות שהוסרה:** `better-sqlite3` הוסר מ־`package.json`.
- **בדיקות ותנאים:** כל התנאים מסוג `DB_DRIVER=sqlite` ו־`process.env.VERCEL` הוחלפו ב־`APP_CONFIG.postgresUrl?.trim()` (או `POSTGRES_URL` / `DATABASE_URL`). כאשר אין חיבור Postgres, הפונקציות מחזירות ערכי ברירת מחדל (מערכים ריקים, null וכו') ללא קריאה ל־SQLite.

---

## 4. תאימות Postgres

- **מזהים אוטומטיים:** `INTEGER PRIMARY KEY AUTOINCREMENT` (SQLite) הוחלף ב־`SERIAL PRIMARY KEY` או `BIGINT` עם `RETURNING id`.
- **תאריכים:** שימוש ב־`TIMESTAMPTZ` / `TIMESTAMP` (לא DATETIME).
- **מספרים:** שימוש ב־`NUMERIC`/`DECIMAL` או `DOUBLE PRECISION` לפי הצורך.
- **מחרוזות:** `TEXT` / `VARCHAR`.
- **פרמטרים:** שאילתות מבוצעות דרך תג התבנית `sql`...`` של `@vercel/postgres` (עם interpolation מאובטח), ללא `?` bindings.

---

## 5. זיכרון ארוך טווח של ה־AI

טבלת **ai_learning_ledger** מאחסנת באופן קבוע:

- `prediction_id`, `timestamp`, `symbol`
- `predicted_price`, `actual_price`, `error_margin_pct`
- `ai_conclusion`, `created_at`

המנוע הרטרוספקטיבי (`lib/ai-retrospective.ts`) מסנכרן תחזיות שאומתו מ־`historical_predictions` ל־`ai_learning_ledger` ומשתמש בנתונים האלה ללמידה מתמשכת. **הזיכרון ארוך הטווח של ה־AI נשמר כעת ב־Vercel Postgres ואינו תלוי בדיסק מקומי או ב־SQLite.**

---

## 6. API ו־Callers שעודכנו

- **סימולציה:** `app/api/simulation/trades`, `reset`, `summary` — משתמשים ב־Postgres בלבד; ה־SimulationContext ו־PnlTerminal טוענים trades מ־Postgres לאחר רענון.
- **בקטסט:** `app/api/backtest/analytics` — קורא מ־`historical_predictions` ו־`listBacktests()` (מ־Postgres כש־postgresUrl מוגדר).
- **Retrospective:** `app/api/retrospective/insights`, `app/api/cron/retrospective` — `getLearningProgress`, `runRetrospectiveAndReport` וכל פונקציות ה־ledger/weights/reports הן async ומשתמשות ב־Postgres.
- **תיק וירטואלי:** `app/api/portfolio/virtual` — פתיחה/סגירה ו־GET משתמשים ב־`simulation-service` ו־`virtual-portfolio` מול Postgres.
- **טלגרם:** `app/api/telegram/webhook` — סטטוס, אסטרטגיה, תיק, ניתוח עמוק ו־alerts משתמשים בפונקציות async מול Postgres.
- **מדדים:** `app/api/ops/metrics` — `listHistoricalPredictions` מופעל כ־async.
- **Workers:** `lib/workers/market-scanner.ts`, `lib/workers/daily-reporter.ts` — `insertScannerAlert`, `getSymbolsAlertedSince`, `countScannerAlertsSince` מופעלים עם `await`.

---

## 7. אימות

- **Build:** `npm run build` הושלם בהצלחה לאחר המיגרציה.
- **לינט:** לא נמצאו שגיאות לינט בקבצי `lib/db/` ובנתיבי ה־API הרלוונטיים.

---

**מסקנה:** שכבת האחסון ב־`lib/db/` פועלת כעת **רק מול Vercel Postgres**. באג האיפוס של ארנק הסימולציה וה־P&L ברענון טופל, וזיכרון ה־AI (ai_learning_ledger) ובקטסט (backtest_logs) נשמרים לצמיתות בסביבת serverless.
