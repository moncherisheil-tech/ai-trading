# דוח שדרוג תאימות ואבטחה — Mon Chéri Quant AI

**תאריך:** מרץ 2025  
**תפקיד:** CISO & Compliance Director  
**סטטוס:** הושלם

---

## 1. משפט ותאימות — הבהרה משפטית (Financial Disclaimer)

### מיקום
- **קומפוננטה:** `components/LegalDisclaimer.tsx`
- **שילוב:** ה-Footer המשפטי מוצג בכל דפי האפליקציה (מלבד דף הכניסה) דרך `AppShell.tsx`, בתחתית אזור התוכן הראשי.

### נוסח ההבהרה (עברית)
הטקסט המלא שהוטמע:
> "המידע המוצג במערכת זו נוצר על ידי בינה מלאכותית ומיועד למטרות לימוד וסימולציה בלבד. אין לראות במידע זה ייעוץ השקעות, המלצה לפעולה או תחליף לייעוץ פיננסי מקצועי. המסחר במטבעות קריפטוגרפיים כרוך בסיכון גבוה."

### קישורים משפטיים
- **תנאי שימוש:** `/terms` — דף placeholder עד לעדכון משפטי סופי (`app/terms/page.tsx`).
- **מדיניות פרטיות:** `/privacy` — דף placeholder עד לעדכון משפטי סופי (`app/privacy/page.tsx`).

### נגישות
- ל-Footer הוגדר `role="contentinfo"` ו-`aria-label="תנאים משפטיים והבהרות"`.
- קישורי תנאי שימוש ומדיניות פרטיות כוללים טבעת פוקוס נראית (`focus-visible:ring-2`) לתמיכה בניווט מקלדת.

---

## 2. אבטחת API ומשתני סביבה — כותרות אבטחה (Security Headers)

### קובץ: `next.config.ts`

כותרות HTTP שהוגדרו (כולל אלו שהיו קיימות ואלו שהוספו):

| כותרת | ערך | תיאור |
|--------|-----|--------|
| **Content-Security-Policy** | default-src 'self'; script-src/style-src/img-src/…; frame-ancestors 'none'; connect-src מוגבל | מגביל מקורות טעינה ומניעת הטמעת האתר ב-frame |
| **X-Content-Type-Options** | nosniff | מונע MIME sniffing |
| **X-Frame-Options** | DENY | מונע הטמעה ב-iframes |
| **X-XSS-Protection** | 1; mode=block | הגנה מפני XSS בדפדפנים תומכים |
| **Referrer-Policy** | strict-origin-when-cross-origin | שליטה במידע Referrer |
| **Permissions-Policy** | camera=(), microphone=(), geolocation=() | כיבוי הרשאות לא נדרשות |
| **Strict-Transport-Security** | max-age=31536000; includeSubDomains; preload | כפיית HTTPS (מומלץ בסביבת production עם HTTPS) |

### סריקת חשיפת מפתחות
- **תוצאה:** בקומפוננטות בתיקיית `components/` לא נמצא שימוש במשתני סביבה שאינם `NODE_ENV`.
- השימוש היחיד: `RegisterServiceWorker.tsx` — בדיקת `process.env.NODE_ENV === 'production'` (לא חושף סודות).
- **המלצה:** להשאיר מפתחות API ומשתנים רגישים רק בצד שרת (Route Handlers / Server Actions) ולשתמש ב-`NEXT_PUBLIC_*` רק עבור ערכים שבכוונה חשופים ללקוח.

---

## 3. נגישות (a11y) — תאימות WCAG AA

### כפתורים ו-aria-label
- **כניסה:** כפתור "כניסה מאובטחת" — `aria-label="כניסה מאובטחת למערכת"`.
- **תפריט (מובייל):** כפתור המבורגר — `aria-label="פתח תפריט"` / `"סגור תפריט"` (קיים, נוסף focus-visible).
- **הגדרות טלגרם:** ארבעת כפתורי הבדיקה — תוויות בעברית (בדיקת אינטגרציה, בדוק חיבור, מערכת פועלת, בדיקת עסקה).
- **מסוף רווח/הפסד:** כפתור ייצוא PDF — `aria-label` מתאר ייצוא דוח ל-PDF.
- **ניתוח קריפטו:** איפוס סימולציה, קנה/מכור בסימולציה, "טען עוד" — כולם עם `aria-label` מתאימים בעברית.
- **בחירת מטבע (SymbolSelect):** כפתורי האפשרויות — `aria-label="בחר מטבע {symbol}"`.
- **סימולציית BTC:** כפתור ההרצה — `aria-label` בהתאם למצב (הרצה/מנתח).
- **החלפת שפה, התנתקות, הערכת תחזיות:** כבר כללו `aria-label`; נוספו טבעות פוקוס.

