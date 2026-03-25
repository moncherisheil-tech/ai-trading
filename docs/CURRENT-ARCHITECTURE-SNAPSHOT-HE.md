# צילום ארכיטקטורה נוכחי — Mon Chéri Quant AI

**תאריך:** 14 במרץ 2025  
**מטרה:** תיעוד read-only של מצב המערכת הנוכחי כ־"Blueprint" לפני מעבר ל־Multi-Agent (Claude).  
**סטטוס:** ללא שינוי קוד — ניתוח ותיעוד בלבד.

---

## 1. מנוע ה-AI ומנגנון Fallback

### 1.1 מבנה צינור הניתוח (`lib/analysis-core.ts`)

- **כניסה:** סימבול נקי (למשל `BTCUSDT`), חותמת זמן, דגל שימוש ב-cache, ואופציות (למשל `skipGemAlert`).
- **מקורות נתונים (מקביל):**
  - **Binance:** `GET /api/v3/klines` (24 קנדלים יומיים). במקרה 451 (חסימת אזור) — fallback ל־`APP_CONFIG.proxyBinanceUrl` אם מוגדר; אחרת זורק `DATA_UNAVAILABLE_451`.
  - **Fear & Greed:** `https://api.alternative.me/fng/?limit=1` (force-cache). כישלון → אובייקט ברירת מחדל `{ value: '50', value_classification: 'Neutral' }`.
  - **סנטימנט:** `getMarketSentiment(symbol)` מ־`lib/agents/news-agent`. כישלון → `{ score: 0, narrative: 'No news-based sentiment available.' }`.
- **חישובים מקומיים:** RSI-14, תנודתיות, נפח דלתא, `riskFactor`. משקל אסטרטגיות מאושרות מ־`listStrategyInsights()` (Postgres).
- **Feedback loop:** טעינת `past_mistakes_to_learn_from` מ־`getDbAsync()` (חיזויים עם `status === 'evaluated'` ו־`error_report`), ו־`historical_prediction_outcomes` מ־`getHistoricalBySymbol(cleanSymbol, 10)` — רק כאשר Postgres זמין (`historical_predictions` ב־Vercel Postgres).
- **Guardrail סנטימנט:** `checkSentimentGuardrail(sentiment_score)`. אם לא `NORMAL` — שליחת התראת טלגרם ו־**הורדת הסתברות ל־50%** (`result.probability * 0.5`).
- **קריאת Gemini:** `GoogleGenAI` עם `responseMimeType: 'application/json'` ו־`responseSchema` קבוע. Timeout: `APP_CONFIG.geminiTimeoutMs` (ברירת מחדל 60 שניות) דרך `withGeminiTimeout`.

### 1.2 מודלי Gemini — Primary ו־Fallback

| תפקיד | משתנה סביבה | ברירת מחדל |
|--------|-------------|------------|
| **ראשי** | `GEMINI_MODEL_PRIMARY` | `gemini-2.5-flash` |
| **Fallback כשהתשובה ריקה** | `GEMINI_MODEL_FALLBACK` | `gemini-2.5-flash` |
| **Fallback ל־429 (מכסה)** | `GEMINI_MODEL_QUOTA_FALLBACK` | `gemini-2.5-flash` |

### 1.3 לוגיקת 429 / Fallback (ללא 404)

- **זיהוי 429:** הפונקציה `isQuotaExhaustedError(err)` בודקת: `code === 429`, `status === 429`, או regex על הודעת השגיאה: `/429|RESOURCE_EXHAUSTED|quota|rate limit/i`. **אין טיפול ייעודי ב־404** — 404 לא מפעיל fallback.
- **זרימה:**
  1. ניסיון ראשון עם **primary**.
  2. אם נזרקת שגיאת 429 → מעבר ל־**quotaFallbackModel** (למשל `gemini-2.5-flash`). אם גם הוא מחזיר 429 → זורק `QUOTA_EXHAUSTED_429`.
  3. אם התשובה חוזרת **בלי `response.text`** (גם ללא 429) → מעבר ל־**fallbackModel** (למשל `gemini-2.5-pro`) וניסיון נוסף.
  4. אם עדיין אין טקסט → `throw new Error('No response from AI')`.
