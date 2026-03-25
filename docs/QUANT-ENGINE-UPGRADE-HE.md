# שדרוג מנוע החיזוי — מנוע Quantitative AI ברמת מוסדית

## סקירה כללית

מנוע החיזוי עודכן מתשובת API בסיסית למנוע **Quantitative AI** ברמת מוסדית: הנחיות מובנות (prompt engineering), נתונים מועשרים, פלט JSON דטרמיניסטי ומנגנון משוב ללמידה מתמדת.

---

## 1. איך "מוח" ה-AI שודרג

### דמות המערכת (Persona)

- **לפני:** ה-AI פעל כאנליסט קריפטו כללי עם הנחיה קצרה להחזיר JSON.
- **אחרי:** ה-AI מוגדר כ־**Elite Quantitative Analyst and Principal AI Architect**: עליו לשקול במפורש:
  1. **סנטימנט שוק** — `sentiment_score`, `market_narrative`
  2. **לוגיקת Order Book** — כפי שמשתמעת מנפח ותנודתיות (עד שיוזן עומק Order Book אמיתי)
  3. **תנודתיות** — `technical_indicators.volatility_pct`
  4. **זיהוי דפוסים היסטוריים** — שימוש ב־`past_mistakes_to_learn_from` ו־`historical_prediction_outcomes` כדי להוריד ביטחון או לכוון ל־Neutral כשההיסטוריה מראה טעיות חוזרות.

### פלט מובנה (JSON)

ה-AI מחויב להחזיר JSON עם השדות הבאים:

| שדה | תיאור |
|-----|--------|
| `predicted_direction` | Bullish / Bearish / Neutral |
| `probability` | 0–100 (הסתברות להצלחת הכיוון) |
| `target_percentage` | אחוז תנועת מחיר צפוי |
| `risk_level` | High / Medium / Low |
| `logic` | סיכום אנליטי קצר בעברית — הנמקה מפורשת |

בנוסף: `strategic_advice`, `learning_context`, `sources` (מערך מקורות עם `evidence_snippet`, `relevance_score`).

---

## 2. פרמטרים ונתונים שהמנוע שוקל כעת

### נתונים שנשלחים למודל

- **מחיר נוכחי ו־OHLCV** — 5 ימים אחרונים (ואפשר להרחיב).
- **נפח** — `volume_delta_percent` (שינוי נפח ביחס ליום הקודם).
- **Fear & Greed Index** — ערך וסיווג.
- **סנטימנט חדשות** — `sentiment_score` (-1 עד 1), `market_narrative`.
- **אינדיקטורים טכניים** (`technical_indicators`):
  - `rsi_14` — RSI מחושב מקומית מ־Binance.
  - `volatility_pct` — תנודתיות (טווח High–Low ביחס למחיר) באחוזים.
  - `macd_signal` — אופציונלי; המבנה מוכן להזרקה כשמקור MACD יהיה זמין.
- **הקשר היסטורי (משוב):**
  - `past_mistakes_to_learn_from` — תחזיות שעברו הערכה עם `error_report` (הערת למידה) מאותו סמל.
  - `historical_prediction_outcomes` — מתוך טבלת `historical_predictions` (כשזמין): `outcome_label`, `absolute_error_pct`, `probability`, `target_percentage` וכו', כדי שה-AI ילמד מטעיות ויתאים ביטחון.

### Order Book והרחבות עתידיות

- כרגע נשלח `order_book_note` שמסביר שעומק Order Book לא מסופק ומנחה את המודל להסיק מנפח ותנודתיות.
- המבנה מאפשר הזרקה עתידית של RSI/MACD או אינדיקטורים נוספים דרך `technical_indicators` בלי לשנות את חוזה ה־API.

---

## 3. מנגנון הלמידה (Feedback Loop)

### איך תחזיות מעובדות לאחר מעשה

1. **הערכת תחזיות ממתינות** — `evaluatePendingPredictions()` (ב־`app/actions.ts`):
   - מביא מחיר נוכחי מ־Binance.
   - קורא ל־`evaluatePredictionOutcome()` (ב־`lib/agents/backtester.ts`) ומקבל: `isCorrect`, `priceDiffPct`, `absoluteErrorPct`, `outcomeLabel`.

