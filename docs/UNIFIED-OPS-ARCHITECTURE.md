# ארכיטקטורה מאוחדת: `/` ו־`/ops`

## מה הייתה הבעיה

- **דף הבית (`/`):** הציג את הדשבורד המלא — `AppHeader`, `GemsStrip`, `CryptoAnalyzer` — מחובר ל-Neon Postgres דרך `getDbAsync` ופעיל.
- **דף האופס (`/ops`):** אחרי התחברות הופנה המשתמש ל־`/ops` וראה דף **נפרד וישן**: רק `SimulateBtcButton` + `OpsMetricsBlock`, בלי `CryptoAnalyzer`, בלי `GemsStrip`, עיצוב slate שונה, וחוויית "אפליקציה אחרת" עם קומפוננטות מנותקות.

כלומר: שני מקורות אמת — דשבורד אחד ב־`/` ודשבורד מצומצם ב־`/ops` — מה שיצר פיצול בחוויית המשתמש ובתחזוקת הקוד.

## מה תוקן

### 1. קומפוננטה משותפת: `MainDashboard`

- **נוצר:** `components/MainDashboard.tsx`
- **תוכן:** `GemsStrip` + `CryptoAnalyzer` (כולל dynamic import ו-loading state).
- **מטרה:** מקור אמת יחיד לתוכן הדשבורד הראשי — ניתוח סימבולים, ג'מס, היסטוריה — כך ש־`/` ו־`/ops` משתמשים **באותו קוד**.

### 2. דף הבית (`app/page.tsx`)

- **לפני:** ייבוא ישיר של `GemsStrip` + `CryptoAnalyzer` עם dynamic.
- **אחרי:** `AppHeader` + `<MainDashboard />` — אותו UI, דרך קומפוננטה אחת.

### 3. דף האופס (`app/ops/page.tsx`)

- **לפני:** רק כותרת, `SimulateBtcButton`, `OpsMetricsBlock` — בלי דשבורד הניתוח.
- **אחרי:**
  - **אותו דשבורד:** `<MainDashboard />` (אותו `GemsStrip` + `CryptoAnalyzer` כמו ב־`/`).
  - **בנוסף:** בלוקים ייעודיים לאופס — `SimulateBtcButton`, `OpsMetricsBlock` — מתחת לדשבורד.
  - **עיצוב:** `bg-zinc-900`, `max-w-7xl` — זהה ל־`/` (אין יותר slate נפרד).

### 4. עיצוב מאוחד ב־`/ops`

- **`app/ops/layout.tsx`:** רקע ו-header עברו מ־slate ל־**zinc** (zinc-900, zinc-800, zinc-700) + `amber` ללינקים, בהתאמה ל־`AppHeader` ולדשבורד.
- **`OpsMetricsBlock` ו־`SimulateBtcButton`:** כל ה־slate הוחלף ל־zinc (וגווני amber במקום emerald בכפתור הסימולציה) כדי להתאים למערכת העיצוב של הדשבורד.

### 5. חיבורי נתונים

- **`/api/ops/metrics`:** כבר משתמש ב־`getDbAsync()` מ־`lib/db.ts` (Neon Postgres) עם try/catch — אין SQLite.
- **`/ops/strategies`** ו־**`/ops/pnl`:** נשארים עם ה-APIs הקיימים (strategy-repository קובץ, backtest-repository קובץ); לא נדרש שינוי ל-Neon לצורך האיחוד.

## קבצים שהשתנו

| קובץ | שינוי |
|------|--------|
| `components/MainDashboard.tsx` | **חדש** — GemsStrip + CryptoAnalyzer משותף |
| `app/page.tsx` | שימוש ב־MainDashboard במקום ייבוא ישיר |
| `app/ops/page.tsx` | רינדור MainDashboard + בלוקי אופס, עיצוב zinc |
| `app/ops/layout.tsx` | עיצוב zinc + `dynamic = 'force-dynamic'` |
| `components/OpsMetricsBlock.tsx` | slate → zinc |
| `components/SimulateBtcButton.tsx` | slate → zinc, emerald → amber |

## איך לוודא מקומית ו-production

1. **מקומי:** `npm run dev`
   - גלוש ל־`/` — דשבורד מלא (ג'מס, ניתוח, היסטוריה).
   - התחבר כ־admin והיכנס ל־`/ops` — **אותו דשבורד** (ג'מס + ניתוח) + מתחתיו סימולציית BTC ומדדי מערכת; עיצוב zinc כמו בדף הבית.
2. **Production (Vercel):**
   - אחרי פריסה, כניסה ל־`/ops` אחרי לוגין אמורה להציג את **אותו דשבורד** כמו ב־`/`, עם בלוקי אופס מתחתיו וללא "דשבורד ריק" או עיצוב שונה.

## סיכום בעברית

**למה `/ops` היה שבור:** דף האופס לא השתמש באותו דשבורד כמו דף הבית — הוא הציג רק שני בלוקים (סימולציה ומדדים) בעיצוב slate נפרד, בלי `CryptoAnalyzer` ו־`GemsStrip`, ולכן נראה מנותק וחסר.

**איך אוחד:** הוגדרה קומפוננטה משותפת `MainDashboard` (ג'מס + ניתוח), דף הבית והדף אופס משתמשים בה, ועיצוב `/ops` (layout + קומפוננטות) הותאם ל־zinc כמו בדשבורד הראשי. כעת `/` ו־`/ops` חולקים את **אותו דשבורד** עם מקור קוד אחד, ו־`/ops` מוסיף עליו רק את הפיצ'רים הניהוליים.
