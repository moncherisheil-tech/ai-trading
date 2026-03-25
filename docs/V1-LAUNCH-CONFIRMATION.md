# אישור השקה — Smart Money v1.0

**תאריך:** 14 במרץ 2025  
**גרסה:** 1.0  
**סטטוס:** מוכן להפעלה אוטונומית

---

## 1. סיכום ביצוע ניקוי והכנה לייצור

### טבלאות שנוקו (אתחול אפס)
- **agent_insights** — כל הרשומות מהשלב הניסיוני הוסרו.
- **virtual_portfolio** — כל העסקאות הווירטואליות (כולל Mock/Test) הוסרו.
- **backtest_logs** — כל רשומות הבקטסט (כולל בדיקות) הוסרו.
- **scanner_alert_log** — היסטוריית ההתראות של הסורק אופסה כדי שהמחזור הראשון בייצור ייחשב כ"הראשון".

### מה נשמר (לא נוגע)
- **טבלת settings (מרכז השליטה — AppSettings)** — נשארה intact עם הפרמטרים המעודכנים והמכוילים.

### איפוסים נוספים
- **lastDiagnostics** במעבד הסורק (`market-scanner.ts`) — אופס; הסריקה הבאה תירשם כסריקה הרשמית הראשונה בייצור.
- **מטמון טיקר (ticker cache)** — רוקן כדי שהסריקה הראשונה תמשוך נתוני שוק עדכניים.

---

## 2. אימות משתני סביבה (Production)

ב־Vercel / Cloud יש לוודא שהמפתחות הבאים מוגדרים ופעילים:

| משתנה | תיאור | סטטוס |
|--------|--------|--------|
| `DATABASE_URL` או `POSTGRES_URL` | חיבור Vercel Postgres | נדרש |
| `GEMINI_API_KEY` | מפתח API ל־Gemini (ניתוח AI) | נדרש |
| `TELEGRAM_BOT_TOKEN` | בוט טלגרם להתראות ומשוב | נדרש להתראות |
| `TELEGRAM_CHAT_ID` | מזהה צ'אט למנהל | נדרש להתראות |
| `CRON_SECRET` או `WORKER_CRON_SECRET` | אבטחת קריאות Cron וניקוי | נדרש |
| `APP_URL` / `NEXT_PUBLIC_APP_URL` | כתובת האתר (למשל https://moncherigroup.co.il) | נדרש |
| `PRODUCTION_CLEANUP_SECRET` | אופציונלי; לאימות POST /api/ops/cleanup-production | אופציונלי (ניתן CRON_SECRET) |

**Binance:** המערכת משתמשת ב־api.binance.com; אם יש חסימה אזורית (451) יש להגדיר `PROXY_BINANCE_URL`.

---

## 3. ביצוע הניקוי וההשקה

### שלב א — ניקוי ייצור (פעם אחת)
```bash
curl -X POST "https://moncherigroup.co.il/api/ops/cleanup-production?notify=1" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```
- `notify=1` — שולח הודעת טלגרם: "🚀 Smart Money v1.0 באוויר! המערכת מאותחלת, נקייה וסורקת כעת בשידור חי."

### שלב ב — מחזור ראשון (הפעימה הראשונה)
לאחר הדיפלוי, להפעיל סריקה אחת:
```bash
curl -X GET "https://moncherigroup.co.il/api/cron/scan" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```
- `MarketSafetySentinel` (`getMarketRiskSentiment`) מזהה אוטומטית את מצב השוק (Safe/Dangerous) ומשמש את הסורק.
- הרישום הראשון של אבחון הסורק (`lastDiagnostics`) ייחשב ככניסה הרשמית הראשונה בייצור.

### שלב ג — בניית ייצור ופריסה ל־Vercel
```bash
# Repository root (flat layout; no nested ai--main folder)
npm run build
vercel --prod
```
לוודא שב־Vercel Domain מוגדר `moncherigroup.co.il` (או www).

### שלב ד — אימות
- בדיקת לוגים ב־Vercel: הודעת "[Scanner] פעיל: נסרקו X מטבעות..." לאחר הקריאה ל־`/api/cron/scan`.
- קבלת הודעת טלגרם "🚀 Smart Money v1.0 באוויר!..." אם בוצע cleanup עם `notify=1`.

---

## 4. הצהרת סטטוס

**מאשרים כי:**
1. נתוני בדיקה וניסיון הוסרו מהטבלאות agent_insights, virtual_portfolio, backtest_logs ו־scanner_alert_log.
2. טבלת ההגדרות (AppSettings) לא שונתה ונשארה עם הפרמטרים המכוילים.
3. אבחון הסורק אופס והמחזור הבא ייחשב כסריקה הרשמית הראשונה בייצור.
4. ליבת המערכת האוטונומית (סורק שוק, Market Safety Sentinel, התראות טלגרם) פעילה ומוכנה.

**Smart Money v1.0 — באוויר.**

---

*מסמך זה נוצר כחלק מרצף הניקוי וההשקה הסופי (Final Cleanup and Launch Sequence).*
