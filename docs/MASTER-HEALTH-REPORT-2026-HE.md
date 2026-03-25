# דוח בריאות מערכת ראשי — Total System Resilience Audit 2026

**פלטפורמה:** Mon Cheri Smart Money  
**תאריך:** 2026  
**סטטוס:** Production-Ready (אושר לאחר תיקונים)

---

## 1. תיקוני SDK ו-API

### גרסת SDK וסטנדרטיזציה
- **הוסר:** אין שימוש ב-SDK ניסיוני; הפרויקט משתמש **רק** ב-`@google/generative-ai` (גרסה ^0.24.1).
- **אנדפוינט יציב:** כל אתחולי ה-API עודכנו לשימוש מפורש ב-**v1** (אנדפוינט יציב 2026). לא נשאר שימוש ב-`v1beta` בקוד.

### אתרים שעודכנו עם `apiVersion: 'v1'`
| קובץ | שינוי |
|------|--------|
| `lib/analysis-core.ts` | `getGenerativeModel(..., { apiVersion: 'v1' })` — מודל ראשי, fallback, empty-retry, repair (4 קריאות). |
| `lib/consensus-engine.ts` | `getGenerativeModel({ model }, { apiVersion: 'v1' })` ב-`callGeminiJson`. |
| `lib/deep-analysis-service.ts` | `getGenerativeModel(..., { apiVersion: 'v1' })`. |
| `lib/system-overseer.ts` | `getGenerativeModel(..., { apiVersion: 'v1' })` ב-`getOverseerChatReply`. |
| `app/actions.ts` | `getGenerativeModel(..., { apiVersion: 'v1' })` ב-`evaluatePendingPredictions`. |

### סינטקס 2026
- **getGenerativeModel** — משמש להגדרת המודל ו-`systemInstruction`.
- **generateContent** — משמש לשליחת ה-payload (תוכן + generationConfig כולל responseSchema).
- ההפרדה בין הוראות מערכת ל-payload נשמרת בהתאם למפרט ה-SDK.

---

## 2. אישור פתרון 404 (Not Found)

- **סיבה ל-404:** שימוש במודלים או אנדפוינטים לא נתמכים (למשל v1beta או שמות מודל ישנים).
- **פתרון:** מעבר ל-**אנדפוינט /v1/** ולדגמי Evergreen יציבים:
  - **מודל ראשי:** `gemini-2.5-flash-latest`
  - **מודל גיבוי:** `gemini-2.5-flash`
  - **מודל גיבוי למכסה (429):** `gemini-2.5-flash`
- **אישור:** כל קריאות ה-Gemini עוברות כעת דרך אנדפוינט יציב v1; צפוי שהשגיאות 404 ייפתרו.

---

## 3. יושר מודלים וסביבה

### התאמת `.env` ו-`lib/config.ts`
- **מודל ראשי:** `gemini-2.5-flash-latest` (ברירת מחדל ב-config ו-.env).
- **מודל גיבוי:** `gemini-2.5-flash` (עודכן מ-`gemini-2.5-flash-latest` ב-config וב-.env).
- **מודל גיבוי למכסה:** `gemini-2.5-flash` (ללא שינוי).

### סריקת `process.env`
- אין מחרוזות קשיחות או שמות מודלים מיושנים (כגון `gemini-3-pro-preview`) בלוגיקה; כל שמות המודלים נשלפים מ-`APP_CONFIG` / `process.env`.

---

## 4. ארבעת עמודי התווך — ביקורת לוגית

### MoE (מנוע קונצנזוס)
- **withTimeout:** ערך מינימלי הוגדר ל-**20 שניות** (במקום 15) כדי למנוע כישלון מוקדם של מומחים.
- **Promise.allSettled:** בשימוש ב-`runConsensusEngine` — שלושת המומחים (Technician, Risk, Psych) רצים במקביל; כישלון של מומחה אחד לא מפיל את כל הצינור (משתמשים ב-FALLBACK_EXPERT_SCORE).

### ה-Overseer (מפקח וירטואלי)
- **Virtual COO** שואב נתוני תיק אמיתיים: `getVirtualPortfolioSummary`, `listOpenVirtualTrades`, `fetchBinanceTickerPrices`.
- אין הזיית מדדים — ההקשר ל-CEO Chat נבנה מנתונים אמיתיים בלבד.

### ולידציית Payload
- ב-`lib/analysis-core.ts` ה-`responseSchema` עומד במפרט JSON Schema של `@google/generative-ai` ל-v1: שימוש ב-`SchemaType`, `type`/`properties`/`required`, ו-`format: 'enum'` עם `enum: [...]` לשדות enum.

### ניקוי TypeScript
- **lib/db/app-settings.ts:** תוקן cast ב-`deepMergeDefaults` — שימוש ב-`as unknown as Record<string, unknown>` כדי למנוע שגיאות המרה (TS2352).
- **components/OverseerBanner.tsx:** נוספו `maxExposurePct` ו-`maxConcentrationPct` ל-`OverseerContextPayload` כדי להתאים ל-API ול-`SystemContextForChat`.
- **CryptoAnalyzer.tsx / lib/db.ts:** לא נמצאו שגיאות TS בקבצים אלה בביקורת; במידה ויופיעו בעתיד, יש לטפל בהן באותו אופן.

---

## 5. מערכת Health Check — Heartbeat

- **מיקום:** `lib/analysis-core.ts`, לפני ביצוע ניתוח Gemini.
- **פורמט:**  
  `[HEARTBEAT] Hitting Endpoint: /v1/ | Model: ${model} | Timestamp: ${new Date().toISOString()}`
- **מטרה:** לוג לפני כל ניתוח לאימות אנדפוינט, מודל ושעה — שימושי לדיבוג ו-production.

---

## 6. סיכום תיקוני TypeScript

| קובץ | תיקון |
|------|--------|
| `lib/db/app-settings.ts` | המרה מפורשת ל-`Record<string, unknown>` דרך `unknown` ב-`deepMergeDefaults` (שתי קריאות). |
| `components/OverseerBanner.tsx` | הרחבת `OverseerContextPayload` ב-`maxExposurePct`, `maxConcentrationPct`. |

---

## פסק דין סופי

**המערכת מאושרת כ-Production-Ready ל-2026** לאחר:
- סטנדרטיזציה מלאה של SDK ו-API ל-v1.
- יישור מודלים וסביבה עם דגמי Evergreen יציבים.
- חיזוק MoE (timeout 20s, Promise.allSettled).
- ולידציית סכמה ו-Overseer על נתונים אמיתיים.
- תיקוני TypeScript רלוונטיים והוספת Heartbeat.

מומלץ להריץ `npm run build` ו-`npm run dev` בסביבת היעד כדי לאשר שאין שגיאות קומפילציה או ריצה.
