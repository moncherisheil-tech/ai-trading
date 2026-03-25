# דוח שיפור מערכת ואקדמיית קריפטו

**תאריך:** מרץ 2025  
**סטטוס:** הושלם  
**היקף:** תיקון באג מפתחות React, ליטוש UI/UX וגישה, והוספת דף אקדמיה ומילון מונחים למתחילים.

---

## סיכום מנהלים

בוצע עדכון מקיף בשלושה שלבים: (1) תיקון שורש לבאג מפתחות כפולים בטבלת רווח/הפסד והבטחת ניקוי נכון ב־useEffect; (2) אחוד עיצוב "Institutional Glassmorphism", ריווח ונגישות; (3) הוספת דף **אקדמיית קריפטו ומילון מונחים** עם הסבר על ארבעת סוכני ה-AI ומונחים טכניים.

---

## Phase 1: תיקון באג מפתחות React וניקוי Effects

### 1.1 בעיית המפתחות הכפולים — מסוף רווח/הפסד

**קובץ:** `components/PnlTerminal.tsx`

**הבעיה:** שורות הטבלה (וגם רשימת העסקאות במובייל) השתמשו ב־`key={t.prediction_id}`. כאשר אותו `prediction_id` הופיע יותר מפעם אחת בנתונים, React זרק אזהרת duplicate key ויכול היה לגרום להתנהגות לא צפויה.

**הפתרון:**

1. **מפתח מורכב (Composite Key)**  
   כל שורה משתמשת כעת ב־`key={\`${t.prediction_id}-${idx}\`}` כדי להבטיח ייחוד גם כאשר יש כפילויות בנתונים.

2. **ניקוי נתונים לפני רינדור**  
   נוסף שלב דדופליקציה על מערך העסקאות לפי `prediction_id` באמצעות:
   ```ts
   const uniqueTradesScaled = useMemo(
     () => Array.from(new Map(tradesScaled.map((t) => [t.prediction_id, t])).values()),
     [tradesScaled]
   );
   ```
   `sortedTrades` ו־`paginatedTrades` נגזרים מ־`uniqueTradesScaled`, כך שהטבלה והרשימה במובייל מציגות עסקאות ייחודיות בלבד.

3. **סנכרון מובייל/דסקטופ**  
   במובייל מוצג כעת אותו דף (20 עסקאות) כמו בדסקטופ — `paginatedTrades` — עם אותו מפתח מורכב.

### 1.2 ניקוי useEffect ו־Strict Mode

**מטרה:** למנוע עדכון state אחרי unmount (במיוחד ב־React Strict Mode שמפעיל effects פעמיים).

**קומפוננטות שעודכנו:**

| קומפוננטה | שינוי |
|-----------|--------|
| **OverseerBanner** | ב־useEffect נוסף דגל `cancelled`. הפונקציה `run` בודקת `cancelled` לפני `setContext`/`setError`/`setLoading`. ב־cleanup: `cancelled = true` ו־`clearInterval`. |
| **AgentLearningCenter** | ב־useEffect נוסף `cancelled`; הלוגיקה הועברה ל־`run` פנימי שבודק `cancelled` אחרי fetch ולפני עדכון state. `fetchInsights` נשאר לשימוש כפתור "רענן". |

**קומפוננטות שכבר כללו cleanup:**  
PnlTerminal (ממומש עם `cancelled` ב־fetch של סימולציה ו־virtual portfolio), GemsStrip, MarketSafetyBanner, AppHeader, CryptoAnalyzer (ממומש עם `cancelled`/`mounted`), PerformanceShowcase, SettingsCommandCenter.

---

## Phase 2: ליטוש UI/UX ונגישות

### 2.1 עיצוב ואחידות

- **רקע וריווח:** דף הבית (`app/page.tsx`) משתמש ברקע `#050505` ו־`space-y-6` בין בלוקים; ריווח אנכי `py-6 sm:py-8` לדף נוח ופחות צפוף.
- **Header:** הוחלף ל־`bg-[#111111]/95`, `border-white/10`, `backdrop-blur-xl` — סגנון "Institutional Glassmorphism" תואם לשאר הממשק.
- **באנר בטיחות שוק (MarketSafetyBanner):**  
  - גודל גופן `text-sm sm:text-base`, `font-semibold`.  
  - מינימום גובה `min-h-[44px]` לנגישות מגע.  
  - צבעים מובחנים: `text-emerald-100` / `text-rose-100` על רקע `emerald-950` / `rose-950` לשיפור ניגודיות.

### 2.2 נגישות

