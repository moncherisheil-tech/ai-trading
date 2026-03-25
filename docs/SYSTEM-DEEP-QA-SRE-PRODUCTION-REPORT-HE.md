# דוח Deep QA ו־SRE — מוכנות פרודקשן

**תאריך:** מרץ 2026  
**סטטוס:** הושלם  
**היקף:** ביקורת איכות ומבנה לפני השקה סופית — Timeouts ב־Vercel, סריקת 20 דקות (Cron), MoE, Telegram ותוכן/UI.

---

## סיכום מנהלים

בוצעה ביקורת SRE ו־QA מקיפה לפי בקשת ה־CEO. המערכת חוזקה במספר צירים קריטיים: הארכת זמן ריצה (maxDuration) ל־API כבדים כדי למנוע חיתוך באמצע קריאות MoE, הגדרת Cron מפורש לסריקה כל 20 דקות עם אבטחת CRON_SECRET, טיפול מלא בשגיאות ובנפילות ב־Consensus Engine (כולל Judge ו־Groq 429), ומניעת הופעת "undefined" בהודעות Telegram. כמו כן בוצעו תיקוני RTL/תוכן באקדמיה ומסוף PnL.

---

## Phase 1: מוכנות Vercel ו־Timeouts (קריטי)

### 1.1 Timeouts ב־Serverless

**בעיה:** ב־Vercel ברירת המחדל ל־serverless היא כ־10–15 שניות. ארכיטקטורת MoE קוראת ל־4 מודלי AI במקביל (3 Gemini + 1 Groq) ועלולה להיקטע לפני סיום.

**פתרון:**

- **`export const maxDuration = 60`** (או הערך המקסימלי המותר במסלול) הוזרק לראש הקבצים הבאים:
  - `app/api/consultation/route.ts` — ייעוץ טכני + Agent Confidence.
  - `app/api/simulation/trades/route.ts` — שמירת עסקאות סימולציה.
  - `app/api/simulation/summary/route.ts` — סיכום תיק ו־positions.
  - `app/api/ops/metrics/pnl/route.ts` — חישוב רווח/הפסד והיסטוריה.
- **`app/api/cron/scan/route.ts`** ו־**`app/api/cron/scanner/route.ts`** — נשארו עם **`maxDuration = 300`** (5 דקות) כדי לאפשר סריקה מלאה של ה־market-scanner.

**תוצאה:** פונקציות כבדות לא ייקטעו באמצע חשיבה; משך הריצה מותאם ל־MoE ולסריקה.

### 1.2 סריקת 20 דקות (Cron) — ללא setInterval

**בעיה:** בסביבת serverless פונקציות "נרדמות" בין קריאות; `setInterval` לא רץ בין invocations ולכן לא מתאים לפרודקשן.

**פתרון:**

1. **`vercel.json`**  
   - נוסף Cron מפורש לסריקה כל 20 דקות:
   - **Path:** `/api/cron/scanner`
   - **Schedule:** `*/20 * * * *` (כל 20 דקות).
   - Cron הקיים של `/api/cron/scan` נשאר עם לוח זמנים יומי (למשל `0 1 * * *`) לפי הצורך.

2. **נוצר endpoint חדש: `/api/cron/scanner`**  
   - **קובץ:** `app/api/cron/scanner/route.ts`
   - **אבטחה:** בודק header `Authorization: Bearer <TOKEN>` מול `CRON_SECRET` או `WORKER_CRON_SECRET`. ללא תואם — מחזיר 401.
   - **לוגיקה:** קורא ל־`getScannerSettings()`; אם `scanner_is_active` כבוי — מחזיר `{ ok: true, status: 'disabled' }` בלי להריץ סריקה.
   - **עבודה:** קורא ל־`runOneCycle()` מ־`@/lib/workers/market-scanner` (אותו worker כמו ב־`/api/cron/scan`), ואז מעדכן `setLastScanTimestamp`.

**תוצאה:** הסריקה רצה כל 20 דקות דרך Vercel Cron, מאובטחת ב־CRON_SECRET, וללא תלות ב־setInterval.

---

## Phase 2: MoE — תקשורת ועמידות בשגיאות

### 2.1 Consensus Engine — אפס דחיות לא מטופלות

**ביקורת:** `lib/consensus-engine.ts` משתמש ב־`Promise.allSettled` לארבעת המומחים; כישלון של Gemini או Groq מחזיר ציוני fallback (50) ולוגיקה מתאימה. נקודת כשל אחת נותרה: **שופט (Judge)** — אם קריאת ה־Judge ל־Gemini נכשלת, הפונקציה זורקת חריגה ולא מחזירה תוצאה.

**פתרון:**

- עוטפים את הקריאה ל־`runJudge(...)` ב־**try/catch**.
- במקרה של חריגה: משתמשים ב־**fallback**:
  - `master_insight_he`: "תובנת קונצנזוס לא זמינה (שגיאה בשופט). המערכת משתמשת בציוני ארבעת המומחים בלבד."
  - `reasoning_path`: "שופט לא זמין — חישוב ציון סופי לפי משקלים בלבד."
