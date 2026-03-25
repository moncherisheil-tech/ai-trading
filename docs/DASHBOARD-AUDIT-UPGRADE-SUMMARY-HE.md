# סיכום ביקורת ושדרוג — לוח סריקת שוק (RTL)

## קבצים ומבנה שזוהו לעדכון

### Phase 1: UI/UX ו־Component Consistency
| קובץ | שינויים מתוכננים |
|------|-------------------|
| `components/SettingsTelegramCard.tsx` | איחוד כפתורי "Test Telegram" ו־"בדוק חיבור" לפעולה אחת; המרת "מערכת פועלת" ל־Badge לא־לחיץ; הוספת Tooltips (i) ל־Chat ID/Token |
| `components/ScannerControlPanel.tsx` | המרת טקסט "פעיל"/"לא פעיל" ל־Badge סמנטי (ירוק/אפור); שדרוג Toggle לצבעים סמנטיים (ירוק פעיל, אפור כבוי); החלפת "—" ב־"טרם בוצעה סריקה" |
| `app/settings/page.tsx` | החלפת "—" ב־`formatDateTime` ל־empty state מקצועי; וידוא RTL ו־dir="rtl" |

### Phase 2: אופטימיזציית טבלאות
| קובץ | שינויים מתוכננים |
|------|-------------------|
| `components/PnlTerminal.tsx` | גבולות שורות עדינים / zebra striping; header sticky; יישור מספרים לימין (RTL); עמודות ניתנות למיון; pagination או virtual scroll |
| `app/ops/strategies/page.tsx` | sticky header; zebra striping; padding נוח; יישור RTL עקבי |

### Phase 3: עיצוב מחדש של ארנק סימולציה
| קובץ | שינויים מתוכננים |
|------|-------------------|
| `components/PnlTerminal.tsx` | היררכיה: "Total Balance" גדול ובולט; הפרדה ויזואלית: Available / Locked / Floating PnL; צבעים: רווח +$ (ירוק), הפסד -$ (אדום) |

### Phase 4: לוגיקת חישוב, דיוק ושקיפות
| קובץ | שינויים מתוכננים |
|------|-------------------|
| `lib/decimal.ts` | ביקורת עיגולים; פונקציות תבנית לפורמט מטבע (2 עשרוניות) וקריפטו (דינמי) |
| `app/api/ops/metrics/pnl/route.ts` | ביקורת PnL ו־fees; עקביות round2 |
| `components/PnlTerminal.tsx` | Tooltips על רווח נקי עם פירוט (Entry - Exit - Fees) |
| `app/api/simulation/summary/route.ts` | עקביות חישוב wallet ו־unrealized PnL |

### Phase 5: דיבוג מנוע הסורק (באג קריטי)
| קובץ | שינויים מתוכננים |
|------|-------------------|
| `app/api/cron/scan/route.ts` | וידוא שהסריקה רצה; עדכון last_scan_timestamp גם כשנכשל (heartbeat); לוגים ברורים |
| `lib/workers/market-scanner.ts` | סנכרון state עם DB; טיפול בשגיאות שקטות; וידוא ש־runOneCycle מעדכן timestamp |
| `app/api/settings/scanner/route.ts` | החזרת סטטוס "אמיתי": סורק מופעל בהגדרות vs. סריקה אחרונה בוצעה |
| `vercel.json` | וידוא/הוספת Cron ל־`/api/cron/scan` כל 20 דקות |
| `instrumentation.ts` | הערה/הסרה: ב־Vercel Serverless אין process מתמשך — הסריקה תתבצע רק דרך Cron |

---

## ארכיטקטורה מזוהה

- **Framework:** Next.js (App Router)
- **מרכיבי UI:** `MainDashboard`, `ScannerControlPanel`, `SettingsTelegramCard`, `PnlTerminal`, `TelegramStatus`, `DashboardCard`
- **טבלאות:** `PnlTerminal.tsx` (עסקאות PnL + סימולציה), `app/ops/strategies/page.tsx`
- **Utilities:** `lib/decimal.ts`, פורמטינג ב־`ScannerControlPanel` (formatRelativeTime), `settings/page.tsx` (formatDateTime)
- **Backend סורק:** `lib/workers/market-scanner.ts`, `app/api/cron/scan/route.ts`, `app/api/settings/scanner/route.ts`, `lib/db/system-settings.ts`, `app/actions.ts` (getScannerStatus)
- **סיבה אפשרית לבאג:** ב־Vercel אין process ארוך טווח; `startMarketScanner()` ב־instrumentation לא מחזיק setInterval. הסריקה חייבת לרוץ דרך **Vercel Cron**; אם Cron לא מוגדר או לא נקרא — "סריקה אחרונה" לא מתעדכנת.
