# דוח QA — UI/UX וזיכרון ארוך־טווח ל־AI  
**Mon Cheri Quant AI** — עדכון: מרץ 2025

---

## חלק 1: תיקוני UI/UX (Blind QA)

### 1.1 RTL ויישור (Logical Properties)

הוחלפו מחלקות Tailwind פיזיות במקבילות לוגיות כדי לשמור על RTL (עברית) עקבי:

| קובץ | שינוי |
|------|--------|
| **PnlTerminal.tsx** | `mr-0.5` → `me-0.5` ליד אייקוני פחד/חמדנות; כותרות טבלה ו־td: `text-right` → `text-end`, `text-left` → `text-start` |
| **CryptoAnalyzer.tsx** | `ml-1` → `ms-1` ליד "מסקנת למידה" |
| **SymbolSelect.tsx** | `mr-2` → `me-2`; `left-0 right-0` → `start-0 end-0` ל־dropdown |
| **CryptoTicker.tsx** | `mr-0.5` → `me-0.5`; `border-r` → `border-e` בין tickers |
| **BottomNav.tsx** | `left-0 right-0` → `start-0 end-0` לניווט תחתון |

עמוד **Login** כבר השתמש ב־`ps-4`, `pe-4`, `start-4` — לא שונה.

### 1.2 מובייל ו־Overflow

- **app/login/page.tsx**  
  - הוסף `max-w-full overflow-x-hidden` ל־wrapper הראשי.  
  - כרטיס הלוגין: `max-w-md` → `max-w-full sm:max-w-md` כדי שבמובייל לא יישבר רוחב.
- **layout.tsx (root)**  
  - כבר קיים: `overflow-x-hidden`, `max-w-[100vw]` על ה־body — לא שונה.
- **MainDashboard.tsx**  
  - כבר קיים: `max-w-full overflow-x-hidden` על ה־wrapper — לא שונה.
- **PnlTerminal.tsx**  
  - טבלאות עם `min-w-[580px]` ו־`min-w-[400px]` נשארות בתוך `overflow-x-auto` (כבר קיים) — גלילה אופקית רק באזור הטבלה, בלי לשבור את המסך.

### 1.3 Z-Index ו־Glassmorphism

- **layout.tsx**: `overflow-x-hidden` על ה־html וה־body מונע יצירת stacking context מיותר.
- **SymbolSelect** ו־**BottomNav** משתמשים ב־`z-50` — מתאימים ל־dropdown ו־sticky nav; לא זוהו חפיפות עם כרטיסי glassmorphism (`backdrop-blur`).

---

## חלק 2: זיכרון ארוך־טווח ל־AI (Long-Term Memory)

### 2.1 הבעיה

מנוע הרטרוספקטיבה חישב דיוק, עדכן משקלים ושלח דוח לטלגרם, אך **לא שמר באופן קבוע** את הדלתא (תחזית מול מציאות) למסד. בלי אחסון קבוע, המערכת לא יכלה ללמוד לאורך זמן מההיסטוריה.

### 2.2 הפתרון — טבלת `ai_learning_ledger`

נוספה טבלה חדשה במסד (SQLite) בשם **`ai_learning_ledger`**:

| עמודה | סוג | תיאור |
|--------|------|--------|
| `id` | INTEGER PK | מפתח ראשי |
| `prediction_id` | TEXT UNIQUE | מזהה תחזית (מנע כפילויות) |
| `timestamp` | TEXT | זמן הערכה (evaluated_at) |
| `symbol` | TEXT | סמל הנכס |
| `predicted_price` | REAL | מחיר בזמן התחזית (entry_price) |
| `actual_price` | REAL | מחיר בפועל |
| `error_margin_pct` | REAL | טעות באחוזים (absolute_error_pct) |
| `ai_conclusion` | TEXT | מסקנה קצרה (למשל bottom_line_he או outcome_label) |
| `created_at` | TEXT | מועד הכנסה ל־ledger |

נוספו אינדקסים: `timestamp`, `symbol`, `prediction_id` (UNIQUE).

### 2.3 קבצים שנוספו/עודכנו

- **lib/db/ai-learning-ledger.ts** (חדש)  
  - יצירת הטבלה והאינדקסים.  
  - `insertLearningLedgerRow()` — הכנסה בודדת (idempotent עם `INSERT OR IGNORE`).  
  - `syncHistoricalToLedger()` — סנכרון מרשומות `historical_predictions` ל־ledger (מדלג על כפילויות).  
  - `getLedgerBySymbol()`, `getRecentLedger()` — שאילתות לשימוש עתידי (למשל כיול confidence לפי סמל או MAE).

- **lib/ai-retrospective.ts**  
  - אחרי הרצת הניתוח והכנסת דוח ל־`learning_reports`, מופעל סנכרון: נטענות עד 200 תחזיות אחרונות מ־`historical_predictions` וכל רשומה מוכנסת ל־`ai_learning_ledger` (רק אם אין כבר רשומה עם אותו `prediction_id`).  
  - הפונקציה `runRetrospectiveAndReport()` מחזירה כעת גם `ledgerSynced` (מספר הרשומות שהוכנסו ל־ledger בהרצה הזו).

- **app/api/cron/retrospective/route.ts**  
  - משתמש ב־`ledgerSynced` ומחזיר אותו ב־JSON התשובה.

### 2.4 לולאת Feedback קבועה

בכל הרצה של `/api/cron/retrospective` (או אחרי סגירת עסקאות וירטואליות):

1. מנוע הרטרוספקטיבה מנתח ביצועים ומעדכן משקלים.
2. דוח "Lessons Learned" נשמר ב־`learning_reports`.
3. **חדש:** התחזיות שאומתו נשמרות ב־`ai_learning_ledger` (תחזית מול מציאות + מסקנה).
4. דוח נשלח לטלגרם.

בהמשך ניתן לבנות לוגיקה שתשתמש ב־`getLedgerBySymbol()` ו־`getRecentLedger()` כדי:
- לחשב טעות ממוצעת (MAE) לפי סמל או לאורך זמן.
- להתאים ציוני confidence (confidence scores) לפי היסטוריית טעויות.

---

## סיכום

- **UI/UX:** תוקנו RTL (יישור ומרווחים לוגיים), הוגן overflow במובייל בעמוד הלוגין, ונ confirmed שהמבנה הקיים (layout, MainDashboard, טבלאות) תומך במובייל ו־RTL.
- **AI Memory:** טבלת `ai_learning_ledger` מאפשרת שמירה קבועה של תחזית מול מציאות ומסקנה; מנוע הרטרוספקטיבה ממלא אותה אוטומטית ומחזיר `ledgerSynced` ב־API.
