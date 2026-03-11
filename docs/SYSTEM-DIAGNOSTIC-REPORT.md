# דוח אבחון מערכת — Mon Chéri Financial Terminal

**תאריך:** מרץ 2025  
**סטטוס:** אימות אינטגרציות (Sentiment, Guardrails, Telegram, P&L, Accuracy Metrics)

---

## 1. Data Integrity — קריאת backtests.jsonl

### ממצאים

- **מקור משותף:** גם **Accuracy API** (`/api/ops/metrics/accuracy`) וגם **P&L API** (`/api/ops/metrics/pnl`) קוראים את אותו קובץ דרך `listBacktests()` מ־`lib/db/backtest-repository.ts`.
- **נתיב:** `BACKTEST_LOG_PATH = path.join(process.cwd(), 'backtests.jsonl')` — עקבי.
- **פרסור:** כל שורה מפוענחת ב־`JSON.parse(line)` בתוך `try/catch`; שורה לא תקינה **מדולגת בשקט** (ללא throw). הרשומה נדחית רק אם חסרים `evaluated_at` (string) או `absolute_error_pct` (number).

### Weak Links (נקודות חולשה)

1. **ללא לוג על שורות פגומות:** שורה לא־תקינה ב־JSON לא נרשמת ללוג, כך שקשה לאבחן נתונים חסרים. **המלצה:** לוג ברמת debug (למשל `console.warn`) עבור שורות שנכשלות ב־parse או ב־validation.
2. **רשומות ללא `price_diff_pct`:** ה־validation ב־`listBacktests` לא בודק `price_diff_pct`. אם יופיעו רשומות ישנות בלי השדה, ב־PnL ייחשב `profitPct = 0` (כיוון ש־direction לא Bullish/Bearish או חסר), והמסחר יוצג כ־רווח מינוס עמלה בלבד. **סטטוס:** התנהגות סבירה; אין קריסה.

### סיכום

- **סטטוס:** **תקין.** שני ה־APIs משתמשים באותו מנגנון קריאה; אין כפילות לוגיקה ואין throw על קובץ חסר או שורה פגומה (מחזירים מערך ריק או חלקי).

---

## 2. Sentiment & News Logic

### מפתח API

- **מיקום:** `lib/agents/news-agent.ts` — פונקציה `getNewsApiKey()`.
- **לוגיקה:** `return process.env.NEWS_API_KEY ?? process.env.CRYPTOCOMPARE_API_KEY;`
- **שימוש:** ב־`fetchLatestCryptoNews()` — המפתח מוסף ל־URL כ־`api_key` רק אם קיים (`apiKey ? \`&api_key=${apiKey}\` : ''`).

**סטטוס:** **תקין.** המפתח נמשך נכון מ־`process.env`; בהיעדר מפתח הקריאה ל־CryptoCompare עדיין מתבצעת (ללא rate limit מוגבר).

### סימולציה: סנטימנט -0.9 ו־50% confidence penalty

- **Guardrail:** `checkSentimentGuardrail(-0.9)` → `-0.9 <= -0.8` → מחזיר `'EXTREME_FEAR'`.
- **ב־analyzeCrypto:**
  1. אחרי `getMarketSentiment()`: `sentiment_score = -0.9`, `market_narrative` מתעדכן.
  2. `guardrailStatus = checkSentimentGuardrail(sentiment_score)` → `'EXTREME_FEAR'`.
  3. `guardrailStatus !== 'NORMAL'` → נשלחת הודעת Telegram (אם מוגדר token).
  4. אחרי קבלת תשובת Gemini:  
     `if (guardrailStatus !== 'NORMAL') { finalProbability = Math.round(result.probability * 0.5); result = { ...result, probability: finalProbability }; }`
  5. ב־`newRecord`: נשמרים `probability` (המכווץ), `risk_status: 'extreme_fear'`.

**סטטוס:** **תקין.** סנטימנט -0.9 אכן מפעיל קנס 50% על ה־probability ונשמר כ־risk_status.

---

## 3. P&L & Leverage Math

### עמלה (Fee)

- **קבוע:** `FEE_PCT = 0.1` (0.1% למסחר round-trip).
- **חישוב:** `feeUsd = (pos * FEE_PCT) / 100` — כלומר 0.1% מגודל הפוזיציה.
- **פוזיציה:** `positionUsd(entry)` — רגיל $1,000; באירוע סנטימנט קיצוני (score ≤ -0.8 או ≥ 0.8) פוזיציה $500.

**סטטוס:** **תקין.** העמלה מיושמת פעם אחת למסחר (0.1%).

### מינוף (Leverage)

- **ב־API:** החישוב הוא תמיד ב־1x (פוזיציה בסיס + עמלה). ה־API מחזיר `totalPnl`, `equityCurve` (עם `balance` ו־`cumulative_pnl`), `dailyPnl`, `trades` — כולם ב־1x.
- **ב־UI:** `L = leverage` (1–10); כל הסכומים מוכפלים:  
  `totalPnl * L`, `balance = STARTING_BALANCE + totalPnl * L`,  
  `equityCurveScaled[].balance = STARTING_BALANCE + cumulative_pnl * L`,  
  `dailyPnlScaled[].pnl = pnl * L`, `tradesScaled[].pnl_usd = pnl_usd * L`.

**סטטוס:** **תקין.** המינוף מיושם רק בצד הלקוח; המתמטיקה עקבית (רווח/הפסד ועמלה כבר כלולים ב־1x, והמינוף מכפיל את התוצאה).

### Equity Curve — מצטבר (Cumulative)