- **Focus:** קיימת כבר ב־`globals.css` טבעת פוקוס `focus-visible` עם צבע amber (WCAG AA).
- **טאצ' ומקלדת:** כפתורים ו־links עם `min-h-[44px]` ו־`touch-manipulation` שם רלוונטי (למשל במסוף PnL).
- **RTL:** הכיווניות והריווח תומכים בעברית לאורך הדפים והכרטיסים.

---

## Phase 3: אקדמיית קריפטו ומילון מונחים

### 3.1 דף חדש

**נתיב:** `app/academy/page.tsx`

**תוכן:**

1. **בלוק פתיחה (Hero)**  
   כותרת "אקדמיית קריפטו & מילון מונחים", הסבר קצר שהדף מיועד למתחילים ומסביר מונחים שהמערכת משתמשת בהם.

2. **"איך זה עובד? ארבעת סוכני ה-AI"**  
   סעיף שמסביר את ארכיטקטורת MoE (תערובת מומחים) וארבעת הסוכנים:
   - **סוכן ניתוח שוק** — דפוסים טכניים, בלוקי פקודות, ויקוף, גריפות נזילות.
   - **סוכן סיכון** — חשיפה, פחד/חמדנות, R/R, הגנה על ההון.
   - **סוכן תיק** — הקצאה, פוזיציות וירטואליות, סימולציות.
   - **סוכן תובנות** — סיכום תובנות, למידה מטעויות, שיפורים לאסטרטגיה.

3. **מילון מונחים**  
   הסברים קצרים וברורים למונחים:
   - Institutional Order Blocks (בלוקי פקודות מוסדיים)
   - Wyckoff Accumulation / Distribution (צבירה והפצה לפי ויקוף)
   - Liquidity Sweeps (גריפת נזילות)
   - Whale Spoofing (זיוף לווייתנים)
   - Risk/Reward Ratio (R/R)
   - FOMO & Fear Index (פחד וחמדנות)
   - MoE (Mixture of Experts) Architecture

4. **קריאה לפעולה**  
   קישור "חזרה לאנליזר" לדף הבית.

### 3.2 ניווט

- **AppHeader:** נוסף קישור "אקדמיה" (אייקון GraduationCap) בתפריט הדסקטופ ובתפריט המובייל.
- **BottomNav:** נוסף פריט "אקדמיה" (אייקון GraduationCap) בניווט התחתון במובייל.

### 3.3 עיצוב הדף

- כרטיסים עם `rounded-2xl`, `border-white/10`, `bg-black/40`, `backdrop-blur-xl` — תואם לסגנון Institutional Glassmorphism.
- כותרות עם אייקונים (GraduationCap, Layers, BookOpen).
- ריווח ו־hover states עקביים; קישורים עם `focus-visible:ring-2` לנגישות מקלדת.

---

## קבצים שעודכנו / נוצרו

| קובץ | פעולה |
|------|--------|
| `components/PnlTerminal.tsx` | דדופליקציה לפי `prediction_id`, מפתח מורכב, מובייל משתמש ב־paginatedTrades |
| `components/OverseerBanner.tsx` | useEffect עם `cancelled` ו־cleanup |
| `components/AgentLearningCenter.tsx` | useEffect עם `cancelled` (לוגיקת fetch פנימית) |
| `app/page.tsx` | רקע אחיד, ריווח |
| `components/AppHeader.tsx` | סגנון header, קישור אקדמיה (דסקטופ + מובייל) |
| `components/MarketSafetyBanner.tsx` | ניגודיות, גודל גופן, min-height |
| `components/BottomNav.tsx` | פריט "אקדמיה" בניווט |
| `app/academy/page.tsx` | **חדש** — דף אקדמיה ומילון מונחים |
| `docs/SYSTEM-OVERHAUL-ACADEMY-REPORT-HE.md` | **חדש** — דוח זה |

---

## סיכום

- **באגים:** תוקן באג מפתחות כפולים במסוף רווח/הפסד (מפתח מורכב + דדופליקציה). הושלם sweep ל־useEffect עם cleanup מתאים ב־OverseerBanner ו־AgentLearningCenter.
- **UI/UX:** הושרה עקביות בעיצוב (רקע, גבולות, blur), ריווח ונגישות בסיסית (גודל גופן, ניגוד, גובה מינימלי לכפתורים).
- **תוכן חדש:** דף אקדמיה עם הסבר על ארבעת הסוכנים ומילון מונחים למתחילים, נגיש מההדר ומהניווט התחתון.

---

*דוח זה מסכם את העדכונים שבוצעו במסגרת שיפור המערכת והוספת מרכז החינוכי (אקדמיה).*
