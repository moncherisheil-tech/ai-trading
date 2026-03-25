# סימולציה חיה ומוכנות לשיתוף — Mon Chéri Financial Terminal

## 1. סימולציית BTC (Live Simulation)

### איך להריץ את הסימולציה

**אפשרות א': דרך ה-UI (מומלץ)**  
1. הפעל את האפליקציה: `npm run dev` מתוך תיקיית הפרויקט.  
2. גלוש ל־`http://localhost:3000`.  
3. בשדה הסמל הזן `BTC` או `BTCUSDT`.  
4. לחץ על **Run Analysis**.  
5. התחזית תישמר ב-DB ותופיע בעמוד הראשי, כולל **Sentiment Score**, **Market Narrative** ו-**Risk Status** (בדגל אם יש סנטימנט קיצוני).

**אפשרות ב': דרך API (לסימולציה אוטומטית)**  
נוסף endpoint לסימולציה ללא Captcha ו-delay:

- **POST** `/api/ops/simulate`
- **Body (JSON):** `{ "symbol": "BTC" }` — ברירת מחדל: BTC.
- **אבטחה:** כמו Worker: אם מוגדר `WORKER_CRON_SECRET` ב-.env, שלח כותרת:  
  `Authorization: Bearer <WORKER_CRON_SECRET>`.  
  אם מוגדר `ALLOWED_IPS`, רק כתובות ברשימה יורשו (או `*` לכולם).

דוגמה (PowerShell):

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/ops/simulate" -Method POST -ContentType "application/json" -Body '{"symbol":"BTC"}'
```

דוגמה (אם יש סוד):

```powershell
$headers = @{ Authorization = "Bearer YOUR_WORKER_CRON_SECRET" }
Invoke-RestMethod -Uri "http://localhost:3000/api/ops/simulate" -Method POST -ContentType "application/json" -Body '{"symbol":"BTC"}' -Headers $headers
```

### תוצאת הסימולציה (מבנה)

התשובה מ-`/api/ops/simulate` (או התחזית האחרונה ב-UI) תיראה כך:

- **success:** `true` / `false`
- **data** (כש-success):
  - **symbol:** `BTCUSDT`
  - **predicted_direction:** `Bullish` | `Bearish` | `Neutral`
  - **probability:** 0–100
  - **target_percentage:** אחוז התנועה הצפוי
  - **entry_price:** מחיר כניסה
  - **sentiment_score:** -1 עד 1 (מהחדשות)
  - **market_narrative:** סיכום נרטיב השוק
  - **risk_status:** `normal` | `extreme_fear` | `extreme_greed`
  - **logic, strategic_advice, learning_context, sources**
- **chartData:** נתוני OHLCV ל-30 יום (לשימוש ב-UI)

ב-UI יופיעו:

- **Sentiment Score** ליד התחזית (כולל Narrative).
- **Risk Status:** אם `extreme_fear` או `extreme_greed` — אייקון אזהרה מהבהב ותג "Extreme Sentiment" (כולל עונש 50% להסתברות).

אחרי הסימולציה, הרצת **Evaluate Pending Predictions** תעדכן את ה-backtest ואת קובץ ה-backtests; דף ה-P&L ישקף את הרישום החדש.

---

## 2. מוכנות לשיתוף: Tunnel עם ngrok

### בדיקת תצורה (next.config ו-middleware)

- **next.config.ts:**  
  - `output: 'standalone'` — מתאים לפריסה ו-tunnel.  
  - כותרות אבטחה (CSP, X-Frame-Options וכו') מוגדרות.  
  - כשנכנסים דרך כתובת ngrok (למשל `https://xxx.ngrok-free.app`), ה-origin הוא אותו דומיין ולכן `connect-src 'self'` מכסה את הבקשות לאותו שרת.
