# דוח קונצנזוס נוירלי וחדר דיונים — Mixture of Experts (MoE)

**תאריך:** מרץ 2025  
**גרסה:** 1.0  
**מערכת:** Smart Money AI Engine

---

## 1. סיכום מנהלים

מנוע ה-AI של Smart Money עבר שדרוג ארכיטקטוני ל-**תערובת מומחים (Mixture of Experts)** עם שכבת **חדר דיונים (Debate Room)**. שלושה מומחים מקבילים (טכני, סיכונים, פסיכולוג שוק) מנתחים כל סמל, ושופט רביעי מנסח תובנת על סופית בעברית ומחשב ציון קונצנזוס. תחזית חיובית (שורית) מאושרת רק כאשר ציון הקונצנזוס ≥ 75. זיכרון עמוק (RAG) — 3 העסקאות האחרונות בסמל — מוזרק למומחים הטכני ומנהל הסיכונים.

---

## 2. זרימת תקשורת רב-סוכנית (Multi-Agent)

### 2.1 שלב 1: הכנה וזיכרון עמוק

- **קלט:** סמל (למשל BTCUSDT), נתוני שוק (מחיר, RSI, ATR, MACD, פרופיל נפח, רמות HVN).
- **זיכרון עמוק (Deep Memory):** לפני הרצת המומחים, המערכת שואלת את טבלת `agent_insights` עבור **3 התובנות האחרונות** של אותו סמל.
- **תוצאה:** מחרוזת הקשר (עברית) הכוללת: שיעור הצלחה (אחוז), וסיכום נקודות כישלון קודמות. מוזרק למומחי **הטכנאי** ו-**מנהל הסיכונים**.

### 2.2 שלב 2: הרצה מקבילית של שלושת המומחים (MoE)

| מומחה | תפקיד | קלט עיקרי | פלט |
|--------|--------|------------|------|
| **הטכנאי (Expert 1)** | ניתוח RSI, MACD, פרופיל נפח, HVN | נתונים טכניים + הקשר זיכרון עמוק | `tech_score` (0–100), `tech_logic` (עברית) |
| **מנהל הסיכונים (Expert 2)** | ניתוח תנודתיות (ATR), קרבה ל-S/R, סיכון דרואודאון | ATR, מרחק ל-HVN, תנודתיות + זיכרון עמוק | `risk_score` (0–100), `risk_logic` (עברית) |
| **פסיכולוג השוק (Expert 3)** | השפעת טרנד BTC ומומנטום הנכס | טרנד BTC, מומנטום נכס | `psych_score` (0–100), `psych_logic` (עברית) |

- שלושת המומחים רצים ב-**מקביל** (`Promise.all`) כדי לצמצם זמן תגובה.

### 2.3 שלב 3: חדר הדיונים — השופט (Judge)

- **קלט:** שלושת הפלטים (ציונים + לוגיקה) של המומחים.
- **תפקיד השופט:** לקרוא את הדעות (מקבילות או סותרות), ליישב סתירות, ולהפיק:
  - **`master_insight_he`** — 2–3 משפטים בעברית מקצועית: הקונצנזוס וה"למה" מאחורי ההמלצה.
  - **`reasoning_path`** — משפט אחד בעברית המתאר את נתיב ההגיון להכרעה.

### 2.4 שלב 4: קונצנזוס מתמטי וסף החלטה

- **נוסחה:**  
  **Final_Confidence** = (Tech × 0.4) + (Risk × 0.4) + (Psych × 0.2)
- **כלל:** תחזית **חיובית (Bullish)** מוחזרת רק אם **Final_Confidence ≥ 75**. אחרת — אם המודל המרכזי החזיר Bullish — המערכת מורידה להמלצה **ניטרלית** ומפחיתה הסתברות (עד 55).

---

## 3. שדרוגי מסד נתונים

### 3.1 טבלת `agent_insights`

נוספו העמודות הבאות (כולן אופציונליות; migration דרך `ALTER TABLE ADD COLUMN IF NOT EXISTS`):

| עמודה | סוג | תיאור |
|--------|------|--------|
| `tech_score` | INTEGER | ציון מומחה טכני (0–100) |
| `risk_score` | INTEGER | ציון מנהל סיכונים (0–100) |
| `psych_score` | INTEGER | ציון פסיכולוג שוק (0–100) |
| `master_insight` | TEXT | תובנת העל (החלטת הדירקטוריון) בעברית |
| `reasoning_path` | TEXT | נתיב ההגיון של השופט |

