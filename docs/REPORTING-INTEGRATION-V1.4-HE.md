# דוח אינטגרציה — Adaptive Reporting & Learning Monitor (v1.4)

**תאריך:** מרץ 2025  
**גרסה:** 1.4  
**סטטוס:** הושלם

---

## סיכום מנהלים

המערכת עוקבת כעת **יומית** אחר צמיחת האינטליגנציה שלה: דיוק התחזיות מול תוצאות PnL בפועל מתועד בטבלת `daily_accuracy_stats`, סיכום יומי נשלח לטלגרם ב־23:59, ודוח CEO שבועי מפורט בימי שבת ב־21:00. בדף הביצועים נוסף גרף **התקדמות למידה** המציג את מגמת הדיוק לאורך זמן.

---

## 1. לוגיקת מעקב דיוק (Accuracy Tracking)

### טבלה: `daily_accuracy_stats`
- **קובץ:** `lib/db/learning-metrics.ts`
- **עמודות:** `stat_date` (DATE), `win_rate` (NUMERIC), `prediction_accuracy_score` (NUMERIC), `learning_delta` (NUMERIC), `false_positives_avoided` (INTEGER).
- **משמעות:** לכל יום נשמרים אחוז ההצלחה (win_rate), ציון דיוק התחזית (התאמה בין תובנות הסוכן ב־`agent_insights` לתוצאות ב־`virtual_portfolio`), והדלתא לעומת אתמול (`learning_delta`).

### פונקציה: `calculateDailyAccuracyDelta(forDate?)`
- **השוואה:** מזווג רשומות מ־`agent_insights` (לפי `trade_id`) ל־`virtual_portfolio` (סגורות באותו יום).
- **חישוב דיוק:** תובנה נחשבת "הצלחה" או "כישלון" לפי טקסט ה־insight/outcome; תוצאה בפועל לפי `pnl_pct`. ציון הדיוק = אחוז ההתאמות (נכון חיובי + נכון שלילי).
- **learning_delta:** ציון הדיוק של היום פחות ציון הדיוק של אתמול (חישוב ב־Decimal.js).
- **False Positives Avoided:** שדה מוכן להרחבה — כאשר הסורק/Neural Fortress יתעדו סינון אותות (למשל הורדת ביטחון), ניתן לעדכן כאן.

---

## 2. הדופק היומי (Daily Pulse) — קרון 23:59

- **קובץ:** `lib/workers/daily-report-task.ts`
- **Cron:** `GET /api/cron/daily-report` — ב־`vercel.json`: `"59 23 * * *"`.
- **תוכן ההודעה (טלגרם, RTL):**
  - 📅 **סיכום יומי — Smart Money v1.4**
  - 📈 PnL יומי: {pnl}%
  - 🧠 שיפור בדיוק למידה: +{delta}%
  - 💡 תובנה יומית: {insight_of_the_day}
  - 🛡️ מצב Sentinel: {בטוח/מסוכן}
- **פורמט:** שימוש ב־`\u200F` (RTL mark) ותצוגת HTML לטלגרם; כל האחוזים מחושבים ב־Decimal.js.

---

## 3. רטרוספקטיבה שבועית (דוח CEO — שבת 21:00)

- **קובץ:** `lib/workers/weekly-retrospective-task.ts`
- **Cron:** `GET /api/cron/weekly-retrospective` — ב־`vercel.json`: `"0 21 * * 6"`.
- **תוכן:**
  - 🏆 **מהלך השבוע:** סמל מוביל (לפי PnL מצטבר) + רווח/הפסד באחוזים.
  - 📚 **לקחים שהופקו:** סיכום `key_lesson_he` מדוחות הלמידה (`learning_reports`) בשבוע.
  - ⚙️ **המלצות כיול:** משקלים נוכחיים (נפח, RSI, סנטימנט) + רשומות מ־`weight_change_log` מהשבוע (שינויי RSI/ATR/Volume בהתאם לנתוני השבוע).

---

## 4. ממשק: וידג'ט התקדמות למידה

- **מיקום:** `app/performance/page.tsx` → `PerformanceShowcase.tsx`
- **API:** `GET /api/ops/metrics/learning-accuracy?from_date=&to_date=` — מחזיר `data[]` מ־`daily_accuracy_stats` (תאריך, win_rate, prediction_accuracy_score, learning_delta).
- **גרף:** גרף קווי קטן (Recharts) של `prediction_accuracy_score` לאורך זמן.
- **Tooltip:** "רמת דיוק משופרת על סמך סינון תבניות עבר" + ערכי דיוק ואחוז הצלחה.

---

## 5. אינטגרציה טכנית

- **Decimal.js:** כל חישובי דלתא ואחוזי PnL ב־`learning-metrics`, `daily-report-task` ו־`weekly-retrospective-task` משתמשים ב־`toDecimal`, `round2` וחשבון באמצעות Decimal.
- **טלגרם RTL:** הודעות מתחילות ב־`\u200F` ומשתמשות ב־`parse_mode: 'HTML'` לתמיכה נכונה בעברית.
- **אבטחת Cron:** שני הנתיבים `/api/cron/daily-report` ו־`/api/cron/weekly-retrospective` מאומתים עם `CRON_SECRET` או `WORKER_CRON_SECRET` (Bearer או query `secret=`).

---

## 6. קבצים שנוספו/שונו

| קובץ | תיאור |
|------|--------|
| `lib/db/learning-metrics.ts` | טבלת `daily_accuracy_stats`, `calculateDailyAccuracyDelta`, `getDailyAccuracyStatsByDate`, `getDailyAccuracyStatsInRange` |
| `lib/workers/daily-report-task.ts` | `runDailyReportTask()` — סיכום יומי לטלגרם |
| `lib/workers/weekly-retrospective-task.ts` | `runWeeklyRetrospectiveTask()` — דוח CEO שבועי |
| `lib/db/learning-reports.ts` | פונקציה `getLearningReportsInRange(fromDate, toDate)` |
| `app/api/cron/daily-report/route.ts` | Cron 23:59 |
| `app/api/cron/weekly-retrospective/route.ts` | Cron שבת 21:00 |
| `app/api/ops/metrics/learning-accuracy/route.ts` | API לנתוני דיוק למידה לתצוגה |
| `components/PerformanceShowcase.tsx` | גרף "התקדמות למידה" + fetch ל־learning-accuracy |
| `vercel.json` | הוספת שני cron jobs |

---

## אימות

המערכת **מעקבת כעת אחר צמיחת האינטליגנציה שלה יומית**: בכל הרצה של הסיכום היומי (23:59) מחושבים דיוק והדלתא ונשמרים ב־`daily_accuracy_stats`; דוח CEO השבועי מספק סיכום לקחים והמלצות כיול; ודף הביצועים מציג את מגמת הדיוק לאורך זמן.

— Smart Money v1.4, מחלקת דאטה ומחקר
