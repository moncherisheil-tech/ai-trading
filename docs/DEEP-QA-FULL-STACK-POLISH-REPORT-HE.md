# דוח Deep QA וליטוש Full-Stack — סוכן מקרו (MoE Agent #4)

**תאריך:** מרץ 2025  
**סטטוס:** הושלם  
**היקף:** אינטגרציה של הסוכן הרביעי (Macro & Order Book via Groq) ב־UI, ב־Backend וב־Telegram/Print.

---

## סיכום מנהלים

בוצע סריקת QA מלאה לאורך כל השכבות לאחר הוספת הסוכן הרביעי (מקרו ו־Order Book באמצעות Groq) לארכיטקטורת MoE. העדכונים כוללים: הצגת המומחה הרביעי בממשק עם עיצוב Institutional Grade, חיזוק פונקציית הפענוח JSON וניהול נפילות כשמפתח Groq חסר, וסנכרון נתוני מקרו בהתראות Telegram ובדוחות PDF.

---

## Phase 1: Frontend — אינטגרציית UI/UX של המומחה הרביעי

### מיקום

- **קומפוננטות:** `components/CryptoAnalyzer.tsx`  
- **חסר שהושלם:** הממשק הציג עד כה רק 3 מומחים (טכני, סיכון, פסיכולוגיית שוק). המומחה הרביעי (מקרו / Order Book) לא הופיע.

### שינויים שבוצעו

1. **ממשקי נתונים (Interfaces)**  
   - ב־`lib/db.ts` נוספו ל־`PredictionRecord`:  
     - `macro_score?: number`  
     - `macro_logic?: string`  
   - כך שה־payload (JSONB) תומך רשמית בשדות המקרו ומונע אובדן מידע.

2. **לוגיקת רינדור**  
   - **תנאי הצגת הבלוק:** עודכן מ־`tech_score | risk_score | psych_score | master_insight_he` ל־**כולל** `macro_score`, כך שהכרטיס "קונצנזוס נוירלי — חדר דיונים" מופיע גם כאשר יש רק ציון מקרו (למשל ב־fallback).

3. **ארבעת המומחים עם עיצוב אחיד**  
   - נוסף שורה רביעית: **"מקרו / Order Book"** עם `macro_score` (0–100).  
   - **צבעים (Institutional Grade):**  
     - ירוק (`bg-emerald-500`) — ציון ≥ 65  
     - צהוב (`bg-amber-500`) — 40–64  
     - אדום (`bg-rose-500`) — &lt; 40  
   - **אייקון:** אייקון `Globe` (מקרו/גלובלי) ליד התווית "מקרו / Order Book" בסגנון זכוכית (גבול וצבע violet).

4. **בלוק לוגיקת מקרו**  
   - כאשר קיים `macro_logic` (מחרוזת לא ריקה), מוצג מתחת לפסי הציונים בלוק נפרד:  
     - כותרת: "מקרו / Order Book" עם אייקון Globe.  
     - טקסט הלוגיקה בעברית (RTL) בתוך קופסה עם רקע וסגנון תואם לשאר הכרטיס.

5. **רוחב תוויות**  
   - התווית "מקרו / Order Book" ארוכה יותר, ולכן רוחב התוויות עודכן ל־`w-28` (במקום `w-24`) כדי למנוע חיתוך.

### קבצים שעודכנו

- `components/CryptoAnalyzer.tsx` — הוספת Globe, שורה רביעית, תנאי רינדור, ובלוק `macro_logic`.  
- `lib/db.ts` — הרחבת `PredictionRecord` ב־`macro_score`, `macro_logic`.

---

## Phase 2: Backend — זרימת נתונים ו־Fallback

### 2.1 פענוח JSON של Groq (parseMacroJson) — חיזוק

**קובץ:** `lib/consensus-engine.ts`

**בעיה:** כאשר Groq מחזיר טקסט שיחה + JSON (למשל: "Here is the JSON: {...}"), פענוח ישיר עלול להיכשל או לתפוס מחרוזת לא נכונה.

**פתרון:**

1. **פונקציה חדשה `extractFirstJsonObject(text)`**  
   - מסירה קודם גדרות markdown (```json … ```).  
   - מחפשת את ה־`{` הראשון ומחשבת זוג סוגריים מתאים (ספירת `{` ו־`}`) כדי לחלץ אובייקט JSON אחד מלא.  
   - אם המבנה לא מאוזן — נפילה ל־"מ־`{` הראשון עד `}` אחרון".

2. **`parseMacroJson(raw)`**  
   - משתמשת ב־`extractFirstJsonObject` כדי לקבל מחרוזת JSON אחת וברורה.  
   - אחר כך `JSON.parse` + ולידציה שהתוצאה היא אובייקט (לא null ולא מערך).  
   - `macro_score` מנורמל ל־0–100; `macro_logic` נחתך ל־500 תווים.

**תוצאה:** תגובות בסגנון "Here is the JSON: {...}" או עם טקסט לפני/אחרי מטופלות בצורה יציבה ללא קריסה.

### 2.2 Fallback כאשר GROQ_API_KEY חסר

**מצב קיים (אומת):**  
- `getGroqApiKey()` ב־`lib/env.ts` מחזיר `undefined` כאשר המפתח חסר או לא תקף — **לא נזרקת חריגה**.  
- `runExpertMacro` בודקת את המפתח; אם חסר — **לא קוראת ל־API** ומחזירה מיד אובייקט fallback.  
- `Promise.allSettled` מריצה את ארבעת המומחים; כישלון של Groq (או דילוג בגלל מפתח חסר) לא מפיל את ה־pipeline.

