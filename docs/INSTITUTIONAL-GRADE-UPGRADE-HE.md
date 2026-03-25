# שדרוג דיוק מוסדי ומחיר חי — Mon Chéri Quant AI

**תאריך:** 14 במרץ 2025  
**מטרה:** מעבר לדיוק מתמטי מוסדי (Decimal) ומחיר שוק חי בזמן אמת (WebSocket Binance).

---

## 1. דיוק מתמטי — ספריית Decimal

### 1.1 התקנה

- הותקנה הספרייה **decimal.js** (`npm install decimal.js`) — ספריית JavaScript לחשבון עשרוני מדויק, ללא שגיאות floating-point של `number`.

### 1.2 מודול עזר מרכזי — `lib/decimal.ts`

נוצר מודול אחיד לכל החישובים הכספיים:

- **`round2(value)`** — עיגול ל־2 ספרות אחרי הנקודה (מטבע, אחוזים).
- **`round4(value)`** — עיגול ל־4 ספרות (מחירים, שברים קטנים).
- **`toDecimal(value)`** — המרה ל־`Decimal` מ־number, string או אובייקט Decimal קיים.
- **`D`** — קבועים כ־Decimal: `zero`, `hundred`, `thousand`, `half`, `feePct` (0.1%), `startingBalance` (10,000), `basePositionUsd` (1,000).

כל חישוב רווח/הפסד, יתרה, עמלה ואחוזים מתבצע באמצעות `Decimal` ומעוגל ל־2 או 4 עשרוניים רק בשלב התצוגה/פלט.

### 1.3 שינויים לפי קובץ

| קובץ | שינוי |
|------|--------|
| **`app/api/ops/metrics/pnl/route.ts`** | `positionUsd`, `tradePnL` מחזירים `Decimal`; צבירה יומית/חודשית ב־`Map<string, Decimal>`; `equityCurve`, `totalPnl`, `maxDrawdown`, `profitFactor`, `grossProfit`/`grossLoss` — כולם ב־Decimal; פלט JSON מעוגל ב־`round2()`. |
| **`components/PnlTerminal.tsx`** | חישובי מינוף (L): `totalPnl`, `totalPnlPct`, `balance`, `maxDrawdown`, `equityCurveScaled`, `dailyPnlScaled`, `monthlyPnlScaled`, `tradesScaled` — כולם דרך `toDecimal(...).times(L)` או `D.startingBalance.plus(...)` עם `round2()` לתצוגה. |
| **`context/SimulationContext.tsx`** | עמלה: `feeUsd = round4(amt.times(SIMULATION_FEE_PCT).div(100))`; `totalCost` ו־`amountAsset` ב־Decimal ומעוגלים; השוואת יתרה ו־נכס זמין ב־`toDecimal(...).lessThan(...)` / `.greaterThan(...)`; `newWallet` מחושב ב־Decimal ונשמר כ־`round2(newWallet)`. |

### 1.4 תוצאה

- אין שימוש ב־`number` לחישובי כסף/אחוזים — רק `Decimal` ועיגול סופי.
- תאימות לאחור: ה־API ממשיך להחזיר מספרים ב־JSON; הקומפוננטות מקבלות מספרים ומחשבות מינוף/תצוגה ב־Decimal.

---

## 2. מחיר חי — WebSocket Binance

### 2.1 זרימה

- ב־**`components/CryptoAnalyzer.tsx`** נוסף חיבור ל־**Binance WebSocket** למחיר ticker בזמן אמת.
- כתובת:  
  `wss://stream.binance.com:9443/ws/<symbol>@ticker`  
  כאשר `<symbol>` הוא הסימבול באותיות קטנות (למשל `btcusdt` עבור BTCUSDT).
- שדה המחיר: ב־payload של Binance ticker — **`c`** (Last price, string).

### 2.2 לוגיקה בקומפוננטה

- **State:**  
  - `livePrice: number | null` — מחיר אחרון שהתקבל מה־WebSocket.  
  - `livePriceConnected: boolean` — האם החיבור פעיל.

- **`useEffect` תלוי ב־`symbol`:**  
  - בונה URL: `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@ticker`.  
  - יוצר `WebSocket`, מאזין ל־`onmessage`, מפרסר JSON ומעדכן `livePrice` מ־`data.c`.  
  - ב־`onopen` מעדכן `livePriceConnected = true`.  
  - ב־**cleanup** (unmount או שינוי `symbol`): סוגר את ה־WebSocket, מאפס `livePrice` ו־`livePriceConnected`.

- **מחיר לתצוגה ולסימולציה:**  
  - `displayPrice = livePrice ?? entryPrice`  
  - `entryPrice` = מחיר הכניסה של התחזית האחרונה (`latestPrediction?.entry_price ?? 0`).  
  - כאשר יש חיבור חי — התצוגה ופעולות קנה/מכור בסימולציה משתמשים ב־`displayPrice` (כלומר במחיר החי).

### 2.3 אינדיקציה ויזואלית — "חי"

- ליד הטקסט "מחיר נוכחי" מוצג:  
  - **נקודה ירוקה מהבהבת** (אנימציית `animate-ping`) + התווית **"חי"** כאשר `livePriceConnected === true`.  
  - Tooltip: "מחיר חי — Binance".

### 2.4 ניתוק וחיבור מחדש

- עם שינוי נכס (`symbol`) — ה־effect מסתיים, ה־WebSocket נסגר, והחיבור מחדש מתבצע אוטומטית עם ה־symbol החדש.  
- אין צורך באימות או cookie — זרם Binance ציבורי בלבד.

---

## 3. סיכום טכני

| נושא | יישום |
|------|--------|
| **ספרייה** | decimal.js; עטיפה ב־`lib/decimal.ts` (round2, round4, toDecimal, D). |
| **API PnL** | חישוב מלא ב־Decimal; פלט מעוגל ל־2 עשרוניים. |
| **PnlTerminal** | מינוף ותצוגה ב־Decimal + round2. |
| **SimulationContext** | עמלה, יתרה, השוואות ונכס זמין — כולם ב־Decimal. |
| **מחיר חי** | WebSocket ל־Binance `<symbol>@ticker`, שדה `c`; `displayPrice = livePrice ?? entryPrice`. |
| **אינדיקציה** | נקודה ירוקה מהבהבת + "חי" כש־WebSocket מחובר. |

המערכת כעת עומדת בדרישות דיוק מוסדי בחישובים ומציגה מחיר שוק חי בזמן אמת כשהנכס נבחר.
