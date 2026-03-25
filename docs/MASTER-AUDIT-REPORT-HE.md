# דוח ביקורת מאסטר — Mon Chéri Quant AI

**תאריך:** 14 במרץ 2025  
**סוג:** ביקורת ארכיטקטורה ואבטחה לפני הרצה אוטונומית  
**סטטוס:** ארבעת העמודים נבדקו; ממצאים קריטיים ואזהרות מסומנים במפורש.

---

## 1. מנוע הליבה — דיוק מתמטי וכמותי (Quant & P&amp;L)

### 1.1 קומפוננטות שנבדקו

| קובץ | תפקיד |
|------|--------|
| `components/CryptoAnalyzer.tsx` | ניתוח נכס, תחזית, ארנק סימולציה, מחיר כניסה |
| `components/PnlTerminal.tsx` | הצגת רווח/הפסד, עקומת הון, מינוף, ייצוא PDF |
| `app/api/ops/metrics/pnl/route.ts` | חישוב P&amp;L בצד שרת (backtest) |
| `lib/db/backtest-repository.ts` | מקור נתוני backtest (`BacktestLogEntry`) |

### 1.2 טיפוסים ומתמטיקה

- **PnlTerminal:**  
  - טיפוסים מוגדרים היטב: `PnlTrade`, `PnlApiResponse`, `PnlTerminalProps`.  
  - חישובי תצוגה: `totalPnl = data.totalPnl * L`, `balance = STARTING_BALANCE + totalPnl`, `equityCurveScaled` ו־`dailyPnlScaled` עם כפל ב־`L`.  
  - עיגול תצוגה: `toFixed(2)`, `toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })` — עקביות ל־2 ספרות אחרי הנקודה.

- **API PnL (`/api/ops/metrics/pnl`):**  
  - `tradePnL(entry)`: כיוון (Bullish/Bearish), `positionUsd`, `profitPct`, `FEE_PCT` (0.1%) — לוגיקה ברורה.  
  - עיגול עקבי: `Math.round(pnl * 100) / 100` ל־`pnl_usd`, `dailyPnl`, `equityCurve.balance/cumulative_pnl`, `totalPnl`, `totalPnlPct`, `maxDrawdown`, `maxDrawdownPct`, `profitFactor`, `winRatePct`.  
  - הגנה מפני חלוקה באפס: `startingBalance !== 0`, `peak > 0`, `grossLoss > 0`.

- **CryptoAnalyzer:**  
  - `currentPrice = latestPrediction?.entry_price ?? 0` — **הערה סמנטית:** השדה "מחיר נוכחי" בתצוגה הוא למעשה **מחיר הכניסה** של התחזית האחרונה, לא מחיר שוק חיים. למסחר חי יש להציג מקור מחיר נוכחי אמיתי.  
  - סימולציה: `addTrade` ב־`SimulationContext` — בדיקות `Number.isFinite(price)`, `Number.isFinite(amountUsd)`, עיגול `walletUsd` ל־2 ספרות. חישוב עמלה: `(amountUsd * SIMULATION_FEE_PCT) / 100`.

### 1.3 Hydration ועקביות תצוגה

- ב־**PnlTerminal**:  
  - `mounted` state ו־`clientTimeLabel` מתעדכנים רק אחרי `useEffect` (client).  
  - `suppressHydrationWarning` על: יתרה, זמן ביצוע, תאריכים בפורמט `toLocaleString('he-IL')`.  
  - מניעת אי-התאמה בין שרת ללקוח בערכים תלויי זמן ומספרים מעוגלים.

### 1.4 סיכום עמידה בתקן "Crypto Grade"

- **קיים:** טיפוסים ברורים, עיגול עקבי ל־2 עשרוניים, הגנה מפני חלוקה באפס, טיפול ב־hydration.  
- **חסר/סיכון:**  
  - אין שימוש ב־`Decimal`/ספריית דיוק (רק `number` ב־JS) — בסביבה קיצונית עשויים להופיע סטיות של סנטים.  
  - "מחיר נוכחי" ב־CryptoAnalyzer הוא בפועל מחיר כניסה — לא מתאים להחלטות מסחר על בסיס מחיר נוכחי אמיתי.