- **תיקון עקביות:** אם `validatePredictionConsistency` מזהה אי-התאמה (למשל Bullish עם `target_percentage` שלילי), מתבצעת קריאת "repair" ל־Gemini עם אותו `activeModel` (כולל אם כבר ב-fallback).

### 1.4 Cache ו־Persistence

- **Dedup cache בזיכרון:** `analysisDedupCache` (Map) — מפתח לפי סימבול, TTL `APP_CONFIG.analysisDedupWindowMs` (ברירת מחדל 30 שניות). מחזיר תוצאה שמורה בלי להריץ שוב.
- **שמירה:** לאחר הצלחה — `db.push(newRecord)` ו־`saveDbAsync(db)`. כאשר `DATABASE_URL` קיים, `getDbAsync`/`saveDbAsync` עובדים מול **Neon** דרך `PostgresPredictionRepository` (טבלת `prediction_records`, payload ב־JSONB).

---

## 2. שכבת DB והתמדה (Postgres / Neon)

### 2.1 שני צרכני Postgres

- **Neon (`lib/db.ts`):**
  - משמש את **חיזויים (prediction_records)** בלבד.
  - אתחול: `neon(process.env.DATABASE_URL)`.
  - `getDbAsync()` → `getPredictionRepository().getAllAsync()`; `saveDbAsync(rows)` → `repo.saveAllAsync(rows)`.
  - טבלה: `prediction_records (id, symbol, status, prediction_date, payload JSONB)`.
  - אם `DATABASE_URL` חסר — `getDbAsync` מחזיר `[]`, `saveDbAsync` לא עושה כלום.

