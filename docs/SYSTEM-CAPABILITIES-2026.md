# יכולות המערכת — Crypto Quant AI  
## מסמך מנהלים ומערכת (2026)

**גרסה:** 1.0  
**תאריך:** 2026  
**קהל יעד:** CTO, CEO, ומנהלי טכנולוגיה

---

## תקציר מנהלים (Executive Summary)

פלטפורמת **Crypto Quant AI** של Mon Chéri Group היא מערכת ניתוח כמותי מבוססת־בינה מלאכותית לשוק הקריפטו. המערכת מספקת תחזיות כיוון מחיר (שורי / דובי / ניטרלי) ברמת מוסדית, עם לולאת למידה אוטומטית שמשתמשת בתוצאות העבר כדי לשפר את הדיוק וההנמקות של התחזיות הבאות.

**מצב נוכחי:** המערכת כוללת מנוע חיזוי כמותי (Quant AI Engine) המשלב נתוני שוק (Binance), סנטימנט חדשות, אינדיקטורים טכניים (RSI, תנודתיות), ומדד Fear & Greed, ומחזיר פלט מובנה (JSON) עם רמת סיכון, הסתברות, לוגיקה ומקורות. לולאת הפידבק מעריכה תחזיות ממתינות מול מחירי שוק, מייצרת מסקנות למידה (error_report) ומזינה אותן חזרה לפרומפט של הניתוח הבא. הממשק מאוחד בעברית (RTL), עם לוח סריקה ציבורי, לוח אופס מאובטח, תובנות AI, תיק וירטואלי ומסוף רווח/הפסד. התשתית נשענת על Neon Postgres לאחסון תחזיות, עם גיבוי Proxy ל־Binance בחסימת אזור, ואינטגרציות ל־Gemini AI ולטלגרם להתראות ולבקרת סימולציה.

**חזון:** להפוך את המערכת למקור אמין לתחזיות כמותיות בעברית, עם שקיפות מלאה של לקחי ה-AI ומדדי דיוק ממומשים (אחוז הצלחה, שגיאה ממוצעת, מגמת שיפור).

---

## מנוע החיזוי והלמידה (The Quant AI Engine & Learning Loop)

### ארכיטקטורת הניתוח

מנוע הליבה (`lib/analysis-core.ts`) מריץ את **doAnalysisCore**: אוסף נתונים ממקורות מרובים, בונה פרומפט מועשר, ושולח ל־Gemini עם הוראות דמות (Persona) של "Elite Quantitative Analyst". המודל מחויב להחזיר **JSON דטרמיניסטי** עם השדות: `symbol`, `probability` (0–100), `target_percentage`, `direction` (Bullish/Bearish/Neutral), `risk_level` (High/Medium/Low), `logic`, `strategic_advice`, `learning_context`, ו־`sources` (מערך מקורות עם evidence_snippet ו־relevance_score). כל הטקסטים (לוגיקה, המלצה, הקשר למידה, evidence) נוצרים **בעברית מקצועית** בהתאם להנחיית LOCALIZATION במערכת.

### מקורות הנתונים שנשקלים

- **סנטימנט שוק:** שכבת News Agent (CryptoCompare / כותרות) מפיקה `sentiment_score` (-1 עד 1) ו־`market_narrative`. Guardrail מסמן EXTREME_FEAR / EXTREME_GREED ומפעיל הקטנת ביטחון (למשל 50%) והתראת טלגרם.
- **אינדיקטורים טכניים:** RSI(14) ותנודתיות (volatility_pct) מחושבים מקומית מנתוני Binance (OHLCV). המבנה תומך בהזרקת `macd_signal` או אינדיקטורים נוספים בעתיד.
- **נפח ותנועה:** `volume_delta_percent` ו־OHLCV ל־5 ימים אחרונים נכללים בפרומפט. הערת Order Book מוזנת כטקסט (עומק לא מסופק; המודל מתבקש להסיק מנפח ותנודתיות).
- **Fear & Greed Index:** ערך וסיווג מ־Alternative.me.
- **הקשר היסטורי (לולאת למידה):**  
  - `past_mistakes_to_learn_from` — עד 5 תחזיות אחרונות באותו סמל עם סטטוס evaluated ו־`error_report` (הערת למידה שנוצרה אחרי כישלון).  
  - `historical_prediction_outcomes` — עד 10 תוצאות אחרונות מאותו סמל מטבלת `historical_predictions` (כשזמינה ב־SQLite): outcome_label, absolute_error_pct, probability, target_percentage.  
  ההוראות למודל מפורשות: לשקול דפוסים היסטוריים, להפחית הסתברות או לכוון ל־Neutral כשיש טעיות חוזרות או שגיאה גבוהה.