**מסקנה:** הדיוק המתמטי והתצוגה **מתאימים להצגת דוחות ולביקורת**, עם אזהרה שבדיקות מסחר חי דורשות מקור מחיר נוכחי אמין ומנגנון דיוק מתמטי מחמיר יותר אם נדרש.

---

## 2. Total Lockdown ואבטחה (The Vault)

### 2.1 Middleware (`middleware.ts`)

- **לוגיקה:**  
  - רשימת לבנה: `/login`, `/api/telegram/webhook`, `manifest.json`, `/icons/`, `_next`, `favicon`, `icon`, `apple-icon`, `/api/auth/login`, `/api/auth/logout`.  
  - **כל נתיב אחר** דורש עוגיית `app_auth_token` (ערך לא ריק).  
  - ללא עוגיה → הפניה ל־`/login?from=<pathname>`.

- **הערה:** ה־middleware **לא** בודק חתימה (Edge); הוא רק בודק נוכחות עוגיה. אימות החתימה מתבצע בצד שרת.

### 2.2 אימות בצד שרת

- **`lib/session.ts`:**  
  - `verifySessionToken`: פירוק token, אימות HMAC-SHA256 עם `APP_SESSION_SECRET` (ו־`APP_SESSION_SECRET_PREVIOUS`), `timingSafeEqual`, בדיקת `exp`.  
  - `hasRequiredRole`: היררכיה viewer &lt; operator &lt; admin.

- **דפים ו־API:**  
  - `app/ops/layout.tsx`, `app/ops/page.tsx`, `app/ops/pnl/page.tsx`, `app/settings/page.tsx`, `app/ops/strategies/page.tsx`: קריאה ל־`verifySessionToken` + `hasRequiredRole(session.role, 'admin')` (או viewer ב־layout). חסימת גישה → `redirect('/login')`.  
  - **API:** `/api/ops/metrics/pnl`, `/api/ops/metrics`, `/api/ops/simulate`, `/api/ops/verify-symbols`, `/api/ops/strategies`, `/api/ops/metrics/accuracy`: כאשר `isSessionEnabled()` — אימות token ו־role; אחרת 401.

### 2.3 AppShell ובידוד מסך הכניסה

- **`components/AppShell.tsx`:**  
  - `isLoginPage = pathname === '/login'`.  
  - בדף `/login`: רינדור **רק** `children` — ללא CryptoTicker, ללא BottomNav, ללא SimulationProvider.  
  - מסך התחברות מבודד לחלוטין מממשק הדשבורד.

### 2.4 כניסה והגדרת עוגיה

- **כניסה:**  
  - דף הכניסה משתמש ב־Server Action `loginWithPassword` מ־`app/actions.ts` (לא ב־POST ל־`/api/auth/login`).  
  - לאחר אימות סיסמה: `createSessionToken('admin')`, `jar.set('app_auth_token', ...)` עם `httpOnly`, `secure` ב־production, `sameSite: 'lax'`, `path: '/'`.  
  - לאחר כניסה: `window.location.href = target` — טעינה מחדש עם עוגיה, כך שה־middleware יאפשר גישה ל־/ops.

- **מסלול API ללוגין:**  
  - `/api/auth/login`: מוגן ב־IP allowlist ו־CSRF; לא נדרש עבור הכניסה הנוכחית מהדף (Server Action).

### 2.5 סיכום אבטחה

- **מאובטח:**  
  - גישה ל־dashboard ו־API של ops רק עם עוגיה תקפה.  
  - עוגיה מאומתת בחתימה ב־layout ו־API.  
  - מסך לוגין נפרד, ללא אלמנטים פנימיים של הדשבורד.

- **תנאי:**  
  - יש להגדיר `APP_SESSION_SECRET` ו־`ADMIN_LOGIN_PASSWORD` (ו־`isSessionEnabled()` פעיל) כדי שהנעילה תהיה אפקטיבית.  
  - אם `APP_SESSION_SECRET` לא מוגדר, API של metrics/pnl לא דורש אימות — **חובה** להגדיר סוד בפרודקשן.

**מסקנה:** Total Lockdown **פעיל** כאשר Session מופעל: אין גישה לא מורשית לדשבורד או ל־API של ops.

