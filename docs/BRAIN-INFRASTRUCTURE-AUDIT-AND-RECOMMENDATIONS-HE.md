# דוח ביקורת "מוח ותשתית" — Smart Money, Mon Chéri Group

**תאריך:** מרץ 2025  
**היקף:** לולאת הליבה, ייצוא דוחות, דף הגדרות, והמלצות אסטרטגיות.

---

## 1. סיכום ביקורת הלוגיקה ("המוח")

### 1.1 לולאת הליבה (סורק, ג'ם־פיינדר, שירות סימולציה)

| רכיב | ממצא | סטטוס |
|------|------|--------|
| **market-scanner** (`lib/workers/market-scanner.ts`) | מריץ מחזור סריקה כל 20 דקות; משתמש ב־`getCachedGemsTicker24h()` ואז ב־`doAnalysisCore` לכל מועמד. יש השהייה בין סימבולים (`scannerDelayBetweenSymbolsMs`). | ✅ יציב |
| **gem-finder** (`lib/gem-finder.ts`) | מסנן לפי נפח 24h ונזילות; משתמש ב־`fetchWithBackoff` מול Binance. אין שמירת מצב גלובלי בין קריאות. | ✅ יציב |
| **simulation-service** (`lib/simulation-service.ts`) | פותח/סוגר עסקאות וירטואליות; כל חישובי PnL ואחוזים ב־Decimal.js. | ✅ יציב |
| **cache-service** (`lib/cache-service.ts`) | Cache אחד ב־memory עם TTL 5 דקות. אין גידול בלתי מוגבל — מערך אחד מוחלף. | ✅ ללא דליפות זיכרון צפויות |
| **משימות Cron** | `runOneCycle` נקרא מ־`/api/cron/scan`; אין `setInterval` שנשאר פעיל ללא ניקוי ב־serverless (כל קריאה מסתיימת). ב־dev, `startMarketScanner()` משתמש ב־`setInterval` — יש לו `intervalId` אחד בלבד ו־`stopMarketScanner()` מנקה. | ✅ מתאים ל־serverless |

**המלצות:**

- **חיבורי DB:** Vercel Postgres (`@vercel/postgres`) מטפל ב־connection pooling בצד השרת; אין פתיחת connections ידנית. כל route קורא ל־`sql\`...\`` ונסגר. ✅ אין צורך בשינוי.
- **תדירות עדכונים:** הסורק רץ כל 20 דקות; העומס על DB סביר. אם יוגדל מספר המועמדים, לשקול הגבלת concurrence או השהייה גדולה יותר.

### 1.2 זרימת נתונים: ג'ם נמצא (Scan → Filter → Logic → Notification → UI)

| שלב | מימוש | אטומיות / טיפול בשגיאות |
|-----|--------|--------------------------|
| Scan | Cron קורא ל־`runOneCycle()` → `getCachedGemsTicker24h()` | try/catch במסלול; כישלון נכתב ל־audit ו־console. |
| Filter | `tickers.filter(...).slice(0, MAX_GEMS_PER_CYCLE)` — מועמדים לפי נפח ותמיכה. | סינון סינכרוני; אין DB בשלב זה. |
| Logic | `doAnalysisCore(symbol)` — Binance + Gemini → תוצאה. | כל סימבול ב־try/catch; כישלון לא עוצר את המחזור. |
| Notification | אם `probability > confidenceThreshold` ו־לא ב־`recentlyAlerted`: `insertScannerAlert` ואז `sendGemAlert`. | ה־DB נכתב לפני שליחת טלגרם; אם השליחה נכשלת, ההתראה כבר נרשמה (idempotent מבחינת לוג). |
| UI Update | דשבורד/סטריפ ג'מים טוענים מ־API (למשל `/api/crypto/gems`, סורק סטטוס). | אין transaction משותף עם הסורק; eventual consistency. |

**מסקנה:** הזרימה לא אטומית כ־transaction יחיד (וזה מקובל: שליחת טלגרם חיצונית). רצף הלוגיקה מוגן מטעויות: כישלון בשלב אחד לא משחית את הנתונים ב־DB, וההתראות נשלחות רק אחרי רישום.

### 1.3 Precision Guard — שימוש ב־Decimal.js (ללא float בנתיב פיננסי)

| קובץ / נתיב | שימוש ב־Decimal | הערות |
|-------------|-----------------|--------|
| `lib/decimal.ts` | `toDecimal`, `round2`, `round4`, `D`, `applySlippage` | בסיס כל החישובים הכספיים. |
| `lib/db/virtual-portfolio.ts` | חישובי `pnl_pct`, סכומים | ✅ |
| `lib/simulation-service.ts` | `checkAndCloseTrades`, PnL%, `getVirtualPortfolioSummary` | ✅ |
| `app/api/simulation/trades/route.ts` | עמלה, סכומים | ✅ |
| `app/api/simulation/summary/route.ts` | מחירים, יתרות, PnL לא ממומש | ✅ |
| `app/api/ops/metrics/pnl/route.ts` | חישובי backtest | ✅ |
| `context/SimulationContext.tsx` | עמלה, חישובי ארנק מעסקאות | ✅ |
| `lib/workers/market-scanner.ts` | `targetPrice`, `supportPrice` לטקסט הודעת טלגרם בלבד (לא שמירה/ביצוע) | ⚠️ הצגה בלבד — לא נתיב חישובי רווח/הפסד. |

**מסקנה:** בכל נתיב שמשפיע על רווח/הפסד, יתרות או עמלות — משתמשים ב־Decimal.js. אין float בנתיב פיננסי קריטי.

---

## 2. ייצוא דוחות — תיקונים שבוצעו

### 2.1 סיבת התקלה (לפני התיקון)