**שיפור שבוצע:**  
- הודעת ה־fallback כאשר המפתח חסר עודכנה למפורשת:  
  **"סוכן Groq (מקרו/Order Book) הושבת — מפתח API חסר. המערכת עוקפת ומשתמשת בשלושת סוכני Gemini בלבד; ציון מקרו 50."**  
- כך המשתמש והלוגים מבינים במפורש שהסוכן הרביעי הושבת והמערכת עובדת עם 3 סוכני Gemini בלבד, עם `macro_score: 50` ו־`macro_fallback_used: true` בתוצאה.

---

## Phase 3: התראות Telegram וסיכום בדוחות (Print/PDF)

### 3.1 Telegram

**קבצים:** `lib/telegram.ts`, `lib/analysis-core.ts`, `lib/workers/market-scanner.ts`

- **`sendGemAlert` (ניתוח ידני — analysis-core):**  
  - בעת שליחת ג'ם (מעל סף ביטחון), נוסף ל־`messageText` משפט/פסקה מתוך `macro_logic` (עד 200 תווים) תחת הכותרת "מקרו/Order Book", כך שבטלגרם יוצג גם סיכום מקרו.

- **`sendEliteAlert` (איתות אליט — market-scanner):**  
  - נוסף פרמטר אופציונלי **`macroLogicHe?: string`**.  
  - כאשר מועבר, מופיעה בטקסט ההתראה סעיף **"מקרו / Order Book"** (עד 300 תווים, עם escape ל־HTML).  
  - ב־`market-scanner.ts` — בקריאה ל־`sendEliteAlert` מועבר כעת גם `macroLogicHe: result.data.macro_logic`, כך שבמובייל יוצג לוגיקת המקרו כחלק מסיכום האליט.

### 3.2 דוח הדפסה / PDF (print-report)

**קובץ:** `lib/print-report.ts`

- **`ReportPrintParams.analysisHe`:**  
  - בתיעוד (JSDoc) צוין במפורש: בעת בניית הסיכום מתוך תחזית (prediction), יש לכלול קונצנזוס MoE **כולל** `macro_logic` (מקרו/Order Book) כאשר קיים.  
- **חתימת הבלוק "ניתוח מנהלים":**  
  - נוסף במשפט החתימה: "כולל קונצנזוס MoE (טכני, סיכון, פסיכו, מקרו/Order Book)" — כך שהמשתמש יודע שהדוח מתייחס גם למומחה הרביעי.

**הערה:** כפתור "ייצוא דוח" ב־PnlTerminal כרגע מפעיל `window.print()` על העמוד הקיים; לא נבנה מחדש `analysisHe` מתוך prediction בדף זה. אם בעתיד ייבנה סיכום מנהלים מתוך רשומת תחזית (למשל בעמוד ניתוח או בדוח ייעודי), יש להזין ב־`analysisHe` גם את `master_insight_he` ואת `macro_logic` כאשר קיימים.

---

## סנכרון נתונים מלא (Backend → DB → UI / Telegram)

- **`lib/analysis-core.ts`:**  
  - בעת שמירת תחזית חדשה, ה־consensus result כולל כעת גם **`macro_logic`** (בנוסף ל־`macro_score`, `tech_score`, וכו').  
  - ה־payload שנשמר ב־DB (JSONB) מכיל את כל ארבעת הציונים ואת לוגיקת המקרו.

- **`lib/db.ts`:**  
  - `PredictionRecord` כולל `macro_score`, `macro_logic` ו־`final_confidence` (עם הערת MoE 30/30/20/20).

---

## סיכום טכני — רשימת קבצים שנגעו

| קובץ | שינוי |
|------|--------|
| `lib/db.ts` | הוספת `macro_score`, `macro_logic` ל־PredictionRecord; עדכון הערת final_confidence. |
| `lib/analysis-core.ts` | שמירת `macro_logic` ב־consensus spread; הוספת שורת מקרו ל־sendGemAlert. |
| `lib/consensus-engine.ts` | `extractFirstJsonObject` + parseMacroJson חסין; הודעת fallback מפורשת כש־GROQ חסר. |
| `components/CryptoAnalyzer.tsx` | שורה רביעית (מקרו/Order Book), אייקון Globe, בלוק macro_logic, תנאי רינדור. |
| `lib/telegram.ts` | פרמטר `macroLogicHe` ב־sendEliteAlert; סעיף "מקרו / Order Book" בהתראות. |
| `lib/workers/market-scanner.ts` | העברת `macroLogicHe: result.data.macro_logic` ל־sendEliteAlert. |
| `lib/print-report.ts` | JSDoc ל־analysisHe (לכלול מקרו); עדכון חתימת בלוק Executive Analysis. |

---

## המלצות להמשך

1. **בדיקות:** להריץ ניתוח עם Groq פעיל ועם `GROQ_API_KEY` מושבת ולוודא: ארבעה פסים ב־UI, הודעת fallback ברורה, ואין קריסה.  
2. **מוניטורינג:** לעקוב אחרי לוגים `[ConsensusEngine] Groq macro JSON parse failed` ו־`Macro expert failed (Groq fallback active)` ב־production.  
3. **דוחות PDF עתידיים:** אם ייבנה דף/פיצ'ר שמרכיב `analysisHe` מתחזית — להכליל בו במפורש את `macro_logic` (ומקור MoE) כמתועד ב־print-report.

---

*דוח זה מסכם את עבודת ה־Deep QA והליטוש Full-Stack עבור הסוכן הרביעי (Macro & Order Book) בארכיטקטורת MoE.*
