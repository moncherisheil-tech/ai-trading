# דוח פתרון בעיית Persistence — שמירת הגדרות וכיולים

## סיכום מנהלים

המערכת לא שמרה נתונים או הגדרות (כולל כיולים) משתי סיבות עיקריות:

1. **חוסר הגדרת מסד נתונים** — כאשר `DATABASE_URL` (או `POSTGRES_URL`) לא הוגדר ב־`.env`, פונקציות השמירה החזירו `false` בשקט בלי להודיע למשתמש או ללוג.
2. **חוסר invalidation של cache** — לאחר שמירה מוצלחת לא בוצעה קריאה ל־`revalidatePath`, ולכן ממשק המשתמש לא תמיד הציג את המצב המעודכן בלי רענון מלא.

שני הדברים תוקנו. בנוסף הוספנו טיפול שגיאות מפורש ולוגים `[SAVE_ERROR]` כדי לאבחן כשלים בטרמינל.

---

## מה חסם את השמירה (הסבר טכני)

### 1. מנגנון האחסון

- **הגדרות אפליקציה (מרכז פקודות מאסטר)**: נשמרות ב־**Vercel Postgres** בטבלה `settings` (מפתח `app_settings`, ערך JSON).
- **הגדרות סורק**: נשמרות ב־**Vercel Postgres** בטבלה `system_settings` (שורה יחידה `id = 1`).
- **כיול מערכת**: הרצת "החל סכימת כיול" שולחת `POST /api/settings/app` עם פרמטרי `risk` מוצעים — כלומר השמירה היא דרך אותו מנגנון של הגדרות האפליקציה.

בקוד לא נעשה שימוש ב־`fs.writeFileSync` או כתיבה לקבצי `.json` לשמירת הגדרות או כיולים; אלה נשמרים רק ב־Postgres.  
(כתיבה לקבצים קיימת רק ב־repositories אחרים — predictions, strategy-insights, backtest — ובסביבת production מושבתת.)

### 2. הסיבה המרכזית לכשל: Postgres לא מוגדר

- ב־`lib/config.ts` המשתנה `postgresUrl` נקבע מ־`process.env.DATABASE_URL || process.env.POSTGRES_URL`.
- ב־`lib/db/app-settings.ts` ו־`lib/db/system-settings.ts` פונקציית `usePostgres()` מחזירה `true` רק אם `postgresUrl` לא ריק.
- כאשר `DATABASE_URL` ריק (כמו ב־`.env` הנוכחי):
  - `setAppSettings()` ו־`setScannerActive()` החזירו **`false`** בלי לזרוק חריגה ובלי לוג.
  - ה־API החזיר `500` עם הודעת "Failed to update settings" בלי להסביר שהבעיה היא חוסר הגדרת DB.

כתוצאה מכך: **השמירה לא בוצעה בפועל, והמשתמש לא קיבל הסבר ברור.**

### 3. סנכרון UI אחרי שמירה

- לאחר `POST /api/settings/app` או `POST /api/settings/scanner` מוצלח, לא בוצעה קריאה ל־`revalidatePath`.
- ב־App Router של Next.js, דפים ו־Server Components יכולים להשתמש ב־cache; בלי invalidation הממשק עלול להציג מצב ישן עד רענון מלא.
- בנוסף, ב־"החל סכימת כיול" לא נקראה `refreshSettings()` מה־context הגלובלי, כך שהגדרות גלובליות (כמו theme) לא תמיד התעדכנו מיד.

---

## איך תוקן לצמיתות

### Phase 1: זיהוי וטיפול במחסום השמירה

- **`lib/db/app-settings.ts`**  
  - `setAppSettings()` מחזירה כעת `SetAppSettingsResult`: `{ ok: true }` או `{ ok: false, error: string }`.  
  - כאשר Postgres לא מוגדר: נכתב לוג `[SAVE_ERROR] App settings: DATABASE_URL not configured...` ומוחזר `{ ok: false, error: '...' }`.  
  - במקרה של חריגה מ־`sql`: נרשם `[SAVE_ERROR] App settings` עם החריגה, ומוחזר `{ ok: false, error: message }`.