- **middleware.ts:**  
  - מגן רק על `/api/workers/*` (בדיקת IP).  
  - `/api/ops/simulate` ויתר דפי ה-ops מטפלים באבטחה בעצמם (סוד, session וכו').

אין צורך בשינוי ב-next.config או ב-middleware רק כדי להפעיל ngrok.

---

### מדריך הפעלת קישור זמני עם ngrok (עברית)

#### שלב 1: התקנת ngrok

1. היכנס לאתר: [https://ngrok.com](https://ngrok.com) והירשם (חינם).  
2. הורד את ngrok למערכת ההפעלה שלך:  
   [https://ngrok.com/download](https://ngrok.com/download)  
3. לחלופין (אם מותקן Chocolatey):  
   `choco install ngrok`  
4. אחרי ההורדה, פרק את הקובץ (אם צריך) והפעל מהטרמינל פעם אחת (לאחר ההתקנה):  
   `ngrok config add-authtoken <הטוקן שלך מהדשבורד>`  
   הטוקן נמצא ב: Dashboard → Your Authtoken.

#### שלב 2: הפעלת האפליקציה

1. בטרמינל אחד, בתיקיית הפרויקט:  
   `npm run dev`  
2. וודא שהאפליקציה רצה על פורט 3000:  
   `http://localhost:3000`

#### שלב 3: הפעלת ngrok

1. בטרמינל **נפרד** הרץ:  
   `ngrok http 3000`  
2. במסך יופיעו שורות כמו:

   ```text
   Forwarding   https://xxxx-xx-xx-xx-xx.ngrok-free.app -> http://localhost:3000
   ```

3. הכתובת `https://....ngrok-free.app` היא הקישור הזמני לשיתוף.  
   כל מי שנכנס אליה יגיע לאפליקציה שרצה אצלך על פורט 3000.

#### שלב 4: שיתוף עם חברים

1. העתק את ה-URL מה-Forwarding (ה-https).  
2. שלח את הקישור לחברים.  
3. כל עוד הטרמינל עם `ngrok http 3000` פתוח והאפליקציה רצה — הקישור פעיל.  
4. בפעם הבאה שתפעיל ngrok (בלי מנוי קבוע) תקבל כתובת חדשה.

#### שלב 5: עצירה

- לעצירת ngrok: `Ctrl+C` בטרמינל של ngrok.  
- לעצירת האפליקציה: `Ctrl+C` בטרמינל של `npm run dev`.

#### טיפים

- **Session / Auth:** אם יש התחברות (session), המשתמשים יגיעו לדף כניסה או לדשבורד בהתאם להגדרות.  
- **Workers:** קריאות ל-`/api/workers/*` (למשל evaluate, learn) כפופות ל-IP או ל-Bearer token; דרך ngrok ה-IP יהיה של שרתי ngrok — אם צריך לאפשר, הוסף ב-.env את ה-IP או השתמש ב-`WORKER_CRON_SECRET`.  
- **HTTPS:** ngrok נותן HTTPS אוטומטית; אין צורך בהגדרת SSL מקומית.

---

## 3. דוח P&L (Executive PDF)

### איך לייצר את דוח ה-P&L הראשון (כולל סימולציית BTC)

1. **הרץ סימולציית BTC** (דרך UI או דרך `POST /api/ops/simulate` עם `{"symbol":"BTC"}`).  
2. **אופציונלי:** הרץ **Evaluate Pending Predictions** כדי לסגור את התחזית ב-backtest (ואז היא תיכנס ל-backtests.jsonl ולחישובי P&L).  
3. גלוש ל־**Finance & P&L** (או `http://localhost:3000/ops/pnl`).  
4. בדף ה-P&L תראה את עקומת ההון, מטריקות ורשימת עסקאות (כולל נתוני backtest + התחזית החדשה אחרי Evaluation).  
5. לחץ על **Export Executive Report (PDF)**.  
6. הקובץ יורד עם שם כמו:  
   `mon-cheri-pnl-report-YYYY-MM-DD.pdf`  
   וכולל את מותג Mon Chéri, תאריך, סיכום ביצועים והאסטרטגיות המובילות.

אם אין עדיין backtests, הדוח יציג את המבנה עם ערכים אפס/ריק עד שיהיו נתונים. סימולציית BTC + Evaluate יוסיפו רשומה ראשונה ל-backtest ולדוח.

---

## סיכום

| משימה | סטטוס |
|--------|--------|
| טריגר `analyzeCrypto("BTC")` דרך UI או `/api/ops/simulate` | מוכן |
| הצגת Sentiment Badge ו-Risk Status ב-UI | מוכן (CryptoAnalyzer) |
| next.config ו-middleware לפריסה/tunnel | מתאימים; ngrok עובד עם התצורה הנוכחית |
| קישור זמני לשיתוף (ngrok) | מדריך מלא למעלה |
| דוח P&L (PDF) כולל סימולציית BTC | מוכן: הרץ סימולציה → Evaluate → דף P&L → Export PDF |
