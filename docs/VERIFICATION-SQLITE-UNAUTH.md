# סיכום תיקונים – SQLite ו-Unauthorized (Vercel)

## מה טופל

### 1. השמדת טעינת SQLite ב-Vercel (better-sqlite3 bindings)

- **כל המודולים שתלויים ב-SQLite** (`lib/db/historical-predictions.ts`, `prediction-weights.ts`, `scanner-alert-log.ts`, `learning-reports.ts`, `deep-analysis-logs.ts`, `virtual-portfolio.ts`, `sqlite-repository.ts`):
  - בתוך **getDb()** או ב-**constructor** (ב-sqlite-repository): נוסף בדיקה `if (process.env.VERCEL)` – זורקים שגיאה **לפני** `require('better-sqlite3')`, כך שהמודול הנטייבי לא נטען ב-Vercel.
  - בכל **פונקציה שמיוצאה** (append, list, get, count וכו'): נוסף תנאי `process.env.VERCEL ||` לפני `APP_CONFIG.dbDriver !== 'sqlite'`, כך שב-Vercel מחזירים ערך ריק/ברירת מחדל **בלי לקרוא ל-getDb()**.
- **תוצאה:** ב-Vercel אף פעם לא מבוצע `require('better-sqlite3')`, ולכן לא יופיע השגיאה "Could not locate the bindings file... better-sqlite3".

### 2. תיקון 500 מ-"Unauthorized request"

- **סיבה:** `requireAuth()` זרק `throw new Error('Unauthorized request.')` כשאין טוקן או שהתפקיד לא מתאים; ב-Server Actions זה גרם ל-500.
- **תיקון:**
  - **getHistory:** עטוף ב-try/catch – אם השגיאה היא "Unauthorized request." מחזירים `[]` במקום לזרוק.
  - **runCryptoAnalysisCore:** ב-catch מזהה "Unauthorized request." ומחזיר `{ success: false, error: 'Unauthorized request.' }` במקום שגיאה גנרית.
  - **getScannerStatus, getMacroStatus, getStrategyDashboard:** עטופים ב-try/catch – במקרה Unauthorized מחזירים אובייקט ברירת מחדל (נתונים ריקים/ניטרליים) במקום לזרוק.
- **תוצאה:** גישה לא מאושרת מחזירה תשובה JSON/ערך ריק ולא מפילה את הדף או את ה-route ב-500.

### 3. Cache ו-dynamic

- **app/page.tsx:** נוסף `export const dynamic = 'force-dynamic';`
- **app/insights:** נוסף `app/insights/layout.tsx` עם `export const dynamic = 'force-dynamic';`
- **תוצאה:** המסלולים האלה לא נשמרים ב-cache של Next.js ומופעלים מחדש לפי בקשה.

---

## מה לא השתנה

- **portfolio/virtual, backtest/analytics, retrospective/insights:** ממשיכים להחזיר תשובות "ריקות" או הודעת "DB_DRIVER=sqlite required" כשאין SQLite. ב-Vercel מומלץ להשתמש ב-`DATABASE_URL` (Postgres) ולכן `getDbAsync` / `getPredictionRepository` הם המקור לנתונים; המסלולים שתלויים רק ב-SQLite (virtual portfolio, backtest analytics, retrospective insights) ימשיכו להחזיר ריק ב-production ללא SQLite.

---

## אימות אחרי פריסה

1. **Vercel:** וודא ש-**לא** מוגדר `DB_DRIVER=sqlite` ב-Environment Variables (או השאר `file` / השתמש ב-Postgres עם `DATABASE_URL`).
2. **דף הבית:** הרץ ניתוח סימבול – ללא 500; אם אין auth – תקבל `{ success: false, error: 'Unauthorized request.' }`.
3. **דף תובנות (/insights):** טעינת הדף לא תגרום ל-500; אם אין auth – רשימת ההיסטוריה תהיה ריקה.
4. **לוגים:** לא אמורה להופיע שגיאת "better-sqlite3" או "bindings" ב-Vercel.
