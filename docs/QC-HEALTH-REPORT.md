# דוח בריאות מערכת — ביקורת QC מלאה

**תאריך:** מרץ 2025  
**סטטוס:** בוצעה ביקורת לוגיקה, ביצועים, וממשק; הוחלו תיקונים במהלך הסשן.

---

## 1. מה עובד כהלכה

### לוגיקה וחישובים
- **נוסחת P_success** (`lib/prediction-formula.ts`): חישוב עם משקלים דינמיים מ-DB, גיבוב ערכים ל-0–100, וחלוקה ב-riskFactor עם הגנה מפני ערכים לא תקינים (כולל אחרי התיקונים).
- **RSI(14)**: חישוב סטנדרטי; טיפול במקרה של אי-שינוי במחיר (avgGain=0 ו-avgLoss=0) מחזיר 50.
- **סימולציה וירטואלית** (`lib/simulation-service.ts`): פתיחה/סגירה רק ב-DB, ללא קריאות חיצוניות; ולידציה ל-symbol, entry_price, amount_usd.
- **אוטו-סגירה (TP/SL)**: לולאה על רשימת פוזיציות פתוחות קבועה; סגירה לפי מחיר שמועבר (אין polling מתוך המודול). הגנה מפני entry_price<=0 ו-pct לא סופי.

### מנוע רטרוספקטיבה
- **משקלים**: סכום תמיד 1 (עיגול sentiment כ-1-vol-rsi); setWeights דוחה אם |sum-1|>0.01.
- **שמירה ל-DB**: prediction_weights, accuracy_snapshots, learning_reports נשמרים כראוי; appendAccuracySnapshot ו-insertLearningReport רצים רק כש-DB_DRIVER=sqlite.
- **Learning Progress בדשבורד בקטסט**: נתונים מ-`/api/retrospective/insights` (snapshots + latestReport); משקף נתונים אמיתיים מה-DB.

### UI ו-RTL
- **דפים**: `/`, `/portfolio`, `/backtest`, `/insights` עם `dir="rtl"` ו-padding תחתון למובייל (`pb-24` או `pb-20`; אוחד ל-pb-24 בעמוד התובנות).
- **BottomNav**: מוצג רק ב-viewport מובייל (useIsMobile), עם קישורים לכל העמודים וסימון עמוד פעיל.
- **טקסטים בעברית**: דוחות ולקחים משתמשים במונחים כלליים (האלגוריתם, המערכת, הנהלה) — לא מופיעים שמות פרטיים.

### מסד נתונים
- **SQLite**: טבלאות עם CHECK ו-INDEX רק היכן שצריך (status, entry_date, evaluated_at, symbol, snapshot_date וכו'). אין אינדקסים מיותרים על טבלאות קטנות.
- **נפרדות**: virtual_portfolio, historical_predictions, prediction_weights, accuracy_snapshots, learning_reports — כל אחת עם תפקיד ברור.

### אינטגרציית טלגרם
- **שליחת התראות ג'ם**: כפתורים עם callback_data; פורמט sim_confirm:SYMBOL:PRICE:AMOUNT מפורש ב-webhook.
- **רישום סימולציה**: קריאה ל-openVirtualTrade עם ולידציה; תשובה למשתמש דרך answerCallbackQuery.

---

## 2. צווארי בקבוק ובעיות שזוהו

### לוגיקה וחישובים (טופלו)
- **RSI כשכל המחירים שווים**: במקור הוחזר 100; תוקן להחזיר 50 (נייטרלי).
- **riskFactor לא סופי או אפס**: נוספה הגנה — שימוש ב-Math.max(0.1, riskFactor) וולידציה ל-Number.isFinite.
- **אוטו-סגירה**: הוספת בדיקה ל-entry_price<=0 ו-Number.isFinite(pct) כדי למנוע NaN/Infinity.

### Webhook טלגרם (טופל)
- **callback_query ללא מענה**: אם ה-callback_data לא התאים לאף פעולה, Telegram היה נשאר במצב טעינה. נוספו: מענה ברירת מחדל ("בוצע.") ו-try/catch עם מענה "שגיאה בשרת. נסה שוב." כדי לסגור את הלולאה גם בשגיאות.

### UI (טופל)
- **עקביות padding מובייל**: בעמוד התובנות היה pb-20 בעוד בשאר pb-24; אוחד ל-pb-24 sm:pb-8 כמו בשאר הדפים.

### ביצועים (לשיקול עתידי)
- **Gem Finder** (`/api/crypto/gems`): שליפה אחת ל-Binance 24h ticker; ללא cache — כל קריאה יוצרת fetch. ניתן להוסיף revalidate קצר (למשל 60 שניות) אם יידרש.
- **פורטופוליו וירטואלי**: GET `/api/portfolio/virtual` מפעיל fetch מחירים ו-checkAndCloseTrades בכל קריאה. אם יש הרבה משתמשים סימולטניים, אפשר להוסיף throttle או cache למחירים.
- **Polling מחירים**: המודול simulation-service לא עושה polling; המחירים מוזנים מקריאת API חיצונית. אין חשש ל-rate limit מתוך המודול עצמו.

---

## 3. תיקונים שבוצעו בסשן זה

| קובץ | תיקון |
|------|--------|
| `lib/prediction-formula.ts` | RSI: החזרת 50 כאשר avgGain=0 ו-avgLoss=0. הגנה על riskFactor (סופי, מינימום 0.1) לפני חלוקה. |
| `lib/simulation-service.ts` | ב-checkAndCloseTrades: דילוג כאשר entry_price<=0; דילוג כאשר !Number.isFinite(pct). |
| `app/api/telegram/webhook/route.ts` | עטיפה ב-try/catch; מענה answerCallback בכל מסלול (כולל ברירת מחדל ובעת שגיאה). |
| `app/insights/page.tsx` | אחידות padding: pb-20 → pb-24 sm:pb-8. |

---

## 4. סיכום

- **לוגיקה וחישובים**: נוסחת P_success ו-RSI מטפלות במקרי קצה; אוטו-סגירה מוגנת מפני ערכים לא תקינים.
- **מנוע הלמידה**: משקלים נשמרים ונקראים נכון; דשבורד Learning Progress משקף נתונים אמיתיים.
- **UI ו-RTL**: דפים עם RTL ו-padding אחיד למובייל; BottomNav פועל; טקסטים בעברית ללא שמות פרטיים.
- **מסד נתונים**: סכמות SQLite עקביות, עם אינדקסים רלוונטיים וללא רדונדנטיות מיותרת.
- **טלגרם**: Webhook סוגר את הלולאה — כל לחיצה מקבלת מענה; שגיאות נתפסות ומקבלות הודעת משוב למשתמש.

המערכת כשירה ל-production בהתאם להנחיות; שיפורי ביצועים (cache/throttle) אופציונליים לפי עומס צפוי.