- **תלות ב־SSR:** `jspdf` ו־`html2canvas` יובאו ברמת המודול ב־`PnlTerminal.tsx`. בסביבות מסוימות (build/SSR) זה יכול לגרום לשגיאות אם המודולים תלויים ב־DOM או ב־window.
- **חוסר טיפול בשגיאות:** אם `html2canvas` נכשל (למשל CORS, אלמנט לא מוכן), השגיאה לא טופלה ו־המשתמש לא קיבל feedback.

### 2.2 שינויים שבוצעו

1. **דינמי import:** ייבוא `jspdf` ו־`html2canvas` רק בתוך `exportPdf()` via `import('jspdf')` ו־`import('html2canvas')` — כך שהם נטענים רק בדפדפן בעת לחיצה על ייצוא.
2. **טיפול בשגיאות:** `try/catch` עם הודעת toast (או `console.error` אם אין ToastProvider).
3. **CSV:** נוסף ייצוא CSV עם סיכום תיק ועסקאות אחרונות, כולל ברנדינג וזמן ביצוע.
4. **ברנדינג ומשפט disclaimer:** בכל דוח PDF/CSV: "Smart Money & Mon Chéri Group", זמן נוכחי, וטקסט משפטי (המידע למטרות לימוד וסימולציה בלבד, לא ייעוץ השקעות).

---

## 3. דף ההגדרות — "מרכז שליטה"

הוסף רכיב **SettingsCommandCenter** ודף ההגדרות עודכן כך:

- **קטגוריה א — ניהול סיכונים:** סטופ־לוס % (ברירת מחדל), יעד רווח % (ברירת מחדל), גודל פוזיציה ב־USD.
- **קטגוריה ב — רגישות הסורק:** נפח מינימלי 24h (USD), שינוי מחיר מינימלי לזיהוי ג'ם (%), סף ביטחון AI (סליידר).
- **קטגוריה ג — מערכת וממשק:** התראות טלגרם (כן/לא), התראות קול (כן/לא), ערכת נושא (כהה/בהיר/ים עמוק), מרווח רענון נתונים (1 / 5 / 15 דקות).

ההגדרות נשמרות ב־טבלת `settings` (מפתח `app_settings`, ערך JSON) דרך `/api/settings/app` (GET/POST). בממשק: כרטיסים, תוויות בעברית, tooltips להסבר, וכפתור "שמור שינויים" עם toast הצלחה.

---

## 4. המלצות אסטרטגיות ופוליש

### 4.1 שלוש תכונות/שיפורים חסרים לכלי מסחר מקצועי

1. **חיבור הגדרות "מרכז שליטה" ללוגיקה:**  
   כרגע ההגדרות (נפח מינימלי, שינוי מחיר מינימלי, סף ביטחון AI) נשמרות ב־DB אך הסורק וה־gem-finder עדיין משתמשים בקבועים (למשל `MIN_VOLUME_24H_USD`, `DEFAULT_CONFIDENCE_THRESHOLD`). מומלץ ש־`runOneCycle()` יקרא את `getAppSettings()` ויעביר את ערכי הסורק ל־`getCachedGemsTicker24h` (או ל־filter אחר) ולסף ההסתברות — כך שהמשתמש יוכל לשלוט ברגישות מהממשק.

2. **יישום ערכת נושא ומרווח רענון ב־Client:**  
   ערכי "ערכת נושא" ו־"מרווח רענון" נשמרים בהגדרות אך לא משפיעים עדיין על הממשק. מומלץ:  
   - **Theme:** Provider או `useEffect` שקורא את `theme` מ־API/מטמון ומעדכן `document.documentElement.dataset.theme` או class (למשל `dark` / `light` / `deep-sea`) ב־layout או ב־root.  
   - **Refresh interval:** קומפוננטות שמבצעות polling (למשל סיכום סימולציה, סטטוס סורק) יקראו את `dataRefreshIntervalMinutes` (מ־context או API) וישתמשו בו ב־`setInterval`/`useEffect` במקום ערך קבוע.

3. **גיבוי ושחזור הגדרות + ייצוא לוגים:**  
   לכלי מקצועי כדאי:  
   - כפתור "ייצוא הגדרות" (JSON) ו־"ייבוא הגדרות" (עם validation).  
   - אופציה לייצוא לוג אירועים (למשל audit, התראות שנשלחו) ל־CSV/JSON לתחקור ותאימות.

### 4.2 Quick Win — סקריפט לדוגמה: יישום Theme מ־הגדרות

הקטע הבא מראה איך לחבר את ערכת הנושא מההגדרות ל־DOM (ב־client). ניתן להכניס ב־layout או ב־AppShell:

```tsx
// e.g. in components/ThemeApplicator.tsx (client component)
'use client';

import { useEffect } from 'react';

const THEME_CLASS: Record<string, string> = {
  dark: 'dark',
  light: 'light',
  'deep-sea': 'deep-sea',
};

export function ThemeApplicator() {
  useEffect(() => {
    let cancelled = false;
    fetch('/api/settings/app', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.system?.theme) return;
        const theme = data.system.theme as string;
        const next = THEME_CLASS[theme] ?? 'dark';
        document.documentElement.dataset.theme = next;
        document.documentElement.classList.remove('dark', 'light', 'deep-sea');
        document.documentElement.classList.add(next);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return null;
}
```

ב־CSS/ Tailwind יש להגדיר משתנים או classes ל־`.dark`, `.light`, `.deep-sea` (למשל רקע, צבע טקסט) כדי שהערכת הנושא תופיע בפועל.

---

**סיום הדוח.** כל הטקסטים בעברית תואמים RTL ומשמשים בממשק בהתאם.
