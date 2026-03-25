# שדרוג פאנל הסורק והתראות הטלגרם — Mon Chéri Quant AI

**תאריך:** 14 במרץ 2025  
**היקף:** חיבור וידג'ט הסורק למסד נתונים, מתג הפעלה/כיבוי בהגדרות, ושדרוג פורמט ההתראות לטלגרם לרמת Institutional.

---

## 1. ניהול מצב במסד (Vercel Postgres)

### טבלת system_settings (שורה בודדת)
- **קובץ:** `lib/db/system-settings.ts`
- **טבלה:** `system_settings` עם אילוץ `id = 1` (singleton).
- **עמודות:**
  - `scanner_is_active` — BOOLEAN, ברירת מחדל `true`
  - `last_scan_timestamp` — BIGINT (חותמת זמן מילישניות)
  - `updated_at` — TIMESTAMPTZ
- **פונקציות:** `getScannerSettings()`, `setScannerActive(boolean)`, `setLastScanTimestamp(ts)`.

### עדכון מסלול ה־Cron
- **קובץ:** `app/api/cron/scan/route.ts`
- **לפני הסריקה:** קריאה ל־`getScannerSettings()`. אם `scanner_is_active === false` — החזרת `{ ok: true, status: 'disabled', message: 'הסורק כבוי בהגדרות' }` בלי להריץ את הסורק.
- **אחרי סריקה מוצלחת:** קריאה ל־`setLastScanTimestamp(Date.now())` כדי לעדכן את זמן הסריקה האחרון במסד.

---

## 2. פאנל שליטה ווידג'ט דינמי

### API הגדרות סורק
- **מסלול:** `GET` / `POST` `/api/settings/scanner`
- **GET:** מחזיר `scanner_is_active`, `last_scan_timestamp`, `last_scan_time_iso`, `status`, `last_run_stats`, `gems_found_today`. דורש עוגיית סשן (לא בהכרח admin).
- **POST:** גוף `{ scanner_is_active: boolean }`. מעדכן את ההגדרה. דורש דרגת **admin** (אימות עוגיה + `hasRequiredRole(session.role, 'admin')`).

### וידג'ט בהגדרות
- **רכיב:** `components/ScannerControlPanel.tsx` (Client Component)
- **נתונים:** מקבל `initialData` מ־`getScannerStatus()` (SSR), ואז מסנכרן עם `GET /api/settings/scanner` בטעינה ובכל 60 שניות.
- **מצב פעיל/לא פעיל:** אינדיקטור ירוק מהבהב (`animate-pulse`) כאשר הסורק פעיל, ואפור כאשר כבוי.
- **זמן סריקה אחרונה:** תצוגה יחסית בעברית — "עכשיו", "לפני X דקות", "לפני X שעות", "אתמול", או תאריך מלא. מתעדכן כל דקה באמצעות state עדכון.
- **מתג הפעלה/כיבוי:** מתג (switch) בסגנון Amber/Gold — רקע וטבעת צהוב־זהב כשפעיל, אפור כשכבוי. לחיצה שולחת `POST /api/settings/scanner` עם הערך ההפוך; במצב טעינה הכפתור מושבת (`toggling`).
- **עיצוב:** גלאסמורפיזם (`bg-zinc-900/50`, `backdrop-blur-md`, `border-white/5`) בהתאם לשאר דף ההגדרות.

### עדכון getScannerStatus
- **קובץ:** `app/actions.ts`
- **שינוי:** המיזוג עם המסד — קריאה ל־`getScannerSettings()` ומחזיר גם `scanner_is_active` ו־`lastScanTime` מתוך `last_scan_timestamp` כשקיים, אחרת ממצב הזיכרון של הסורק.

---

## 3. שדרוג פורמט ההתראה לטלגרם (Institutional)

- **קובץ:** `lib/workers/market-scanner.ts`
- **שינוי:** בניית `messageText` לפני שליחה ל־`sendGemAlert()` בפורמט אחיד ומקצועי (HTML), עם escape ל־`escapeHtml()` ממודול הטלגרם.

### מבנה ההתראה (עברית)

```
🚨 **Mon Chéri Quant AI | זיהוי הזדמנות** 🚨

💎 **נכס:** [SYMBOL]
📊 **הסתברות הצלחה:** [XX]% | **סיכון:** [גבוה/נמוך/בינוני]

🎯 **מחיר יעד:** $[Target]
🛑 **תמיכה קריטית:** $[Support]

🧠 **תזת ה-AI:**
[משפט או שניים מתוך שדה הלוגיקה של התחזית — עד 280 תווים]

בחר פעולה:
```

- **מחיר יעד:** מחושב מ־`entry_price` ו־`target_percentage` — שורי: `entry * (1 + target_percentage/100)`, דובי: `entry * (1 - target_percentage/100)`.
- **תמיכה קריטית:** שורי — 2% מתחת לכניסה (`entry * 0.98`), דובי — 2% מעל (`entry * 1.02`).
- **סיכון:** מתוך `risk_level_he` מהתחזית, או "בינוני" כברירת מחדל.
- **תזת ה-AI:** `logic` מהתחזית, מקוצר ל־280 תווים עם ריווח נורמלי, ומבוּתָּר ל־HTML.

---

## 4. דוגמת הודעת טלגרם (לאחר השדרוג)

```
🚨 Mon Chéri Quant AI | זיהוי הזדמנות 🚨

💎 נכס: BTC
📊 הסתברות הצלחה: 82% | סיכון: בינוני

🎯 מחיר יעד: $52,400.00
🛑 תמיכה קריטית: $49,000.00

🧠 תזת ה-AI:
הנפח העולה יחד עם RSI מתון מעידים על המשך מגמת עלייה קצרת טווח; סנטימנט החדשות תומך בעמדה שורית.

בחר פעולה:
[🚀 אשר סימולציה] [🔍 ניתוח עמוק]
[❌ התעלם]
```

---

## 5. קבצים שנוגעו

| קובץ | תיאור |
|------|--------|
| `lib/db/system-settings.ts` | **חדש** — טבלת system_settings ופונקציות get/update |
| `app/api/cron/scan/route.ts` | בדיקת scanner_is_active לפני סריקה, עדכון last_scan_timestamp אחרי הצלחה |
| `app/api/settings/scanner/route.ts` | **חדש** — GET/POST להגדרות סורק עם אימות עוגיה ו־admin |
| `app/actions.ts` | getScannerStatus ממיזג נתונים מ־system_settings |
| `components/ScannerControlPanel.tsx` | **חדש** — וידג'ט עם מתג Amber, זמן יחסי, אינדיקטור פעיל |
| `app/settings/page.tsx` | החלפת בלוק הסטטוס ב־ScannerControlPanel |
| `lib/workers/market-scanner.ts` | בניית הודעת טלגרם בפורמט Institutional עם מחיר יעד, תמיכה ותזה |

---

**סיום המסמך.**
