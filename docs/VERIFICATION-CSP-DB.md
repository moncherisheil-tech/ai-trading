# רשימת אימות – CSP ו-DB אחרי פריסה

## פריסה ל-Production

```bash
vercel --prod
```

ודא ש־`DATABASE_URL` (Neon) מוגדר ב־Vercel: Project → Settings → Environment Variables.

---

## 1. אימות WebSocket (Binance)

- **איפה:** דף הבית / דשבורד שמציג טיקרים או מחירים חיים.
- **מה לבדוק:**
  - פתח DevTools → Console. **אין** שגיאות CSP על `connect-src` או חסימת `wss://stream.binance.com:9443`.
  - ברשת (Network): בקשת WebSocket ל־`stream.binance.com` במצב **101 Switching Protocols** (או שהחיבור פעיל).
- **סימן הצלחה:** טיקרים מתעדכנים בזמן אמת (מחירים/נפחים), ללא שגיאות CSP ב־Console.

---

## 2. אימות חיבור DB (אין 500)

- **Health check:** גלוש ל־`https://<ה-domain-שלך>/api/health/ready`.
  - **מצופה:** JSON עם `"status": "ready"` ו־`checks.db.ok: true` (אם ה-DB מחובר).
  - אם חסר `DATABASE_URL` או שה-DB נופל: `status: "degraded"` או `503`, ו־`checks.db.details` עם פרטי השגיאה.
- **דף שמושך נתונים מה-DB:** למשל דף היסטוריה / חיזויים / הגדרות.
  - **מצופה:** הדף נטען, ללא 500. אם יש שגיאת DB, ה־API מחזיר 500 עם JSON (למשל ב־`/api/ops/metrics`: `{ success: false, error: "Database unavailable" }`).

---

## 3. סיכום מה תוקן

| נושא | תיקון |
|------|--------|
| CSP חוסם WebSocket ל-Binance | הוספת `connect-src 'self' wss://stream.binance.com:9443 https://api.binance.com https://*.vercel.app https://*.neon.tech` ב־`next.config.ts` |
| 500 בגלל DB ב-Vercel | אתחול DB רק כש־`DATABASE_URL` קיים; `initDB()` ב־try/catch ולא מפיל route; `getDbAsync` מחזיר `[]` כשאין DB; `/api/ops/metrics` מחזיר 500 JSON במקום crash |

---

**אחרי הפריסה:** בדוק Console (ללא CSP על Binance), WebSocket פעיל, ו־`/api/health/ready` מציג חיבור DB תקין.