### טפסים ותוויות
- **כניסה:** שדה סיסמה עם `id="password"` ו-`<label htmlFor="password">` (קיים).
- **הגדרות טלגרם:** שדות טוקן ומזהה צ'אט עם `id` ו-`<label htmlFor="...">` (קיים).
- **מסוף רווח/הפסד:** בקרת מינוף — `aria-labelledby="leverage-label"` ל-range ו-select.

### טבעת פוקוס (Focus Visible)
- **גלובלי:** ב-`app/globals.css` הוגדרו כללים ל-`button`, `a`, `input`, `select`, `textarea` עם `focus-visible` — טבעת פוקוס נראית (2px רקע + 4px עיגול אמבר) לתמיכה בניווט מקלדת.
- **ספציפי:** נוספו מחלקות `focus:outline-none focus-visible:ring-2 focus-visible:ring-*` לכפתורים ולקישורים רלוונטיים בכל הקומפוננטות שעודכנו.

---

## 4. SEO ומטא-תגים

### קובץ: `app/layout.tsx`

- **כותרת:** "מערכת ניתוח כמותי | Mon Chéri Quant AI".
- **תיאור (description):** עודכן להבהרה שהמערכת לימודית/סימולטיבית ואינה ייעוץ השקעות.
- **robots:** הוגדר `robots: 'noindex, nofollow'` — מניעת אינדוקס של דפי הלוח (כולל מסך הכניסה) במנועי חיפוש.
- **שפה וכיוון:** `lang="he"` ו-`dir="rtl"` על אלמנט `<html>` (קיים).

---

## 5. סיכום קבצים שנגעו

| קובץ | שינוי |
|------|--------|
| `components/LegalDisclaimer.tsx` | **חדש** — Footer משפטי בעברית + קישורי תנאי שימוש ומדיניות פרטיות |
| `components/AppShell.tsx` | שילוב `LegalDisclaimer` בתחתית התוכן |
| `app/terms/page.tsx` | **חדש** — דף placeholder לתנאי שימוש |
| `app/privacy/page.tsx` | **חדש** — דף placeholder למדיניות פרטיות |
| `next.config.ts` | הוספת X-XSS-Protection, Strict-Transport-Security, הערת CISO |
| `app/layout.tsx` | עדכון description, הוספת `robots: 'noindex, nofollow'` |
| `app/globals.css` | כללי focus-visible גלובליים לכפתורים, קישורים ושדות |
| `app/login/page.tsx` | aria-label לכפתור כניסה, focus-visible לשדה סיסמה ולכפתור |
| `components/AppHeader.tsx` | focus-visible לכפתור תפריט מובייל |
| `components/BottomNav.tsx` | (ניווט כבר עם aria-label; focus מטופל גלובלית) |
| `components/SettingsTelegramCard.tsx` | aria-label לארבעת הכפתורים, focus-visible לשדות ולכפתורים |
| `components/PnlTerminal.tsx` | aria-label לייצוא PDF, aria-labelledby למינוף, focus-visible |
| `components/CryptoAnalyzer.tsx` | aria-label לאיפוס, קנה/מכור, טען עוד; focus-visible לכפתורים |
| `components/SymbolSelect.tsx` | aria-label לכפתורי בחירת מטבע, focus-visible |
| `components/SimulateBtcButton.tsx` | aria-label, focus-visible |
| `components/LanguageToggle.tsx` | focus-visible |
| `components/LogoutButton.tsx` | focus-visible |
| `components/EvaluatePredictionsButton.tsx` | focus-visible |

---

**סיום ביקורת ושדרוג תשתית — המערכת מוכנה להמשך בדיקות והשקה בהתאם לדרישות הארגון.**