### לולאת הפידבק האוטומטית

- **הערכת תחזיות:** הפעולה `evaluatePendingPredictions` (ב־`app/actions.ts`) מושכת תחזיות במצב pending, מביאה מחיר נוכחי מ־Binance, ומעריכה כל תחזית (כיוון נכון/שגוי, שולי טעות) באמצעות `evaluatePredictionOutcome`. התוצאה נשמרת ב־`prediction_records` (actual_outcome, status: evaluated), ב־backtest repository וב־`historical_predictions`.
- **יצירת מסקנות למידה:** כאשר התחזית שגויה, נשלח ל־Gemini פרומפט "You made a wrong prediction…" והתשובה נשמרת כ־`error_report` ברשומת התחזית. מסקנה זו מוזנת בניתוח הבא כ־`past_mistakes_to_learn_from`, כך שה-AI מתאים את ההנמקות והביטחון.
- **חשיפה בממשק:** בדף התובנות (Insights) מוצג לכל תחזית שהוערכה בלוק "לקחים שנלמדו / מסקנות AI" עם `error_report` ו־`learning_context`. בלוח האופס קיים כפתור "הערך תחזיות ממתינות" להפעלה ידנית של ההערכה ורענון התוצאות.

---

## מודולי ליבה וממשק (Core UI Modules)

### לוח מאוחד (Unified Dashboard)