---

## 3. אוטומציה והתראות (Cron ו־Telegram)

### 3.1 Webhook טלגרם (`app/api/telegram/webhook/route.ts`)

- **נגישות:**  
  - הנתיב `/api/telegram/webhook` ברשימת הלבנה ב־middleware — Telegram יכול לשלוח POST בלי עוגיות/סשן.  
  - `export const dynamic = 'force-dynamic'` — אין אופטימיזציה סטטית.

- **אימות:**  
  - רק עדכונים מ־`TELEGRAM_CHAT_ID` מעובדים: `isAllowedChatId(chatId)` — הודעות מכל צ'אט אחר מחזירות 200 ללא פעולה.  
  - אין תלות ב־cookies או CSRF; האימות הוא לפי מזהה הצ'אט בלבד.

- **מבנה:**  
  - פקודות טקסט: `/status`, `/analyze`, `/strategy`, `/portfolio`, `/help`.  
  - Callback (כפתורים): `sim_confirm`, `deep:`, `ignore:` — כולם נבדקים עם `isAllowedChatId`.  
  - תמיד מחזיר 200 כדי שטלגרם לא ינסה שוב.

**מסקנה:** ה־webhook **מתאים** לקבלת אירועים מטלגרם ללא עקיפת אבטחת Next.js; הגנה על ידי `TELEGRAM_CHAT_ID`.

### 3.2 Cron — סריקה ודוח בוקר

- **`/api/cron/scan`:**  
  - אימות: `CRON_SECRET` או `WORKER_CRON_SECRET` ב־Bearer או ב־query param.  
  - ללא סוד תקף → 401.  
  - `maxDuration = 300` (5 דקות).  
  - קורא ל־`runOneCycle()` (market scanner).

- **`/api/cron/morning-report`:**  
  - אותו מנגנון סוד.  
  - `maxDuration = 60`.  
  - קורא ל־`runMorningReport()`.

- **תזמון (`vercel.json`):**  
  - `scan`: `"0 1 * * *"` — פעם ביום ב־01:00 UTC.  
  - `morning-report`: `"0 6 * * *"` — פעם ביום ב־06:00 UTC.  
  - **לא** מוגדר cron כל 15 דקות; אם נדרשת סריקה כל 15 דקות — יש להוסיף schedule מתאים ב־Vercel ולוודא `maxDuration` (למשל 300) מספיק לסריקה אחת.

**מסקנה:** Cron של סריקה ודוח בוקר **מאובטחים** ומוגדרים; משך מרבי 5 דקות לסריקה — יש לוודא ש־`runOneCycle()` לא חורג מזה או להעלות `maxDuration` אם נדרש.

### 3.3 Cron רטרוספקטיבה — ממצא קריטי

- **`/api/cron/retrospective`** (POST):  
  - **אין בדיקת CRON_SECRET או סוד אחר.**  
  - כל גורם שיכול לשלוח POST לכתובת הזו יכול להפעיל את מנוע הרטרוספקטיבה ולשלוח דוח לטלגרם.  
  - **סיכון:** הפעלה לא מורשית, עומס על המערכת, דוחות מטעה.

**המלצה:** להוסיף אימות (למשל `CRON_SECRET` ב־header או body) ל־`/api/cron/retrospective` ורק אז להריץ את הלוגיקה. בנוסף, אם הרטרוספקטיבה אמורה לרוץ על פי לוח זמנים — להוסיף אותה ל־`vercel.json` עם סוד מתאים.

---

## 4. מובייל ו־PWA (The Pocket Terminal)

### 4.1 `public/manifest.json`

- **קיים ומלא:**  
  - `name`, `short_name`, `description`, `start_url: "/"`, `scope: "/"`.  
  - `display: "standalone"`, `orientation: "portrait-primary"`.  
  - `theme_color`, `background_color`, `lang: "he"`, `dir: "rtl"`.  
  - אייקונים: 192×192, 512×512, `purpose: any` ו־maskable.  
  - הנתיבים לאייקונים: `/icons/icon-192.png`, `/icons/icon-512.png` — **לוודא שהקבצים קיימים ב־`public/icons/`.**

### 4.2 Service Worker (`public/sw.js`)

