# סיכום: לוקליזציה עברית, חיבור נתוני Quant וחיזוק ממשק

## 1. לוקליזציה בממשק (UI Localization)

### פריסה ושפה
- **`app/layout.tsx`** — תגית `<html>` עם `lang="he"` ו־`dir="rtl"` כבר מוגדרת. הממשק מוצג בעברית ו־RTL.
- **`app/ops/layout.tsx`** — המעטפת עם `dir="rtl"` על ה־div הראשי.
- **`app/error.tsx`** ו־**`app/global-error.tsx`** — כותרות, הודעות וכפתורים בעברית.

### רכיבים שעודכנו
- **כניסה:** טקסט "Loading…" הוחלף ל־**"טוען…"** ב־`app/login/page.tsx`.
- **מסוף רווח והפסד (PnlTerminal):** כל התוויות והכותרות תורגמו לעברית: "חזרה ללוח", "מסוף רווח והפסד", "מינוף", "תיק כולל", "רווח נקי (%)", "אחוז הצלחה", "מקדם רווח", "שפל מקסימלי", "עקומת הון", "ביצועים יומיים / חודשיים", "20 עסקאות אחרונות", עמודות הטבלה (תאריך, סמל, כיוון, רווח/הפסד, הצלחה/הפסד, סטטוס סיכון), "פחד" / "חמדנות" במקום Fear/Greed, ו־"אין עדיין עסקאות" / "אין עדיין נתוני הון" וכו'.
- **ייצוא PDF:** תוכן הדוח ב־PnlTerminal (כותרות, תיאורים) הוחלף לעברית.
- **LanguageToggle:** `aria-label` עודכן ל־**"החלף שפה"**.

### הנחיית ה־AI (מנוע הכמותי)
- **`lib/analysis-core.ts`:** נוספה הנחיה מפורשת:  
  **"CRITICAL LOCALIZATION: ALL textual analysis, logic summaries, bottom lines, strategic advice, learning context, and evidence snippets MUST be generated in fluent, professional Hebrew. Do not output English text for these fields."**  
  כך שכל השדות הטקסטואליים (logic, strategic_advice, learning_context, evidence_snippet) נוצרים בעברית מקצועית.

---

## 2. חיבור נתוני Quant (Data Connectivity)

### שדות מהמנוע הכמותי
- **`risk_level` / `risk_level_he`:** מוצגים ב־**CryptoAnalyzer** וב־**דף התובנות (Insights)**. עיצוב לפי תוכן:
  - **סיכון גבוה** — צבע אדום (`text-red-400`).
  - **סיכון נמוך** — צבע ירוק (`text-emerald-400`).
  - **סיכון בינוני** — צבע ענבר (`text-amber-400/90`).
- **`logic`:** מוצג תמיד בכרטיס התחזית ב־CryptoAnalyzer (סעיף "לוגיקת AI") ובדף התובנות; במקרה של ערך חסר מוצג **"לא זמין"**.
- **כיוון (direction):** ב־PnlTerminal טבלת העסקאות משתמשת במערך **DIRECTION_HE** (שורי / דובי / ניטרלי) במקום Bullish/Bearish/Neutral.

### זרימת נתונים
- התחזית האחרונה נשענת על `history[0]`; השדות `probability`, `target_percentage`, `entry_price`, `logic`, `risk_level_he`, `bottom_line_he`, `forecast_24h_he`, `strategic_advice`, `learning_context`, `sources` מוצגים עם גישה בטוחה וברירת מחדל היכן שנדרש.

---

## 3. חיזוק ממשק (Hardening & Fallbacks)

### גישה בטוחה וערכי ברירת מחדל
- **CryptoAnalyzer:**
  - `latestPrediction.probability` — מוצג כ־`probability != null ? \`${probability}%\` : '—'`.
  - `latestPrediction.target_percentage` — `(latestPrediction.target_percentage ?? 0)`.
  - `latestPrediction.entry_price` — `(latestPrediction.entry_price ?? 0).toLocaleString()`.
  - `latestPrediction.logic` — **`logic ?? 'לא זמין'`**.
  - `strategic_advice` / `learning_context` — רינדור רק כאשר יש תוכן (כולל `trim`); בתוך הבלוק: `?? 'לא זמין'`.
  - **מקורות (sources):** `(latestPrediction.sources?.length ?? 0) > 0`, ומעבר על `(latestPrediction.sources ?? [])`; כל פריט עם `source?.source_name ?? 'לא זמין'`, `source?.source_type ?? '—'`, `source?.relevance_score`, `source?.evidence_snippet ?? 'לא זמין'`; מפתח ב־key: `source?.source_name ?? idx`.
- **דף התובנות:** `record.logic ?? 'לא זמין'` כך שתמיד מוצגת שורת לוגיקה (ללא קריסה או ריק).
- **עיצוב risk_level_he:** שימוש ב־`String(risk_level_he).includes('גבוה')` / `includes('נמוך')` כדי למנוע קריסה כשהערך לא מחרוזת.

### סיכום
- כל השדות הרלוונטיים מהתחזית נגישים עם optional chaining ו/או ערך ברירת מחדל בעברית ("לא זמין" או "—") כדי למנוע תצוגה ריקה או קריסה כשהנתונים חלקיים או חסרים.
