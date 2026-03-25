# דוח שחזור מערכת וסריקת באגים — Gemini 404 ותחזוקת מנוע ה-AI

**תאריך:** מרץ 2026  
**גרסה:** Smart Money — תיקון 404 Gemini ובריאות מערכת

---

## 1. שחזור מנוע Gemini (התיקון)

### עדכון מודל
- **משתנה דינמי:** הוחלף השימוש הקבוע ב-`models/gemini-2.5-flash` (ומודלים קשיחים אחרים) במשתנה סביבה: `NEXT_PUBLIC_GEMINI_MODEL` או `GEMINI_MODEL_PRIMARY`.
- **מיקום:** `lib/config.ts` — `primaryModel` ו-`fallbackModel` נגזרים כעת מ-env עם ברירת מחדל יציבה.
- **ברירת מחדל:** `gemini-2.0-flash` (מודל ראשי), `gemini-2.5-flash-latest` (מודל גיבוי).

### גרסת API
- **מעבר מ-v1beta ל-v1:** בכל יצירת הלקוח של Gemini (`GoogleGenAI`) נוסף `apiVersion: 'v1'` — אנדפוינט יציב 2026.
- **קבצים שעודכנו:** `lib/analysis-core.ts`, `lib/deep-analysis-service.ts`, `app/actions.ts`.

### כשל מבוקר (Graceful Failure)
- **זיהוי 404/500:** נוספה פונקציה `is404Or500Error()` לזיהוי שגיאות מנוע (404 — מודל לא נמצא, 500 — שגיאת שרת).
- **רישום ב-audit_logs:** בעת 404/500 נקרא `recordAuditLog` עם `action_type: 'AI_ENGINE_ERROR'` ו-`payload_diff` (שגיאה, מודל, סימבול).
- **סטטוס "תובנה בהמתנה":** במקום לחסום את המסחר, נזרקת שגיאה ייעודית `AI_ENGINE_ERROR`; ה-action מחזיר `aiEngineDown: true` והודעת משתמש: "מנוע הניתוח בתחזוקה זמנית — נתוני השוק והמסחר ממשיכים לעבוד כרגיל."
- **מסחר לא נחסם:** הזרימה הקיימת (כולל פוסט-מורטם ב-`smart-agent`) כבר מטפלת ב-timeout/שגיאה עם "תובנה בהמתנה"; כעת גם כשל 404/500 מתועד ב-audit_logs ולא חוסם.

### .env.example
- נוספו `NEXT_PUBLIC_GEMINI_MODEL` וברירות המחדל המעודכנות ל-`GEMINI_MODEL_PRIMARY` ו-`GEMINI_MODEL_FALLBACK`.

---

## 2. סריקת באגים ויושרת קוד (Bug Hunter)

### תהליכים ו-intervals
- **market-scanner.ts:** קיים `setInterval` עם ניקוי מסודר — `stopMarketScanner()` מבצע `clearInterval(intervalId)` ומאפס סטטוס. אין דליפות זיכרון מצד הסורק.
- **workers (weekly-retrospective, daily-report, daily-reporter):** אינם מריצים `setInterval` — מופעלים על ידי Cron; אין צורך בניקוי נוסף.

### הבטחות לא מטופלות (Unhandled Promises)
- **rate-limit-distributed.ts:** קריאת `fetch` ל-expire (fire-and-forget) טופלה — נוסף `.catch(() => {})` כדי למנוע unhandled rejection במקרה של כשל רשת.
- **task-queue.ts:** הדחיפה ל-`enqueueByKey` מחזירה Promise; הקורא (למשל `analyzeCrypto`) עוטף ב-try/catch — אין הבטחה "חשופה".
- **market-scanner:** `runOneCycle().catch(() => {})` כבר קיים בתוך ה-setInterval.

