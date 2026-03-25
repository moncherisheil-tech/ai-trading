# דוח יישום — ביצועים וליטוש UI (Performance & Polish Resolution)

**תאריך:** 2025-03-15  
**סטטוס:** הושלם

---

## שלב 1: ייצוא דוחות (הדפסה מקורית — ללא חלונות קופצים)

### הבעיה
גישת "חלון חדש / popup" לייצוא דוחות נכשלה בדפדפנים (חסימת חלונות קופצים).

### הפתרון
- **PnlTerminal:** כפתור "ייצוא דוח" (PDF) מפעיל כעת **`window.print()`** ישירות — ללא פתיחת חלון, ללא תלות ב־`openReportPrintWindow`.
- **PerformanceShowcase:** כפתור "ייצוא דו\"ח ביצועים (PDF)" מפעיל **`window.print()`** באותו אופן.
- **CSS להדפסה (`app/globals.css` — `@media print`):**
  - **הסתרת אלמנטים:** ניווט, סיידבר, כותרות וכפתורים אינטראקטיביים — `display: none !important` ו־`visibility: hidden !important` (ספציפית: `header`, `nav`, `aside`, `.sidebar`, כפתורים ו־links שלא מסומנים כ־`.print-show`).
  - **כיוון ועברית:** `direction: rtl !important` ו־`font-family: system-ui, Arial, "Rubik", sans-serif !important` על `html`, `body` ו־`.print-mode`.
  - **רקע ולמען PDF נקי:** `background: white !important`, `color: black !important` על הדף; בתוך `.print-mode` טקסט שחור ורקע לבן, עם שמירה על גוונים לירוק/אדום (תשואה חיובית/שלילית) להבחנה ויזואלית.
  - **מניעת שבירת עמוד:** `page-break-inside: avoid !important` ו־`break-inside: avoid !important` על טבלאות, גרפים ו־sections בתוך `.print-mode`, כדי שהדוח יישב יפה על דף A4.

תוכן המודפס הוא האזור המסומן במחלקה **`print-mode`** (ב־PnlTerminal — הבלוק של סיכום מנהלים; ב־PerformanceShowcase — ה־div העוטף את סיכום הביצועים, עקומת הון ופירוט חודשי).

---

## שלב 2: אופטימיזציית ביצועים

### Memoization
קומפוננטות כבדות עטופות ב־**`React.memo`** כדי למנוע רינדור מיותר:

- **PnlTerminal** — ייצוא כ־`memo(PnlTerminalInner)`.
- **PerformanceShowcase** — ייצוא כ־`memo(PerformanceShowcaseInner)`.
- **PortfolioAllocation** — ייצוא כ־`memo(PortfolioAllocationInner)`.
- **OpsMetricsBlock** — ייצוא כ־`memo(OpsMetricsBlockInner)`.

כך טבלאות נתונים, גרפים ו־widgets של דשבורד לא מתעדכנים אלא כאשר ה־props שלהם משתנים.

### מצבי טעינה (Loading Skeletons)
- **תצוגת ביצועים (PerformanceShowcase):** בעת טעינת `/api/ops/metrics/historical` מוצג **שלד טעינה** עם `animate-pulse` — רשת כרטיסים (תשואה, אחוז הצלחה, מקדם רווח, שרפ), בלוק גרף מלבני, ורשת פירוט חודשי — במקום ספינר בלבד, כדי לתת תחושת תגובה מיידית.
- **מסוף PnL (PnlTerminal):** בלוק הסימולציה (Paper Trading) מציג **Skeleton** עם `animate-pulse` בזמן טעינת `/api/simulation/summary` — כבר היה קיים; נשאר עקבי עם שאר הממשק.

### תיקון 404 לאייקונים
- **manifest.json:** מערך **`icons`** רוקן (`[]`) — אין עוד פנייה ל־`/icons/icon-192.png` או `/icons/icon-512.png`, ולכן לא נזרקות שגיאות 404 שמעמיסות על שרת הפיתוח.
- **PwaMeta.tsx:** הוסר ה־`link` ל־`apple-touch-icon` (שהצביע ל־`/icons/icon-192.png`). ה־meta של PWA ו־iOS נשארים (manifest, apple-mobile-web-app-*).

---

## שלב 3: ליטוש UI — תחושת "Bloomberg Terminal"

### מעברי hover ואנימציה
- **globals.css:** הוגדרו כללים גלובליים לכל האלמנטים הלחיצים:
  - `transition: all 0.3s ease-in-out` על כפתורים, קישורים ו־`[role="button"]`.
  - **hover:** `transform: scale(1.02)`.
  - **active:** `transform: scale(0.95)`.
- בקומפוננטות (PnlTerminal, PerformanceShowcase, OpsMetricsBlock) נוספו במפורש:
  - `transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-95` על כפתורים, קישורים וכרטיסים.

### גלאסמורפיזם (Glassmorphism)
- **גבול ורקע:** `border-white/10`, `bg-black/40`, `backdrop-blur-xl` הוחלו על:
  - כרטיסי מדדים במסוף PnL (תיק, רווח %, אחוז הצלחה, מקדם רווח, שרפ, משיכה מקסימלית).
  - בלוק הדוח להדפסה, גרפים (עקומת הון, ביצועים יומיים/חודשיים), טבלת העסקאות ובלוק הסימולציה ב־PnlTerminal.
  - תצוגת ביצועים: סיכום מערכת, עקומת הון, התקדמות למידה, פירוט חודשי.
  - OpsMetricsBlock: כל כרטיסי המדדים (תחזיות, ממתינות, הוערכו, latency, מודל גיבוי, תיקון, אזהרות, שגיאות).
- **globals.css:** נוספה מחלקה **`.glass-panel`** עם `border: 1px solid rgba(255,255,255,0.1)`, `background: rgba(0,0,0,0.4)`, `backdrop-filter: blur(24px)` לשימוש עתידי.

### יישור ו־overflow
- **רשתות דשבורד:** ל־grids נוספו `min-w-0 overflow-hidden` כדי למנוע טקסט גולש ושבירת layout.
- **פינות:** שימוש עקבי ב־**`rounded-xl`** בכרטיסים, כפתורים ובלוקים; בלוק הדוח להדפסה נשאר עם `rounded-2xl` לפריסה נוחה ב־A4.

---

## סיכום

| היבט | שינוי |
|------|--------|
| **הדפסה/דוחות** | `window.print()` + `@media print` מלא (הסתרת chrome, RTL, עברית, רקע לבן, מניעת שבירת עמוד). |
| **ביצועים** | `React.memo` על PnlTerminal, PerformanceShowcase, PortfolioAllocation, OpsMetricsBlock. |
| **טעינה** | Skeleton עם `animate-pulse` ל־historical metrics ו־simulation summary. |
| **404** | הסרת הפניות ל־`/icons/icon-192.png` ב־manifest ו־PwaMeta. |
| **UI** | Hover/active scale על כל הלחיצים; glassmorphism (border-white/10, bg-black/40, backdrop-blur-xl); יישור ו־rounded-xl עקבי. |

— **סוף הדוח**
