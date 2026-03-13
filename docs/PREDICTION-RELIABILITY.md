# אמינות חיזוי — כלל המטבעות (BTC, ETH, SOL)

## אימות זמינות מטבעות

- **API אימות:** `GET /api/ops/verify-symbols`  
  מחזיר לכל אחד מ-BTCUSDT, ETHUSDT, SOLUSDT האם Binance מחזיר נתוני קליין (זמין לחיזוי).  
  דורש סשן מאומת (או IP מורשה).

- **בדיקה ידנית:**  
  Binance מחזיר `200` ו־klines תקינים עבור:
  - `BTCUSDT`
  - `ETHUSDT`
  - `SOLUSDT`

## עקביות סימבול (דיוק מרבי)

1. **בקשה → רשומה:** תמיד נשמר ב-DB ה־`symbol` שהתבקש (לאחר נרמול), לא הערך שהמודל החזיר.
2. **תיקון אוטומטי:** אחרי פענוח תשובת ה-AI ואחרי תיקון consistency מופעל `result.symbol = cleanSymbol`.
3. **פרומפט:** המודל מתבקש להחזיר את השדה `symbol` זהה ל־`asset` שנשלח בבקשה.

## זרימת חיזוי לכל מטבע

| שלב | BTC | ETH | SOL |
|-----|-----|-----|-----|
| בחירה ב-UI | `selectedSymbol` → BTCUSDT | ETHUSDT | SOLUSDT |
| ניתוח (פעולה) | `analyzeCrypto({ symbol })` | אותו מנגנון | אותו מנגנון |
| Binance klines | ✅ | ✅ | ✅ |
| Fear & Greed | משותף | משותף | משותף |
| Sentiment (News) | symbolToSearchTerms(BTC) | Ethereum | Solana |
| Gemini | prompt עם asset = symbol | אותו מנגנון | אותו מנגנון |
| שמירה | `newRecord.symbol = cleanSymbol` | אותו מנגנון | אותו מנגנון |

## סימולציה (POST /api/ops/simulate)

- גוף הבקשה: `{ "symbol": "ETH" }` או `{ "symbol": "ETHUSDT" }`.
- הסימבול מנורמל ל־USDT לפני קריאה ל־`runCryptoAnalysisCore`.
- החיזוי מתבצע עבור המטבע המבוקש בלבד.

## המלצות לדיוק מרבי

1. להריץ מעת לעת `GET /api/ops/verify-symbols` ולוודא `allSymbolsReady: true`.
2. לאחר הערכות (Evaluate) — לבדוק בדף אסטרטגיות שהדיוק והמגמות משתפרים.
3. לשמור על מפתחות: `GEMINI_API_KEY`, `NEWS_API_KEY` (או `CRYPTOCOMPARE_API_KEY`) להזנת סנטימנט וחדשות.
