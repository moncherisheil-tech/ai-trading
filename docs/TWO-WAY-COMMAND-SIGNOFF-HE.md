# Two-Way Command Sign-off — קו חם למנכ"ל

## אימות דו־נתיבי

**המנכ"ל יכול כעת לתקשר עם המערכת בשתי דרכים:**

1. **ממשק ווב (Master Command Center)**  
   בעמוד ההגדרות (`/settings`), בלשונית **צ'אט מנהלים**, ניתן לשלוח הודעות למפקח העליון (Virtual COO) ולקבל תשובות בעברית מקצועית בהתבסס על נתוני מערכת חיים (חשיפה, PnL יומי, סף MoE, אחוז הצלחה).

2. **טלגרם (Executive Hotline)**  
   כאשר `TELEGRAM_ADMIN_CHAT_ID` מוגדר ב־`.env`, רק צ'אט עם מזהה זה יכול לשלוח הודעות חופשיות (לא פקודות) ולקבל תשובת AI מהמפקח העליון. פקודות כמו `/status`, `/portfolio`, `/help` ממשיכות לעבוד גם מ־`TELEGRAM_CHAT_ID` (אם מוגדר).

**אבטחה:** ה־Webhook מאמת ש־`chat.id` תואם ל־`TELEGRAM_ADMIN_CHAT_ID` לפני עיבוד הודעות AI. כל שאר המשתמשים מתעלמים.

---

## רישום Webhook של טלגרם (curl)

לאחר פריסת האפליקציה, יש לרשום את כתובת ה־Webhook אצל טלגרם כדי שהבוט יקבל עדכונים (הודעות ומקשי inline).

**החלף:**
- `YOUR_BOT_TOKEN` — הטוקן של הבוט מ־@BotFather  
- `https://your-domain.com` — כתובת הבסיס של האפליקציה (ללא סלאש בסוף)

```bash
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-domain.com/api/telegram/webhook"}'
```

**דוגמה (תחליף את הערכים):**
```bash
curl -X POST "https://api.telegram.org/bot123456:ABC-DEF/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://myapp.vercel.app/api/telegram/webhook"}'
```

**תשובה מוצלחת:**
```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

**ביטול Webhook (לבדיקות):**
```bash
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/deleteWebhook"
```

**משתני סביבה נדרשים:**
- `TELEGRAM_BOT_TOKEN` — טוקן הבוט  
- `TELEGRAM_CHAT_ID` — מזהה צ'אט להתראות ופקודות (אופציונלי אם משתמשים רק ב־ADMIN)  
- `TELEGRAM_ADMIN_CHAT_ID` — מזהה צ'אט המנכ"ל; רק צ'אט זה מקבל תשובות AI על הודעות חופשיות (Executive Hotline)

---

## סיכום

המנכ"ל יכול לשלוח הודעה בטלגרם (מהצ'אט שמוגדר כ־`TELEGRAM_ADMIN_CHAT_ID`) ולקבל תשובה מיידית מהמפקח העליון — תובנות פורטפוליו, סיכון וסטטוס מערכת — בעברית. במקביל, ממשק ה־Web במרכז השליטה מספק צ'אט זהות לאותה לוגיקה.

**הגדרות עודכנו וסונכרנו מול המפקח העליון.**
