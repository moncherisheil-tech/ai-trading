# סיכום תיקונים — אימות, ניתוח ויציבות Dashboard

## מה היה שבור

### 1. אזהרת "Unauthorized request" ו־401
- **סיבה:** כאשר הפעולות בצד השרת (Server Actions) או קריאות API קיבלו טוקן חסר, לא תקף או שפג תוקפו, הפונקציה `requireAuth()` זרקה `Unauthorized request.` בלי לוג בצד שרת, ולכן קשה היה לאבחן אם הבעיה היא חוסר cookie, טוקן שפג תוקפו או תפקיד לא מספיק.
- **בממשק:** רכיבים (כולל ניתוח קריפטו ומדדי תפעול) הציגו "אין הרשאה" או "הניתוח נכשל" בלי הסבר טכני.

### 2. "הניתוח נכשל" (Analysis failed) גנרי
- **סיבה:** ב־`analyzeCrypto` ב־catch החזרנו הודעת משתמש גנרית: `"Analysis failed. Please try again."` במקום להעביר את השגיאה האמיתית (למשל "Unauthorized request.", "Submission was too fast", "Captcha verification failed." וכו').
- **בממשק:** המשתמש ראה רק "הניתוח נכשל" בלי סיבה ברורה.

### 3. חוסר נתונים למרות טיקר פעיל
- **סיבה:** קריאות `fetch()` מצד הלקוח ל־`/api/settings/app`, `/api/crypto/gems` ול־Simulation/PnL לא העבירו במפורש `credentials: 'include'`, כך שבסביבות מסוימות ה־cookie של האימות לא נשלח.
- בנוסף, שליפת קווי Binance ב־`doAnalysisCore` השתמשה ב־`fetchJson` עם `withRetry` בלבד, בלי טיפול ב־429/418 (rate limit) של Binance, ולכן כישלון או חסימה לא תועדו היטב.

### 4. חוסר לוגים וללא סיבה טכנית ב־UI
- לא היה לוג שרת ברור כשנכשל אימות או כשניתוח נכשל.
- ב־Error Boundary לא הוצגה השגיאה הטכנית (error.message), ולכן קשה היה לאבחן בתצוגה.

---

## מה תוקן

### 1. אימות ו־Middleware
- **`app/actions.ts` — `requireAuth()`:**  
  נוסף לוג לפני זריקת "Unauthorized request.": סיבת הכישלון (`missing_token` / `invalid_or_expired_token` / `insufficient_role`) ו־`requiredRole` נשלחים ל־`console.warn` כדי שיופיעו בלוגי השרת (למשל ב־Vercel).
- **`middleware.ts`:**  
  נוסף ל־whitelist הנתיבים `/api/health/*` כדי שבדיקות health (ready/live) יעבדו בלי cookie.
- **כל הקריאות מהלקוח ל־API מוגנות:**  
  נוסף `credentials: 'include'` ל־`CryptoAnalyzer` (gems, settings/app), ל־`SimulationContext` (trades GET/POST, reset), ול־`PnlTerminal` (simulation/summary, portfolio/virtual) כדי שה־cookie תמיד יישלח.
- **`app/api/settings/app/route.ts` ו־`app/api/ops/metrics/route.ts`:**  
  נוסף `console.warn` לפני החזרת 401, כדי שיהיה מעקב אחר כישלונות אימות ב־API.

### 2. זרימת הניתוח והשגיאות
- **`app/actions.ts` — `analyzeCrypto` catch:**  
  במקום הודעה גנרית, מוחזרת כעת **השגיאה האמיתית** (`msg`) למשתמש (מלבד מקרי quota שמקבלים מסר ייעודי בעברית). בנוסף נוספו `console.warn` ו־`writeAudit` עם `message: msg` כדי לעקוב בלוגים אחר סיבת הכישלון.
- **`lib/analysis-core.ts` — שליפת Binance:**  
  החלפת `fetchJson` ב־**`fetchWithBackoff`** מ־`@/lib/api-utils` לשליפת קווי Binance (klines), כולל טיפול ב־429/418, Retry-After ו־backoff. בנוסף: לוג `console.warn` כששליפת ה־klines נכשלת או כששליפת ה־proxy נכשלת.

### 3. state ו־UI ב־CryptoAnalyzer ו־PnlTerminal
- **`components/CryptoAnalyzer.tsx`:**
  - כאשר `res.error === 'Unauthorized request.'` מוצגת למשתמש המחרוזת המתורגמת `t.unauthorizedRequest` ("אין הרשאה. יש להתחבר מחדש.").
  - בבלוק "הניתוח נכשל" מוצג כעת **המסר הטכני** (`error`) במקום טקסט קבוע, ובנוסף משפט עזר: "אם השגיאה קשורה להרשאה — התנתק והתחבר מחדש."

### 4. Error Boundaries ולוגים
- **`app/error.tsx`:**  
  הלוג ל־console כולל כעת גם `error.digest` (אם קיים). בתצוגה למשתמש נוסף בלוק עם **המסר הטכני** (`error.message`) בפונט מונו, כדי לאפשר אבחון בלי לפתוח כלים של מפתחים.

---

## איך להבטיח יציבות

1. **לאבחון 401:**  
   חפשו בלוגי השרת (Vercel / Node) את המחרוזות:  
   `[Auth] Unauthorized request:`, `[API settings/app GET] 401`, `[API ops/metrics] 401`, `[Analysis] Unauthorized`.

2. **אם מופיע "אין הרשאה. יש להתחבר מחדש":**  
   המשתמש צריך להתחבר מחדש (הטוקן פג או לא תקף). וודאו ש־`APP_SESSION_SECRET` לא משתנה בין פריסות וש־cookie `app_auth_token` נשמר עם `path: '/'` ו־`maxAge` מתאים.

3. **אם הניתוח נכשל עם הודעה אחרת:**  
   המסר שמופיע עכשיו ב־UI (ובבלוק הטכני ב־Error Boundary) הוא הסיבה מהשרת; בדקו גם את הלוגים `[Analysis] Failed:` ו־`[Analysis] Binance klines fetch failed`.

4. **Binance 429/418:**  
   `fetchWithBackoff` מטפל בניסיונות חוזרים ו־backoff; אם עדיין יש חסימות, בדקו את `PROXY_BINANCE_URL` ואת הלוגים של שליפת ה־proxy.

---

## סיכום

| נושא | לפני | אחרי |
|------|------|------|
| אימות נכשל | ללא לוג ברור, הודעה גנרית | לוג `[Auth]` / `[API ...] 401` + הודעת "אין הרשאה. יש להתחבר מחדש" ב־UI |
| כישלון ניתוח | "Analysis failed. Please try again." קבוע | החזרת השגיאה האמיתית + לוג `[Analysis] Failed:` |
| Binance klines | `fetchJson` + retry בלבד | `fetchWithBackoff` (429/418, backoff) + לוג כישלון |
| קריאות client ל־API | בלי `credentials: 'include'` | עם `credentials: 'include'` בכל הקריאות הרלוונטיות |
| Error Boundary | רק "שגיאה בהצגת הדף" | + הצגת `error.message` ואפשרות לראות digest ב־console |

עם השינויים האלה, זרימת האימות, הניתוח והשגיאות אמורות להיות ברורות יותר ועקביות, עם לוגים וטקסט טכני שמאפשרים השגת יציבות מלאה של המערכת.