- **`lib/db/system-settings.ts`**  
  - `setScannerActive()` ו־`setLastScanTimestamp()` מחזירות `SetScannerResult` באותו פורמט.  
  - כאשר Postgres לא מוגדר או נזרקת חריגה: לוג `[SAVE_ERROR] Scanner settings ...` והחזרת `{ ok: false, error }`.

- **מיגרציה**  
  - נוסף קובץ `migrations/postgres/002_settings_tables.sql` שיוצר את הטבלאות `settings` ו־`system_settings` (כולל שורת ברירת מחדל ב־`system_settings`).  
  - אחרי הגדרת `DATABASE_URL` יש להריץ את המיגרציות (למשל `node scripts/migrate-postgres.mjs` או הסקריפט שבפרויקט) כדי שהטבלאות יהיו קיימות.

### Phase 2: Cache Invalidation (סנכרון UI)

- **`app/api/settings/app/route.ts`**  
  - לאחר שמירה מוצלחת (ואחרי `recordAuditLog`): קריאה ל־`revalidatePath('/settings')` ו־`revalidatePath('/')`.

- **`app/api/settings/scanner/route.ts`**  
  - לאחר עדכון מוצלח: `revalidatePath('/settings')` ו־`revalidatePath('/')`.

- **`components/SystemOptimizationCard.tsx`**  
  - לאחר "החל סכימת כיול" מוצלח: קריאה ל־`await refreshSettings()` מה־`useAppSettings()` כדי לעדכן את ה־context הגלובלי (theme, מרווח רענון וכו').

### Phase 3: טיפול שגיאות ו־HTTP

- כל פונקציות השמירה עטופות ב־try/catch; כשל מחזיר הודעת שגיאה ברורה.
- כאשר השמירה נכשלת כי ה־DB לא מוגדר: ה־API מחזיר **503** עם הודעת `error` שמזכירה את הצורך ב־`DATABASE_URL` / `POSTGRES_URL`.
- ב־catch של ה־route של `settings/app` (GET ו־POST) ו־`settings/scanner` (POST): נוסף `console.error('[SAVE_ERROR]', ...)` כדי שניתן יהיה לעקוב אחרי הכשל בטרמינל.

### Phase 4: אימות שמירה

- **סקריפט אימות**: `scripts/verify-save.mjs`  
  - מבצע GET ל־`/api/settings/app`, שולח POST עם שינוי קטן (למשל `trading.defaultTradeSizeUsd`), ואז GET חוזר ובודק שהערך נשמר.  
  - שימוש: להגדיר `BASE_URL` (למשל `http://localhost:3000`), ובמידת צורך `COOKIE_HEADER` אם נדרשת אימות.  
  - דוגמה: `BASE_URL=http://localhost:3000 node scripts/verify-save.mjs`

- **אימות בדפדפן (Network)**  
  - לפתוח DevTools → Network.  
  - לשמור הגדרות או להחיל כיול.  
  - לאתר את הבקשה `POST .../api/settings/app` (או `.../api/settings/scanner`).  
  - לבדוק: Status 200 ו־body עם `ok: true` ו־`settings` מעודכנים — אז הנתונים הגיעו ל־backend ונשמרו.  
  - אם מתקבל 503 עם הודעת DATABASE_URL — יש להגדיר `DATABASE_URL` (או `POSTGRES_URL`) ולהריץ מיגרציות.

---

## צעדים נדרשים אצלך (הפעלה ראשונית)

1. **הגדרת מסד נתונים**  
   ב־`.env` (או ב־Vercel Environment Variables):  
   `DATABASE_URL=<connection-string>`  
   (או `POSTGRES_URL`).

2. **הרצת מיגרציות**  
   כדי ליצור את טבלאות `settings` ו־`system_settings`:  
   להריץ את סקריפט המיגרציה של הפרויקט (למשל `node scripts/migrate-postgres.mjs` או לפי מה שמופיע ב־README), כך ש־`002_settings_tables.sql` יופעל.

3. **אימות**  
   - להריץ: `BASE_URL=http://localhost:3000 node scripts/verify-save.mjs`  
   - או לבדוק ב־Network ששמירת הגדרות/כיול מחזירה 200 ו־`ok: true`.

אחרי שלבים אלה, שמירת הגדרות וכיולים אמורה לעבוד, והממשק יתעדכן מיד אחרי שמירה מוצלחת בלי צורך ברענון מלא.