- **התנהגות:**  
  - `install`: `skipWaiting()`.  
  - `activate`: מחיקת caches ישנים, `clients.claim()`.  
  - `fetch`: רק `event.request.mode === 'navigate'` — cache אחרי fetch, fallback ל־`/` בשגיאה.  
  - שם cache: `quant-ai-v1`.

- **רישום:**  
  - `RegisterServiceWorker` רושם את `/sw.js` **רק ב־production** ורק אם `navigator.serviceWorker` קיים.

**מסקנה:** SW מינימלי ותקין; מתאים ל־"Add to Home Screen" ולטעינה חוזרת. אין precache מלא של shell — טעינה מהירה תלויה ב־cache לאחר ניווט ראשון.

### 4.3 תגיות iOS ו־layout

- **`app/layout.tsx`:**  
  - `metadata.manifest`, `metadata.appleWebApp` (capable, statusBarStyle, title), `metadata.themeColor`.  
  - `viewport`: `width: device-width`, `initialScale: 1`, `themeColor`.

- **`components/PwaMeta.tsx` (client):**  
  - מוסיף ב־`useEffect`: `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-mobile-web-app-title`, `manifest`, `apple-touch-icon` (192).  
  - משלים את מה ש־Next.js לא בהכרח מספק ל־iOS.

**מסקנה:** המערכת **מוכנה** להתקנה כאפליקציה דמו־native במובייל (Android ו־iOS), עם דגש על בדיקת אייקונים ב־`/icons/` ותצוגה ב־standalone.

### 4.4 נעילה ו־start_url

- `start_url: "/"` מפנה לדף ראשי שמוגן ב־middleware — משתמש לא מחובר יופנה ל־`/login`.  
  - התנהגות צפויה: התקנה → פתיחה → כניסה.

---

## 5. סיכום מנהלים והמלצות

### מה קיים ו� stabil

| ע column | סטטוס |
|----------|--------|
| **מתמטיקה ו־P&amp;L** | טיפוסים ברורים, עיגול עקבי, הגנה מפני חלוקה באפס, טיפול ב־hydration. |
| **Total Lockdown** | Middleware + verifySessionToken + AppShell — גישה רק עם session תקף; מסך לוגין מבודד. |
| **Webhook טלגרם** | Whitelist ב־middleware, אימות לפי TELEGRAM_CHAT_ID, ללא תלות ב־cookies. |
| **Cron סריקה/בוקר** | אימות CRON_SECRET, maxDuration מוגדר, תזמון ב־vercel.json. |
| **PWA ו־iOS** | manifest מלא, SW פעיל ב־production, תגיות Apple ב־layout ו־PwaMeta. |

### ממצאים קריטיים / תיקונים נדרשים

1. **`/api/cron/retrospective`** — **חסר אימות.** להוסיף בדיקת CRON_SECRET (או סוד ייעודי) ולהוסיף ל־cron ב־vercel.json אם רוצים הרצה אוטומטית.
2. **API של PnL כאשר Session כבוי** — אם `APP_SESSION_SECRET` לא מוגדר, ה־API לא דורש אימות. בפרודקשן **חובה** להגדיר סוד ולהפעיל session.
3. **"מחיר נוכחי" ב־CryptoAnalyzer** — כרגע מציג מחיר כניסה. למסחר/החלטות על בסיס מחיר חי — לחבר מקור מחיר נוכחי אמיתי ולעדכן תווית/לוגיקה.

### עמידה בתקן למסחר קריפטו חי

- **תצוגה ודוחות:** הדיוק והאמינות **מתאימים** להצגת נתונים ולניתוח backtest.  
- **מסחר אוטונומי/חי:** לפני הפעלה כזו יש להבטיח:  
  - מקור מחיר נוכחי אמין (לא רק entry_price).  
  - אימות מלא לכל ה־cron (כולל retrospective).  
  - בחירה מודעת לגבי דיוק (float vs Decimal) בהתאם לגודל פוזיציות ולסיכון.

---

*דוח זה מבוסס על קריאת הקוד הנוכחי; יש לאמת בסביבת פרודקשן את משתני הסביבה והקבצים הסטטיים (אייקונים).*