### parity של משתני סביבה
- **ready route (`/api/health/ready`):** הורחב כך שיאמת נוכחות `GEMINI_API_KEY` (כולל סינון ערכי placeholder כמו MY_GEMINI_API_KEY). נוספו בדיקות אופציונליות ל-env: `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `PROXY_BINANCE_URL`, `UPSTASH_REDIS_REST_URL`, `ADMIN_LOGIN_PASSWORD`, `APP_SESSION_SECRET` — לא משפיעות על סטטוס 200/503 אך מאפשרות לראות ב-readiness אילו מפתחות מוגדרים.
- **.env.example:** מסונכרן עם השימוש בקוד (Gemini, DB, Telegram, Binance proxy, וכו').

### חיתוך נתונים (Data Truncation)
- **agent_insights:** עמודות `entry_conditions`, `outcome`, `insight` מוגדרות כ-TEXT — אין הגבלת אורך.
- **audit_logs:** `action_type` — VARCHAR(128) (מספיק ל-`AI_ENGINE_ERROR`), `payload_diff` — JSONB.
- **prediction_records (Postgres):** נתונים נשמרים ב-JSONB — אין מגבלת varchar על טקסטים כמו logic או strategic_advice.
- **מסקנה:** לא נמצאו עמודות שיגרמו לחיתוך לא צפוי של תובנות AI או לוגים.

---

## 3. מצב תחזוקה ב-UI (Maintenance Mode)

- **הודעת תחזוקה:** כאשר מנוע ה-AI מחזיר 404/500, המשתמש מקבל הודעת שגיאה ידידותית ו-`aiEngineDown: true`.
- **בממשק:** ב-`CryptoAnalyzer` נוסף באנר מקצועי (עם אייקון אזהרה) המוצג כאשר `aiEngineDown === true`:
  - **טקסט:** "מנוע הניתוח בתחזוקה זמנית — נתוני השוק והמסחר ממשיכים לעבוד כרגיל."
- **התנהגות:** הבאנר מופיע לאחר ניסיון ניתוח שנכשל עם שגיאת מנוע; לאחר ניתוח מוצלח הבאנר מתאפס.

---

## 4. סיכום שינויים בקבצים

| קובץ | שינוי |
|------|--------|
| `lib/config.ts` | מודל דינמי מ-env, ברירת מחדל `gemini-2.0-flash` / `gemini-2.5-flash-latest` |
| `lib/analysis-core.ts` | `apiVersion: 'v1'`, `is404Or500Error`, רישום `AI_ENGINE_ERROR` ב-audit_logs, זריקת `AI_ENGINE_ERROR` |
| `lib/deep-analysis-service.ts` | `apiVersion: 'v1'` ב-GoogleGenAI |
| `app/actions.ts` | `apiVersion: 'v1'`, שימוש ב-`APP_CONFIG.primaryModel`, החזרת `aiEngineDown` + הודעת תחזוקה |
| `app/api/health/ready/route.ts` | ולידציית env (Gemini + אופציונליים) |
| `lib/rate-limit-distributed.ts` | `.catch(() => {})` על fetch ל-expire |
| `components/CryptoAnalyzer.tsx` | state `aiEngineDown`, באנר תחזוקה בעברית |
| `.env.example` | `NEXT_PUBLIC_GEMINI_MODEL`, ברירות מחדל מעודכנות |

---

## 5. באגים "נסתרים" שטופלו

1. **Unhandled rejection ב-Upstash expire** — קריאת הרקע ל-expire עכשיו עם `.catch` כדי שלא תפיל את תהליך ה-Node.
2. **מודל קבוע ב-evaluatePendingPredictions** — החלפה ל-`APP_CONFIG.primaryModel` כדי לשמור על עקביות עם שאר המערכת ולהימנע מ-404 כשמשנים מודל.
3. **חוסר תיעוד 404/500 ב-audit_logs** — כעת כל כשל מנוע Gemini מתועד ב-`audit_logs` עם `AI_ENGINE_ERROR` לצורכי אבחון ואבטחה.

---

**מערכת מוכנה להמשך עבודה עם מנוע Gemini יציב (v1) ומצב תחזוקה ברור למשתמש.**