- **ב־PnL API:**  
  `dailyPnl` = סכום P&L לפי תאריך (לא מצטבר).  
  אחר כך: `running = startingBalance`; על כל יום `running += d.pnl`; כל נקודה ב־`equityCurve` היא `{ date, balance: running, cumulative_pnl: running - startingBalance }`.
- **סטטוס:** **תקין.** ה־balance הוא מצטבר (running sum), לא snapshot יומי בודד.

---

## 4. Integration & UI

### Telegram — טיפול בשגיאות

- **קוד:** `lib/telegram.ts` — `sendTelegramMessage(text)`.
  - אם חסר `TELEGRAM_BOT_TOKEN` או `TELEGRAM_CHAT_ID`: `if (!token || !chatId) return;` — **no-op, ללא throw.**
  - בתוך `try/catch`: אם `fetch` נכשל או מחזיר !ok — `console.warn` בלבד, ללא throw.

**סטטוס:** **תקין.** האפליקציה לא קורסת בהיעדר token או בשגיאת Telegram.

### Loading ו־Empty ב־UI

| רכיב | Loading | Empty |
|------|---------|--------|
| **דף P&L** | טעינה דרך SSR — אין מצב "Loading" מפורש; הדף מוצג אחרי fetch. | `data` null → הודעת "Failed to load P&L data". |
| **גרף Equity Curve** | אין (הנתונים כבר בדף). | "No equity data yet." כאשר `equityCurveScaled.length === 0`. |
| **גרף Daily/Monthly P&L** | אין. | "No P&L data yet." כאשר אין יומי/חודשי. |
| **טבלת Trade Log** | אין. | "No trades yet." כאשר `tradesScaled.length === 0`. |
| **כפתור Export PDF** | **תוקן:** מצב `pdfExporting` — הכפתור מוצג "Exporting…" ומושבת בזמן ייצוא. | לא רלוונטי. |

**סטטוס:** **תקין.** כל הגרפים והטבלה כוללים מצב Empty; לכפתור ה־PDF נוסף Loading.

---

## 5. Critical Path — תחזית מקצה לקצה

השרשרת הנבדקת:

1. **Fetch News**  
   `getMarketSentiment(cleanSymbol)` → `fetchLatestCryptoNews(symbol)` (משתמש ב־NEWS_API_KEY אם קיים) → Claude מחזיר `score` ו־`narrative`.  
   **כשל:** ב־try/catch ב־analyzeCrypto; בכשל: `sentiment_score = 0`, `market_narrative = 'No news-based sentiment...'`.

2. **Analyze Sentiment**  
   `sentiment_score` ו־`market_narrative` מוזנים ל־`promptData` ונשמרים ב־`newRecord`.

3. **Apply Guardrail**  
   `checkSentimentGuardrail(sentiment_score)` → אם לא NORMAL: שליחת Telegram (no-op אם אין token), ואחרי Gemini: `probability = Math.round(probability * 0.5)`, `risk_status = 'extreme_fear' | 'extreme_greed'`.

4. **Generate Prediction**  
   Gemini נקרא עם `promptData` (כולל sentiment); התוצאה מעודכנת עם probability מכווץ ו־risk_status ונשמרת ב־DB כ־PredictionRecord.

5. **Log Backtest**  
   ב־`evaluatePendingPredictions`: בעת `backtestRepo.append()` נשלחים מהרשומה `sentiment_score` ו־`market_narrative`.  
   → כל רשומה ב־backtests.jsonl יכולה לכלול sentiment בזמן התחזית.

6. **Update P&L**  
   P&L API קורא `listBacktests()`; לכל entry מחושב `positionUsd(entry)` לפי `entry.sentiment_score` (50% באירוע קיצון); `tradePnL(entry)` משתמש בפוזיציה זו ובעמלה 0.1%.  
   → ה־P&L משקף את קנס הביטחון (פוזיציה מופחתת) באירועי סנטימנט קיצוני.

**סטטוס:** **השרשרת שלמה.** מתחזית → סנטימנט → guardrail → שמירה → הערכה → backtest (עם sentiment) → P&L (כולל position מופחת) — אין חוליה חסרה.

---

## 6. סיכום מנהלים

| אזור | סטטוס | הערות |
|------|--------|--------|
| Data Integrity (backtests.jsonl) | ✅ תקין | מקור משותף, פרסור עם skip לשורות פגומות. מומלץ לוג ל־debug על שורות שנדחות. |
| NEWS_API_KEY | ✅ תקין | נמשך מ־process.env ומשולב ב־CryptoCompare. |
| קנס 50% בסנטימנט קיצוני | ✅ תקין | נבדק: -0.9 → EXTREME_FEAR → probability מוכפל ב־0.5 ונשמר. |
| עמלה 0.1% ומינוף ב־P&L | ✅ תקין | עמלה ב־API; מינוף רק ב־UI; מתמטיקה עקבית. |
| Equity Curve מצטבר | ✅ תקין | balance = running sum יומי. |
| Telegram ללא token | ✅ תקין | no-op; לא זורק שגיאה. |
| Loading/Empty ב־UI | ✅ תקין | Empty בכל הגרפים והטבלה; Loading על כפתור PDF. |
| Critical Path | ✅ תקין | News → Sentiment → Guardrail → Prediction → Backtest → P&L — רצף מלא. |

**מסקנה:** המערכת **פעילה ועקבית** לכל האינטגרציות שנבדקו. אין "weak links" קריטיים; ההמלצה היחידה היא הוספת לוג (debug) לדחיית שורות ב־`listBacktests` לצורך אבחון עתידי.