- **עמוד ראשי (`/`):** נגיש לציבור. כולל AppHeader, CryptoTicker (זרם מחירים חי מ־Binance WebSocket), ו־MainDashboard — המכיל את GemsStrip ואת CryptoAnalyzer: בחירת סמל, הרצת ניתוח כמותי, ארנק סימולציה (קנה/מכור), כפתור "הערך תחזיות עבר" (לולאת פידבק), ותצוגת תחזית אחרונה עם הסתברות, כיוון, תנועה צפויה, לוגיקת AI, המלצה אסטרטגית, מקורות והיסטוריית תחזיות.
- **לוח אופס (`/ops`):** מוגן על ידי Middleware (הפניה ל־/login ללא cookie). כולל את אותו MainDashboard, SimulateBtcButton, כפתור "הערך תחזיות ממתינות", ו־OpsMetricsBlock (סה"כ תחזיות, ממתינות, הוערכו, זמן תגובה, מודל גיבוי, תיקון ולידציה, ביקורת; כשקיים historical_predictions — דיוק ממומש: אחוז הצלחה, שגיאה ממוצעת, מגמת דיוק 10 אחרונות מול 10 קודמות). ניווט ל־תובנות אסטרטגיה, מסוף רווח/הפסד והגדרות.

### תובנות AI (Insights)

- **דף `/insights`:** מציג רשימת תחזיות (מה־history) עם סמל, תאריך, כיוון, הסתברות, שורה תחתונה, רמת סיכון, תחזית 24h, לוגיקה, ולכל תחזית שהוערכה — בלוק "לקחים שנלמדו / מסקנות AI" (error_report, learning_context). כפתור "אשר סימולציה" שולח לנתיב תיק וירטואלי.

### תיק (Portfolio) ומסוף רווח/הפסד (PnL Terminal)

- **Portfolio (`/portfolio`):** מבוסס SimulationContext ו־API תיק וירטואלי: סיכום יתרה, אחוז הצלחה, PnL יומי, עסקאות פתוחות וסגורות.
- **מסוף רווח/הפסד (`/ops/pnl`):** דף מאובטח לאופס. טוען נתונים מ־`/api/ops/metrics/pnl`, מציג PnlTerminal: יתרה התחלתית, רווח/הפסד נטו, אחוז הצלחה, מקדם רווח, שפל מקסימלי, עקומת הון, ביצועים יומיים/חודשיים וטבלת 20 עסקאות אחרונות (תאריך, סמל, כיוון מתורגם לעברית, רווח/הפסד, הצלחה/הפסד, סטטוס סיכון). כל הממשק בעברית ו־RTL.

### דפים נוספים

- **Backtest (`/backtest`):** דף בדיקות היסטוריות.  
- **הגדרות (`/settings`):** הגדרות משתמש וטלגרם.  
- **התחברות (`/login`): אימות סיסמה, הנפקת cookie מאובטח והפניה חזרה (למשל ל־/ops).

---

## תשתיות ודאטאבייס (Infrastructure & DB)

### Neon Postgres — מקור האמת לתחזיות

- **חיבור:** השימוש העיקרי בבסיס הנתונים הוא דרך `lib/db.ts`: `getDbAsync()` ו־`saveDbAsync()` מפעילים את `PostgresPredictionRepository` (Neon serverless) כאשר `DATABASE_URL` מוגדר.
- **סכמה:** טבלת `prediction_records`: `id` (TEXT PK), `symbol`, `status`, `prediction_date` (TIMESTAMPTZ), `payload` (JSONB). כל רשומת PredictionRecord נשמרת כ־JSONB. אינדקסים על symbol, status ו־prediction_date.
- **התנהגות בחסר DATABASE_URL:** `getDbAsync()` מחזיר מערך ריק; `saveDbAsync()` לא מבצעת פעולה. האפליקציה לא קורסת (serverless-safe). אתחול טבלאות (`initDB`) מתבצע עם טיפול בשגיאות כדי לא להפיל route.

### SQLite ולולאת הלמידה (אופציונלי)

- כאשר `DB_DRIVER=sqlite`, מודול `historical_predictions` (SQLite) זמין: שמירת תוצאות הערכה (outcome_label, absolute_error_pct, probability וכו') לשימוש בלולאת הלמידה ובמדדי דיוק (אחוז הצלחה, שגיאה ממוצעת, 10 אחרונות מול 10 קודמות). ב־Vercel או ללא SQLite — הפונקציות מחזירות מערך ריק / null ללא קריסה.

### גיבוי וחסימת אזור

- **Binance:** בחסימת אזור (451) מופעל fallback ל־`PROXY_BINANCE_URL` אם הוגדר. רשימת trustedApiOrigins כוללת את מקור ה־proxy לאחר בדיקה. Fetch עם timeout ו־retry.

---

## אבטחה והרשאות (Security & Auth)

### Middleware והגנת נתיבים

- **`middleware.ts`:** מגן על `/ops` וכל תת־נתיבים. אם אין cookie `app_auth_token` (או שהוא ריק), מתבצעת הפניה ל־`/login?from=<pathname>`. ה־Middleware לא בודק חתימה (Edge); אימות החתימה ו־role מתבצעים בצד שרת ב־layout/page (verifySessionToken, hasRequiredRole).

### ניהול סשן

- **`lib/session.ts`:** טוקן סשן בפורמט `payloadBase64.signature` (HMAC-SHA256 עם `APP_SESSION_SECRET`). תמיכה ב־`APP_SESSION_SECRET_PREVIOUS` לרוטציה. תוקף (exp) ו־role (viewer / operator / admin). `hasRequiredRole` מגדיר היררכיה (admin ≥ operator ≥ viewer). אימות עם `timingSafeEqual` נגד זיוף.

### Cookie והתנתקות

- **התחברות:** לאחר אימות סיסמה מוגדר cookie `app_auth_token` (httpOnly, secure בפרודקשן, sameSite: lax, domain לפי host).  
- **התנתקות (hard-logout):** פעולת `logout()` מנקה את ה־cookie (maxAge: 0) ואז הלקוח מפנה ל־`/login` (window.location.href). אין שמירת סשן פעיל לאחר התנתקות.

### הגנת API וכתובות IP

- **API אופס (למשל metrics):** בדיקת `isAllowedIp(request)` — כאשר `ALLOWED_IPS` מוגדר (רשימת IP מופרדת בפסיקים או `*`), רק בקשות מכתובות מורשות מאושרות; אחרת 403.  
- **CSRF:** מודול `lib/security.ts` מספק `verifyCsrf` (cookie + header) לשימוש בבקשות מוגנות.

---

## אינטגרציות (Integrations)

### Binance — נתוני שוק וזרם חי

- **REST:** שליפת klines (OHLCV) ו־ticker/price לסמלים. משמש את מנוע החיזוי ואת הערכת התחזיות (מחיר נוכחי).  
- **WebSocket:** `APP_CONFIG.tickerSocketUrl` — `wss://stream.binance.com:9443/ws/!miniTicker@arr`. רכיב CryptoTicker מתחבר לזרם, מסנן לפי TARGET_SYMBOLS, ומעדכן מחירים ואחוז שינוי בתדר מוגבל (throttle). התחברות מחדש עם backoff (tickerReconnectBaseMs / tickerReconnectMaxMs).

### Gemini AI

- **חיבור:** `GEMINI_API_KEY` דרך `lib/env.ts`. שימוש ב־`@google/genai` (GoogleGenAI).  
- **מודלים:** `GEMINI_MODEL_PRIMARY` (ברירת מחדל: gemini-2.5-flash), `GEMINI_MODEL_FALLBACK` (gemini-2.5-flash). על timeout או תשובה ריקה — ניסיון עם מודל גיבוי.  
- **שימושים:** (1) ניתוח כמותי ראשי (analysis-core) — פרומפט מועשר, responseSchema ל־JSON מובנה; (2) יצירת מסקנת למידה לאחר תחזית שגויה; (3) שכבת סנטימנט ב־news-agent ו־deep-analysis (כותרות → narrative ו־score). Timeout: `GEMINI_TIMEOUT_MS` (ברירת מחדל 60s).

### טלגרם (Telegram)

- **הגדרה:** `TELEGRAM_BOT_TOKEN` ו־`TELEGRAM_CHAT_ID`. מודול `lib/telegram.ts`: שליחת הודעות (טקסט/HTML), תמיכה ב־inline keyboard (callback_data).  
- **שימושים:** התראת סנטימנט קיצוני (Guardrail); ג'ם זוהה (הסתברות ≥ 75%) עם כפתורי פעולה; סורק שוק (worker) שולח התראות בהתאם ל־threshold.  
- **Webhook:** `POST /api/telegram/webhook` — קבלת עדכונים מטלגרם; טיפול ב־callback_query (למשל "אשר סימולציה") לרישום עסקה בתיק הוירטואלי וניהול דיאלוג עם המשתמש. הבוט מוכן להפעלה עם הגדרת webhook בשרת טלגרם.

### Cron ו־Workers (אופציונלי)

- **נתיבי Cron:** קיימים routes ל־`/api/cron/retrospective`, `/api/cron/scan`, `/api/cron/morning-report` להרצת משימות מתוזמנות (למשל Vercel Cron).  
- **Worker הערכה:** `/api/workers/evaluate` מפעיל `evaluatePendingPredictions({ internalWorker: true })` ללא דרישת auth מהמשתמש (לשימוש פנימי/מערכת).

---

## סיכום טכני קצר

| היבט | פרט |
|------|------|
| **מנוע חיזוי** | Binance + Fear & Greed + סנטימנט + RSI/תנודתיות + לקחים היסטוריים → Gemini → JSON (כיוון, הסתברות, risk_level, logic, sources) |
| **לולאת למידה** | הערכת pending מול מחיר נוכחי; שמירת outcome ו־error_report; הזנת past_mistakes ו־historical_prediction_outcomes לפרומפט הבא |
| **ממשק** | עברית RTL; לוח סריקה (/) + אופס (/ops); תובנות (/insights); תיק (/portfolio); מסוף רווח/הפסד (/ops/pnl) |
| **DB** | Neon Postgres (prediction_records JSONB); אופציונלי SQLite ל־historical_predictions ולמדדי דיוק |
| **אבטחה** | Middleware הגנה על /ops; cookie סשן חתום (HMAC); התנתקות מלאה; ALLOWED_IPS ל־API אופס |
| **אינטגרציות** | Binance REST + WebSocket; Gemini (מודל ראשי + גיבוי); טלגרם (התראות + webhook לאישור סימולציה) |

---

*מסמך זה משקף את מצב המערכת prior to פריסת production ומשמש כ־"System Bible" לעדכונים ולתכנון המשך.*