- חישוב **final_confidence** ו־**consensus_approved** ממשיך כרגיל על בסיס ציוני ארבעת המומחים.

**תוצאה:** גם כאשר Judge (Gemini) נכשל או נחתך, המערכת מחזירה תשובה עקבית עם ציוני MoE וללא unhandled rejection.

### 2.2 Groq 429 (Rate Limit)

**מצב:** כאשר Groq מחזיר 429, `runExpertMacro` זורק; ה־fallback של המומחה הרביעי (ציון 50 + הודעת "לא זמין") כבר מופעל דרך `Promise.allSettled`.

**שיפור:** נוסף זיהוי מפורש של 429 בלוגים:
- אם השגיאה מזוהה כ־rate limit (סטטוס 429 או טקסט "rate limit"/"429") — נכתב לוג **warning**: "Groq Macro agent rate limited (429); using 3-agent fallback."
- שאר השגיאות נשארות כ־error log.

**תוצאה:** במצב 429 המערכת מחזירה fallback צפוי, וצוות התפעול יכול לזהות הגבלת קצב בלוגים.

### 2.3 Telegram — היעדר "undefined" בהודעות

**ביקורת:** ב־`lib/telegram.ts`, בפונקציה `sendEliteAlert`, השדות `masterInsightHe` ו־`macroLogicHe` משמשים לבניית הטקסט. אם `macro_logic` חסר או undefined, יש סיכון להצגת "undefined" בצ'אט.

**פתרון:**

- לפני שימוש: **`(params.masterInsightHe ?? '').trim()`** ו־**`(params.macroLogicHe ?? '').trim()`**.
- שורות "תובנת קונצנזוס" ו־"מקרו / Order Book" מתווספות רק כאשר המחרוזת לאחר trim אינה ריקה.

**תוצאה:** גם כאשר `macro_logic` או תובנת הקונצנזוס חסרים, ההודעה מעוצבת נכון וללא המילה "undefined".

---

## Phase 3: תוכן ו־UI

### 3.1 אקדמיה (`app/academy/page.tsx`)

- **RTL ועברית:** לדף כבר היה `dir="rtl"` על ה־container הראשי. נוסף **`lang="he"`** לשורש העמוד לצורך נגישות ותצוגה נכונה של עברית.
- **מבנה:** הכותרות, הרשימות והטקסטים בעברית עם יישור תואם; בלוקים עם `dir="ltr"` רק לשמות באנגלית (למשל term En) כדי לשמור על קריאות.

### 3.2 מסוף PnL (`components/PnlTerminal.tsx`)

- **מצב ריק / כישלון טעינה:**
  - כאשר **`data === null`** (פג תוקף או שלא התקבלו נתונים): מוצגת הודעה ברורה: "לא התקבלו נתונים (פג תוקף או שגיאה). נסה לרענן או להריץ הערכות."
  - כאשר **`data` קיים אך `!data.success`**: נשארת ההודעה הקיימת על כישלון טעינת נתוני רווח והפסד.
- **טבלת עסקאות ריקה:** כאשר אין עסקאות (למשל טרם בוצעו הערכות או עסקאות סימולציה), מוצגת הודעה אחת ברורה במקום תיבה ריקה או שגיאה:
  - "לא בוצעו עדיין עסקאות. הרץ הערכות או בצע עסקאות סימולציה כדי לראות נתונים."
  - הוחל הן בתצוגת מובייל והן בטבלת הדסקטופ, עם `dir="rtl"` מתאים.

---

## סיכום טכני — מוכנות פרודקשן

| נושא | סטטוס | פרט |
|------|--------|------|
| **Timeouts (Vercel)** | ✅ | maxDuration = 60 ל־consultation, simulation/trades, simulation/summary, ops/metrics/pnl; 300 ל־cron/scan ו־cron/scanner. |
| **Cron 20 דקות** | ✅ | vercel.json: path `/api/cron/scanner`, schedule `*/20 * * * *`. |
| **אבטחת Cron** | ✅ | `/api/cron/scanner` (ו־`/api/cron/scan`) בודקים CRON_SECRET / WORKER_CRON_SECRET ב־Authorization: Bearer. |
| **Market-scanner** | ✅ | שני ה־endpoints קוראים ל־`runOneCycle()`; כיבוי דרך `scanner_is_active` נתמך. |
| **MoE — Judge fallback** | ✅ | try/catch על runJudge; fallback ל־master_insight_he ו־reasoning_path. |
| **Groq 429** | ✅ | Fallback קיים; נוסף לוג warning ל־rate limit. |
| **Telegram — undefined** | ✅ | שימוש ב־(params.masterInsightHe ?? '').trim() ו־(params.macroLogicHe ?? '').trim(). |
| **אקדמיה — RTL/lang** | ✅ | dir="rtl", lang="he" על שורש הדף. |
| **PnL — מצבים ריקים** | ✅ | הודעות ברורות ל־null, ל־!success ולטבלה ללא עסקאות. |

המערכת מוגדרת כעת כמוכנה לפרודקשן מבחינת Timeouts, Cron מאובטח, עמידות MoE ושגיאות, ותצוגת תוכן/UI עקבית.
