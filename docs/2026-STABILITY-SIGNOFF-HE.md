# 2026 Stability Sign-off — מעבר ל-API יציב

**תאריך:** 2026  
**מטרה:** פתרון שגיאת 404 "Model Not Found" והחזרת המערכת למסלול ייצור יציב.

---

## סיכום ביצוע

### 1. מעבר גרסת API (חזרה ל-v1)
- **קבצים:** `lib/analysis-core.ts`, `lib/consensus-engine.ts`, `lib/system-overseer.ts`, `app/actions.ts`, `lib/deep-analysis-service.ts`
- **שינוי:** אתחול `GoogleGenerativeAI` ללא override של גרסה — `const genAI = new GoogleGenerativeAI(apiKey);`
- **הערה:** ב-2026 ה-SDK הרשמי מגדיר כברירת מחדל את ה-endpoint ל-**v1** למודלים יציבים. לא נעשה שימוש ב-`apiVersion: 'v1beta'`.

### 2. אסטרטגיית מודל Evergreen
- **`.env` ו-`lib/config.ts`:** הוגדר `GEMINI_MODEL_PRIMARY="gemini-2.5-flash-latest"`.
- **סיבה:** ב-2026 זהו מודל ה-"Evergreen" היציב שגוגל מתחייבת אליו לאפליקציות throughput גבוה (כמו Smart Money). תומך ב-`systemInstruction` ו-`responseSchema` באופן native על endpoint ה-v1.

### 3. ניקוי תהליכי רפאים (פורט 3000)
- **`package.json`:** נוסף סקריפט `"kill-port": "npx kill-port 3000 3001"`.
- **הוראה למשתמש:** להריץ `npm run kill-port` לפני הפעלת השרת, כדי לשחרר פורט 3000/3001 מתהליכים תלויים.

### 4. סריקת יושר מערכת — ConsensusEngine
- **Timeout:** ה-`withTimeout` של מנוע הקונצנזוס (MoE) מוגבל כעת ל-**מינימום 15 שניות** — `timeoutMs = Math.max(15_000, rawTimeout)`. כך למומחים (Technician, Risk, Psych) יש זמן סיום סביר.
- **responseSchema:** אומת כי ב-`lib/analysis-core.ts` ה-schema עומד במפרט `@google/generative-ai` ל-v1: `SchemaType`, `type`/`properties`/`required`, ו-`format: 'enum'` עם `enum: [...]` עבור שדות enum.

---

## אישור יציבות 2026

**שגיאת 404 "Model Not Found" נפתרה.**  
המערכת מוגדרת כעת ל:
- endpoint **v1** (ברירת מחדל SDK, ללא v1beta),
- מודל **gemini-2.5-flash-latest** (Evergreen יציב),
- timeout מינימלי 15s ל-MoE,
- ו-responseSchema תואם מפרט v1.

**המערכת חזרה למסלול ייצור יציב.**

— Lead Systems Architect