- **`lib/db/agent-insights.ts`:** עדכון `AgentInsightRow`, `InsertAgentInsightInput`, פונקציות `ensureTable`, `insertAgentInsight`, ורשימות ה-SELECT כך שיכללו את העמודות החדשות.

### 3.2 רשומת חיזוי (`PredictionRecord` / `prediction_records`)

- **קובץ:** `lib/db.ts`
- **שדות חדשים ב-PredictionRecord (payload JSONB):** `tech_score`, `risk_score`, `psych_score`, `master_insight_he`, `reasoning_path` — מוזנים מתוך תוצאת ה-ConsensusEngine ב-`analysis-core` ונשמרים כ-JSONB.

---

## 4. שינויים בממשק המשתמש (UI)

### 4.1 כרטיס "קונצנזוס נוירלי — חדר דיונים" ב-`CryptoAnalyzer.tsx`

- **מיקום:** מתחת לכרטיס האסטרטגיה הטקטית (ATR + HVN), בתוך כרטיס התחזית האחרונה.
- **תוכן:**
  1. **שלושה פסי התקדמות אופקיים** עבור:
     - טכני (Tech)
     - סיכון (Risk)
     - פסיכולוגיית שוק (Psych)  
     צבעים: ירוק (≥65), amber (40–64), אדום (&lt;40).
  2. **בלוק ציטוט** עם כותרת "החלטת הדירקטוריון (AI)" — הצגת `master_insight_he` בעיצוב quote אלגנטי (גבול צד, רקע עדין).

- הכרטיס מוצג רק כאשר קיים לפחות אחד מהערכים: `tech_score`, `risk_score`, `psych_score`, או `master_insight_he`.

---

## 5. קבצים שעודכנו / נוצרו

| קובץ | שינוי |
|------|--------|
| `lib/consensus-engine.ts` | **חדש.** מנוע MoE: `getDeepMemoryContext`, `runExpertTechnician`, `runExpertRisk`, `runExpertPsych`, `runJudge`, `runConsensusEngine`, חישוב `Final_Confidence` וסף 75. |
| `lib/analysis-core.ts` | בניית קלט ל-ConsensusEngine, קריאה ל-`runConsensusEngine`, יישום שער Debate Room (הורדה ל-Neutral אם Bullish ו-Final_Confidence &lt; 75), הוספת tech/risk/psych/master_insight_he/reasoning_path ל-`PredictionRecord`. |
| `lib/smart-agent.ts` | הערת תיעוד: זיכרון עמוק נצרך על ידי ConsensusEngine. |
| `lib/deep-analysis-service.ts` | הערת תיעוד: MoE + Debate Room מנוהלים ב-consensus-engine ובערוץ analysis-core. |
| `lib/db/agent-insights.ts` | הרחבת סכמה ו-INSERT/SELECT עם tech_score, risk_score, psych_score, master_insight, reasoning_path. |
| `lib/db.ts` | הרחבת `PredictionRecord` ב-tech_score, risk_score, psych_score, master_insight_he, reasoning_path. |
| `components/CryptoAnalyzer.tsx` | כרטיס "קונצנזוס נוירלי — חדר דיונים" עם 3 פסי התקדמות ו-master_insight_he. |

---

## 6. טיפול ב-async ו-parallelism

- **מומחים:** הרצה ב-`Promise.all([runExpertTechnician(...), runExpertRisk(...), runExpertPsych(...)])`.
- **שופט:** רץ לאחר סיום שלושת המומחים, עם קלט מצטבר.
- **Timeout:** קריאות Gemini במנוע הקונצנזוס מוגבלות ל-25 שניות (או `geminiTimeoutMs` אם נמוך יותר) כדי למנוע חסימה.
- **שגיאות:** כישלון ConsensusEngine (timeout/רשת) לא מפיל את הניתוח המרכזי — התוצאה ממוזגת רק כאשר `consensusResult` לא null; אחרת התחזית נשמרת בלי שדות הקונצנזוס.

---

## 7. סיכום

מערכת Smart Money משתמשת כעת ב-**תערובת מומחים (MoE)** עם **חדר דיונים**: שלושה מומחים מקבילים, שופט המנסח תובנת על בעברית, וקונצנזוס מתמטי עם סף 75. זיכרון עמוק מ-`agent_insights` מוזרק למומחים הרלוונטיים, טבלת `agent_insights` ו-`PredictionRecord` הורחבו, וממשק המשתמש מציג את "קונצנזוס נוירלי" עם שלושה ציונים והחלטת הדירקטוריון.