- **Vercel Postgres (`@vercel/postgres`):**
  - נשלט על ידי `APP_CONFIG.postgresUrl` = `process.env.DATABASE_URL || process.env.POSTGRES_URL`.
  - מודולים שתלויים ב־`postgresUrl`: `simulation_trades`, `ai_learning_ledger`, `historical_predictions`, `learning_reports`, `scanner_alert_log`, `deep_analysis_logs`, `virtual_portfolio`, `prediction_weights`, `backtest_repository` (וכיו"ב).

כלומר: **חיזויים** ב־Neon (או באותו connection string אם מצביע לאותו DB); **סימולציה, למידה, היסטוריה, אסטרטגיות** ב־Vercel Postgres (או באותו DB אם ה־URL זהה).

### 2.2 `simulation_trades` (סימולציה / Paper Trading)

- **קובץ:** `lib/db/simulation-trades.ts`.
- **תנאי שימוש:** `usePostgres()` = `Boolean(APP_CONFIG.postgresUrl?.trim())`. אם false — כל הפונקציות יוצאות מוקדם (לא כותבות, מחזירות מערך ריק).
- **טבלה:**  
  `simulation_trades (id TEXT PK, symbol, side CHECK IN ('buy','sell'), price, amount_usd, amount_asset, fee_usd, timestamp BIGINT, date_label)`.  
  אינדקס: `idx_simulation_trades_timestamp`.
- **API:**  
  - `GET /api/simulation/trades` — רשימת עסקאות (hydration ל־SimulationContext).  
  - `POST /api/simulation/trades` — הוספת עסקה (בדיקות ולידציה ב־route).  
  - `POST /api/simulation/reset` — מחיקת כל הרשומות.
- **חישוב ארנק:** יתרה התחלתית 10,000 USD; כל עסקה מיושמת לפי סדר `timestamp` (קנייה: הפחתת `amount_usd + fee_usd`, מכירה: הוספת `amount_usd - fee_usd`).

### 2.3 `ai_learning_ledger` (רטרוספקטיבה / זיכרון ארוך טווח)

- **קובץ:** `lib/db/ai-learning-ledger.ts`.
- **תנאי שימוש:** אותו `postgresUrl`; ללאיו — `insert` מחזיר false, שאילתות מחזירות `[]`.
- **טבלה:**  
  `ai_learning_ledger (id SERIAL, prediction_id UNIQUE, timestamp, symbol, predicted_price, actual_price, error_margin_pct, ai_conclusion, created_at)`.  
  אינדקסים: `timestamp`, `prediction_id`, `symbol`.
- **שימוש:** הכנסה אידיומפוטנטית (`ON CONFLICT (prediction_id) DO NOTHING`). סנכרון מהתחזיות ההיסטוריות מתבצע מתוך `runRetrospectiveAndReport()` — `syncHistoricalToLedger(historical)`.

### 2.4 מיגרציה ו־Schema

- **Neon:** `initDB()` ב־`lib/db.ts` יוצר `prediction_records` ו־`settings` אם חסרים (serverless-safe; לא זורק החוצה).
- **Vercel Postgres:** כל מודול קורא ל־`ensureTable()` / `ensureTable()` מקביל בתחילת פעולות כתיבה/קריאה — `CREATE TABLE IF NOT EXISTS` + אינדקסים. אין קובץ מיגרציה מרכזי; הסכמה מתפשטת מכל השירותים.

---

## 3. Frontend ו־UI/UX — מסוף המסחר

### 3.1 AppShell ו־SimulationProvider

- **`components/AppShell.tsx`:**
  - בנתיב `/login` — רינדור **רק** `children` (ללא Ticker, BottomNav, SimulationProvider).
  - בכל נתיב אחר: `CryptoTicker` → `main` → `SimulationProvider` → `PageTransition` → `children` → `BottomNav`.
- **`context/SimulationContext.tsx`:**
  - state: `selectedSymbol`, `walletUsd`, `trades[]`.
  - **Hydration:** ב־mount קורא `GET /api/simulation/trades` וממלא `trades` ו־`walletUsd` (חישוב מ־`computeWalletFromTrades`).
  - **addTrade:** ולידציה (יתרה, נכס זמין למכירה), בניית אובייקט עסקה, `POST /api/simulation/trades`, עדכון state מקומי.
  - **resetSimulation:** `POST /api/simulation/reset` + איפוס state ל־default.
  - **getMarkersForSymbol / getTradesForSymbol:** סינון לפי סימבול מתוך `state.trades`.

### 3.2 CryptoAnalyzer — מחיר חי מול מחיר כניסה

- **מחיר חי (WebSocket):**  
  חיבור ל־`wss://stream.binance.com:9443/ws/<symbol>@ticker`. שדה `c` = last price. עדכון `livePrice` ו־`livePriceConnected`. בעת החלפת סימבול — סגירת socket ופתיחה מחדש.
- **מחיר לתצוגה ולסימולציה:**  
  `displayPrice = livePrice ?? entryPrice` כאשר `entryPrice = latestPrediction?.entry_price ?? 0`.  
  כלומר: אם יש מחיר חי — משתמשים בו; אחרת — מחיר הכניסה של התחזית האחרונה (סטטי).
- **סימולציה:** כפתורי "קנה" / "מכור" קוראים ל־`addTrade(symbol, side, displayPrice, amount)`. העסקה נשמרת עם המחיר הנוכחי (חי או כניסה) ומופיעה ב־"היסטוריית סימולציה" ובגרף כ־`executionMarkers` (מ־`getMarkersForSymbol`).

### 3.3 הצגת עסקאות סימולציה

- **ב־CryptoAnalyzer:** בלוק "היסטוריית סימולציה — {symbol}" מציג עד 20 עסקאות מ־`getTradesForSymbol(symbol)` (מהקונטקסט), עם כיוון (קנייה/מכירה), סכום, מחיר, `dateLabel`.
- **ב־PnlTerminal:**  
  - נתוני P&amp;L העיקריים מגיעים מ־`/api/ops/metrics/pnl` (backtest על תחזיות שאומתו).  
  - בנוסף, קריאה ל־`GET /api/simulation/summary` — מחזירה `walletUsd`, `trades`, `positions` (עם מחיר נוכחי מ־Binance), `totalUnrealizedPnlUsd`.  
  - בלוק "סימולציה (Paper Trading) — נתונים נשמרים במסד" מציג יתרה, רווח/הפסד לא ממומש, פוזיציות פתוחות ו־20 עסקאות אחרונות.  
  - **הערה:** הטקסט "שמירת סימולציה זמינה כאשר DB_DRIVER=sqlite" ב־PnlTerminal אינו תואם את הקוד: הסימולציה בפועל פועלת כאשר **postgresUrl** (Vercel Postgres) מוגדר, לא דווקא sqlite.

### 3.4 גרף והיסטוריה

- **PriceHistoryChart:** מקבל `chartData` (תאריך + close) ו־`executionMarkers` (קנה/מכור, מחיר, תאריך) — סימון על גרף ה־OHLCV.
- **היסטוריית חיזויים:** טעינה מ־`getHistory()` (server action שמחזירה חיזויים מ־getDbAsync), גלילה עם windowing (spacer עליון/תחתון), כפתור "טען עוד".

---

## 4. אבטחה, Cron ו־Webhooks

### 4.1 Middleware — Total Lockdown

- **קובץ:** `middleware.ts`.
- **Whitelist (ללא עוגיה):**  
  `/login`, `/api/telegram/webhook`, `/manifest.json`, `/icons/*`, `/_next/*`, `/favicon.ico`, `/icon`, `/apple-icon`, `/api/auth/login`, `/api/auth/logout`.
- **כל נתיב אחר:** דורש עוגיית `app_auth_token` (ערך לא ריק). חסר → redirect ל־`/login?from=<pathname>`.
- **הערה:** ה־middleware **לא** בודק חתימה או תוכן ה־token; אימות החתימה (HMAC וכו') מתבצע בצד שרת (למשל ב־`verifySessionToken`).

### 4.2 Webhook טלגרם

- **נתיב:** `POST /api/telegram/webhook`.
- **גישה:** ברשימת הלבנה של ה־middleware — **לא** דורש עוגיה. מתאים לדרישת טלגרם (גישה משרתי טלגרם ללא cookies).
- **אימות:** רק עדכונים מ־`chat.id` ששווה ל־`TELEGRAM_CHAT_ID` מעובדים; אחרת מחזירים `200` עם `ok: true` בלי פעולה.
- **פקודות טקסט:** `/status`, `/analyze [SYMBOL]`, `/strategy`, `/portfolio`, `/help` — מנותבות ל־handlers; התשובה נשלחת ל־chat באותו עדכון.
- **Callback (כפתורים):**  
  - `sim_confirm` (GEM_CALLBACK_PREFIX_CONFIRM): פתיחת עסקה וירטואלית ב־`openVirtualTrade`.  
  - `deep:<symbol>`: ניתוח עמוק + `insertDeepAnalysisLog` (אם יש postgresUrl) + שליחת דוח לטלגרם.  
  - `ignore:` — רק אישור.
- **תלות ב־DB:** `/portfolio`, `/strategy`, ספירת ג'מים ל־`/status` דורשים `APP_CONFIG.postgresUrl`; בלעדיו מוחזרת הודעת שגיאה מתאימה.

### 4.3 Cron — איך מאובטחים ומופעלים

- **אימות:** בכל נתיבי ה־cron נבדק `CRON_SECRET` או `WORKER_CRON_SECRET`:  
  `Authorization: Bearer <secret>` או query `?secret=<secret>`.  
  אם ה־secret שמועבר שונה מה־secret המוגדר או חסר — **401 Unauthorized**.
- **נתיבים:**
  - **GET /api/cron/scan**  
    קורא ל־`runOneCycle()` (market-scanner): cache ג'מים, מאקרו, סף ביטחון, סריקת סימבולים, `doAnalysisCore(..., { skipGemAlert: true })`, רישום התראות ושליחת ג'ם לטלגרם (למשל סף 80%).  
    `vercel.json`: **0 1 * * *** (01:00 UTC מדי יום).
  - **GET /api/cron/morning-report**  
    קורא ל־`runMorningReport()` (daily-reporter); שולח דוח בוקר לטלגרם.  
    `vercel.json`: **0 6 * * *** (06:00 UTC).
  - **POST /api/cron/retrospective**  
    קורא ל־`runRetrospectiveAndReport()`: ניתוח כישלונות, עדכון משקלים, יצירת דוח למידה, סנכרון ל־`ai_learning_ledger`, שליחת סיכום לטלגרם.  
    **אין** רישום ב־`vercel.json` — כלומר לא מופעל אוטומטית על ידי Vercel Cron; יש להפעיל ידנית או דרך מערכת חיצונית.
- **הגבלה ב־retrospective:**  
  ב־route נבדק `APP_CONFIG.dbDriver !== 'sqlite'` — אם **לא** sqlite מחזירים `200` עם `{ ok: false, error: 'DB_DRIVER=sqlite required.' }`.  
  **סתירה ארכיטקטונית:** הלוגיקה של `runRetrospectiveAndReport()` ו־`runRetrospectiveAnalysis()` תלויה ב־**Postgres** (`usePostgres()` = `postgresUrl`): `virtual_portfolio`, `historical_predictions`, `prediction_weights`, `learning_reports`, `ai_learning_ledger`.  
  כלומר: דרישת ה-route ל־`DB_DRIVER=sqlite` לא תואמת את השימוש בפועל ב־Postgres; במצב production עם Postgres בלבד, הקריאה ל־retrospective תכשל בדרישת ה-route או תדרוש הגדרה לא אינטואיטיבית.

---

## 5. סיכום זרימת נתונים ולוגיקה

1. **ניתוח נכס (UI או Cron):**  
   Binance + F&amp;G + סנטימנט → חישובי RSI/תנודתיות → Guardrail סנטימנט → Gemini (primary → 429 fallback → empty response fallback) → ולידציה/תיקון עקביות → שמירה ב־Neon `prediction_records` + (אופציונלי) ג'ם לטלגרם.

2. **סימולציה:**  
   UI (CryptoAnalyzer/PnlTerminal) ↔ SimulationContext ↔ `POST/GET /api/simulation/trades` ו־`/api/simulation/summary` ↔ `simulation_trades` ב־Vercel Postgres. ארנק מחושב ברמת שרת ב־summary; ברמת לקוח ב־Context.

3. **P&amp;L ו־Backtest:**  
   `/api/ops/metrics/pnl` קורא לתחזיות שאומתו (מ־Neon/Postgres לפי הארכיטקטורה) ומחשב רווח/הפסד, עקומת הון, drawdown — מוצג ב־PnlTerminal עם מינוף ו־PDF.

4. **רטרוספקטיבה:**  
   Cron (או trigger חיצוני) → `runRetrospectiveAndReport()` → קריאת `virtual_portfolio` + `historical_predictions` (Postgres) → זיהוי דפוסי כישלון, עדכון משקלים ב־`prediction_weights`, `insertLearningReport`, `syncHistoricalToLedger` → טלגרם.

5. **טלגרם:**  
   Webhook פתוח ברשימת הלבנה; עיבוד רק מ־TELEGRAM_CHAT_ID; פקודות וכפתורים מפעילים ניתוח, תיק סימולציה, אסטרטגיה ועזרה.

---

**סיום המסמך.** מסמך זה משמש כ־Blueprint נוכחי לפני refactoring ל־Multi-Agent; אין בו המלצות שינוי קוד, רק תיאור מדויק של המצב הקיים.