2. **שמירה ל־Historical Context:**
   - רשומה נשמרת ב־`historical_predictions` (SQLite) עם: `prediction_id`, `symbol`, `predicted_direction`, `entry_price`, `actual_price`, `price_diff_pct`, `absolute_error_pct`, `target_percentage`, `probability`, `outcome_label`, `sentiment_score`, `market_narrative` וכו'.
   - אם התחזית שגויה, נשלח ל־Gemini prompt "You made a wrong prediction..." והתשובה נשמרת כ־`error_report` ברשומת החיזוי (ובמקביל משמשת בהקשר של `past_mistakes_to_learn_from` כשמביאים רשומות מאותו סמל).

3. **הזנת ההקשר לחיזוי הבא:**
   - בכל הרצת `doAnalysisCore()`:
     - **מהמאגר הראשי (Postgres/File):** נשלפות עד 5 תחזיות אחרונות באותו סמל עם סטטוס `evaluated` ו־`error_report` → נשלח כ־`past_mistakes_to_learn_from`.
     - **מ־historical_predictions (SQLite):** `getHistoricalBySymbol(symbol, 10)` → נשלח כ־`historical_prediction_outcomes` (outcome, error margin, probability וכו').
   - ה־system prompt מנחה את המודל: כשמופיעות טעיות חוזרות או `absolute_error_pct` גבוה, להוריד הסתברות או לכוון ל־Neutral.

### סיכום

- **הערכה:** כל תחזית ממתינה מושווית למחיר בפועל; התוצאה (הצלחה/כישלון, שולי טעות) נשמרת.
- **הזנה חזרה:** תוצאות העבר מוזנות לפרומפט של החיזוי הבא כ־"Historical Context", כך שהמודל מתאים את הביטחון וההנמקות בהתאם לביצועים האמיתיים.

---

## 4. טייפים (TypeScript)

- **`RiskLevel`** — `'High' | 'Medium' | 'Low'` ב־`lib/schemas.ts`.
- **`TechnicalIndicatorsInput`** — `rsi_14`, `volatility_pct`, `macd_signal?` ב־`lib/analysis-core.ts`.
- **`HistoricalPredictionOutcome`** — מבנה יחיד של תוצאת תחזית מהעבר לשימוש ב־prompt.
- סכמות Zod: `aiPredictionSchema` ו־`aiPredictionPartialSchema` כוללות `risk_level` אופציונלי ותואמות את פלט ה־Gemini.

---

## 5. קבצים שעודכנו

| קובץ | שינוי עיקרי |
|------|-------------|
| `lib/analysis-core.ts` | Persona Quant, payload מועשר (technical_indicators, historical_prediction_outcomes, volume_delta), system prompt חדש, סכמת תשובה עם risk_level, מיפוי risk_level לעברית. |
| `lib/schemas.ts` | הוספת `riskLevelSchema`, `risk_level` אופציונלי ב־aiPredictionSchema ו־aiPredictionPartialSchema. |
| `lib/db/historical-predictions.ts` | בשימוש: `getHistoricalBySymbol()` נקרא מ־analysis-core להזנת הקשר היסטורי (ללא שינוי סכמה). |
| `app/actions.ts` | ללא שינוי לוגיקת ההערכה; המשך שמירה ל־historical_predictions ו־error_report כדי שהמשוב ימשיך להזין את החיזויים הבאים. |

---

## 6. הרחבות עתידיות מומלצות

- **אינדיקטורים:** חישוב או שליפה של MACD/אינדיקטורים נוספים והזרקתם ל־`technical_indicators.macd_signal` (או שדות חדשים באותו מבנה).
- **Order Book:** שליפת עומק (bid/ask) מ־Binance או ספק אחר והזנה כ־`order_book_imbalance` או שדה דומה ב־prompt.
- **מטריקות למידה:** ניצול `getAccuracyByConfidenceBucket()` ו־`listHistoricalPredictions()` לדשבורד דיוק ולבונוס/penalty דינמיים על ביטחון לפי ביצועי עבר.
