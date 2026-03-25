# דוח ארכיטקטורת God-Mode — שדרוג פלטפורמת Smart Money AI

**תאריך:** מרץ 2025  
**גרסה:** 1.0  
**סטטוס:** הושלם — שדרוג ארכיטקטוני מלא לסוכני MoE, ארנק סימולציה, לוח בקרה מתקדם ומרכז למידה עם פוסט-מורטם מובנה.

---

## 1. סיכום מנהלים

נערך שדרוג "God-Mode" מלא לפלטפורמה: העמקת הידע הקריפטו-נייטיבי בכל ארבעת סוכני ה-MoE, שדרוג ארנק הסימולציה והרובוט עם מדדי Win Rate / Max Drawdown / תשואה ממוצעת לעסקה, לוח בקרה מתקדם (סובלנות סיכון ומשקלי MoE דינמיים), ומרכז למידה עם נתוני פוסט-מורטם איכותיים — "למה העסקה ניצחה/הפסידה" ו"איזה סוכן צדק/טעה" — במבנה התומך ב-RAG (Retrieval-Augmented Generation) להזנת הקשר חזרה לפרומפטים של המומחים.

---

## 2. Phase 1: העמקת מומחיות קריפטו וסינרגיית MoE

### 2.1 סוכן טכני (The Technician)

- **נוספו לפרומפט ולתשומות אופציונליות:** ניתוח **Open Interest**, **Funding Rates**, ו-**Liquidity Grabs / Sweeps**.
- הסוכן מתבקש לנתח: עליית OI עם מחיר = אימות; דיברגנציה OI/מחיר = אזהרה; פונדינג חיובי גבוה בשורט = סיכון סקוויז; שלילי = לונגים ממומנים; זיהוי sweep מתחת לתמיכה או מעל התנגדות לפני היפוך (stop hunt).
- שדות אופציונליים ב-`ConsensusEngineInput`: `open_interest_signal`, `funding_rate_signal`, `liquidity_sweep_context`.

### 2.2 סוכן סיכונים (The Risk Manager)

- **ניתוח תנודתיות דינמי (ATR):** ATR% גבוה → הרחבת SL/TP בהתאם; תנודתיות קיצונית ללא הצדקה → הורדת ציון.
- **Slippage ו-Spread:** חובה לקחת בחשבון החלקה ועמלות; נזילות רדודה או spread רחב → ציון נמוך.
- **R:R גמיש לפי רמת סובלנות (God-Mode):** סטריקט 1:3, ממוצע 1:2, אגרסיבי 1:1.5 — נשלט מלוח הבקרה.

### 2.3 סוכן פסיכולוג שוק (The Market Psychologist)

- **נוספו:** שינויי מדדים **on-chain** (למשל exchange netflows), ו-**Social dominance volume** (נפח/דומיננטיות בסושיאל).
- פרומפט מורחב: זיהוי דיברגנציות on-chain, הייפ מוחלט בסושיאל מול שקט, והתאמה ל-setups קונטראריים.

### 2.4 סוכן מקרו (Groq)

- **הועמקו:** **USDT Dominance** (עלייה = risk-off, ירידה = נזילות לקריפטו), **ETF flows** (זרימות נטו ל-BTC/ETH ETFs), ו-**DXY inverse correlation** (דולר חזק = שלילי לקריפטו, דולר חלש = רוח גבית).
- שדה אופציונלי: `macro_context` להזנת הקשר מקרו לפרומפט.

### 2.5 השופט (Overseer)

- סינתוז מדדים מתקדמים לתובנת על (master_insight_he): OI/Funding/Sweeps, תנודתיות, on-chain/סושיאל, מקרו/ETF/DXY — והכל נכנס לחישוב ה-Gem Score באמצעות משקלים (כולל override מלוח הבקרה).

---

## 3. Phase 2: שדרוג ארנק הסימולציה והרובוט

### 3.1 לוגיקת סימולציה (`/api/simulation/summary`)

- **זיווג עסקאות (round-trips):** מכלול העסקאות ממוין לפי זמן; לכל סמל מזווגים קנייה ומכירה (FIFO) לחישוב סבבים סגורים.
- **מדדים חדשים:**
  - **אחוז הצלחה (Win Rate):** אחוז הסבבים עם רווח חיובי.
  - **שפל מקסימלי (Max Drawdown):** חישוב עקומת יתרה אחרי כל עסקה; שפל מקסימלי כאחוז משיא.
  - **תשואה ממוצעת לעסקה (Avg ROI per trade):** ממוצע תשואה באחוזים לכל סבב סגור.
- התשובה כוללת: `simulationWinRatePct`, `simulationMaxDrawdownPct`, `simulationAvgRoiPerTradePct`, `simulationRoundTripsCount`.

### 3.2 תצוגה ב-PnlTerminal

- נוספו שלושה כרטיסים (וידג'טים) בבלוק "תחנת מסחר — סימולציה":
  - **אחוז הצלחה (סימולציה)** + מספר סבבים.
  - **שפל מקסימלי (סימולציה)** באחוזים.
  - **תשואה ממוצעת לעסקה** באחוזים (צבע ירוק/אדום לפי חיובי/שלילי).
- הכרטיסים מוצגים רק כאשר יש לפחות סבב אחד (`simulationRoundTripsCount > 0`).

---

## 4. Phase 3: לוח בקרה מתקדם (Admin Dashboard)

### 4.1 רמת סובלנות סיכון (Risk Tolerance)

- **מיקום:** הגדרות → ניהול סיכונים.
- **אפשרויות:** סטריקט (1:3 R:R), ממוצע (1:2), אגרסיבי (1:1.5).
- **אחסון:** `risk.riskToleranceLevel` בטבלת `settings` (מפתח `app_settings`).
- **שימוש:** מנוע הקונצנזוס קורא את הערך ומזין את דרישת ה-R:R המינימלית לפרומפט של סוכן הסיכונים.

### 4.2 משקלי MoE (MoE Weights Override)

- **מיקום:** הגדרות → בינה מלאכותית.
- **ממשק:** ארבעה שדות (טכני, סיכון, פסיכ, מקרו) באחוזים; סכום מומלץ 100. דוגמה: "שבוע חדשות — העלאת מקרו."
- **אחסון:** `neural.moeWeightsOverride` כ-`{ tech, risk, psych, macro }` בערכים 0–1 (נורמליזציה אוטומטית בשמירה).
- **שימוש:** במנוע הקונצנזוס — אם מוגדר override תקף, חישוב ה-Gem Score (final_confidence) משתמש במשקלים הללו במקום 30/30/20/20. במקרה של כישלון Groq (מקרו), המשקלים מנורמלים לשלושת הסוכנים הנותרים.

---

## 5. Phase 4: לולאת למידה רציפה (מרכז למידה + פוסט-מורטם)

### 5.1 מבנה נתונים איכותי

- **טבלת `agent_insights`:**
  - עמודות חדשות: **`why_win_lose`** (TEXT), **`agent_verdict`** (TEXT).
- **why_win_lose:** טקסט מובנה — "למה העסקה ניצחה/הפסידה" (למשל: הגעה ל-TP, פגיעה ב-SL עם אזכור RSI, ניקוי, סגירה ידנית).
- **agent_verdict:** "איזה סוכן צדק/טעה" — כאשר קיימים ציוני MoE בפתיחת העסקה (עתיד: שמירה ב-`virtual_portfolio`), ניתן להפיק משפטים כמו "טכני צדק, סיכון טעה." כרגע: כאשר אין ציונים — "לא נשמרו ציוני MoE… מומלץ לפתוח מהאנליזר עם שמירת ציונים."

### 5.2 יצירת פוסט-מורטם בסגירת עסקה

- **זרימה:** בסגירת עסקה וירטואלית (TP, SL, ניקוי, ידני) — `runPostMortemWithTimeout` → `runPostMortemForClosedTrade`.
- **חישוב:** פונקציות `buildWhyWinLose` ו-`buildAgentVerdict` ב-`lib/smart-agent.ts` מפיקות את הטקסטים המובנים; `insertAgentInsight` שומר גם `why_win_lose` ו-`agent_verdict`.

### 5.3 RAG — הזנת ההקשר חזרה ל-MoE

- **זיכרון עמוק (Deep Memory):** ב-`getDeepMemoryContext` ב-`lib/consensus-engine.ts` — בנוסף לשיעור הצלחה ונקודות כישלון, נוסף בלוק "תחקירי פוסט-מורטם (RAG)":
  - עד 3 תובנות אחרונות עם `why_win_lose` או `agent_verdict` מפורשים.
  - הטקסט משולב להקשר שנשלח למומחים כדי להימנע מחזרה על טעויות ולשפר החלטות.

### 5.4 תצוגה במרכז הלמידה (AgentLearningCenter)

- לכל תובנה: כאשר קיימים `why_win_lose` או `agent_verdict`, מוצגים מתחת לתוכן הראשי תחת כותרות "למה ניצח/הפסיד" ו"איזה סוכן צדק/טעה".

---

## 6. קבצים שעודכנו (מצרף)

| קובץ | שינויים עיקריים |
|------|------------------|
| `lib/consensus-engine.ts` | פרומפטים מורחבים לכל 4 הסוכנים + שופט; שדות אופציונליים; משקלים דינמיים ו-riskToleranceLevel; Deep Memory עם פוסט-מורטם RAG |
| `lib/db/app-settings.ts` | riskToleranceLevel, moeWeightsOverride ב-neural |
| `app/api/simulation/summary/route.ts` | חישוב round-trips, Win Rate, Max Drawdown, Avg ROI, ספירת סבבים |
| `components/PnlTerminal.tsx` | טיפוס SimulationSummary מורחב; 3 כרטיסים לסימולציה |
| `components/SettingsCommandCenter.tsx` | רמת סובלנות סיכון (select); משקלי MoE (4 שדות); נורמליזציה בשמירה |
| `lib/db/agent-insights.ts` | עמודות why_win_lose, agent_verdict; INSERT ו-SELECT מורחבים |
| `lib/smart-agent.ts` | buildWhyWinLose, buildAgentVerdict; runPostMortemForClosedTrade שומר why_win_lose + agent_verdict; Pending Insight מעודכן |
| `components/AgentLearningCenter.tsx` | AgentInsightItem עם why_win_lose, agent_verdict; תצוגה בממשק |

---

## 7. המשך מומלץ

- **virtual_portfolio:** הוספת עמודות אופציונליות `prediction_id`, `tech_score`, `risk_score`, `psych_score`, `macro_score` ושליחתן מ-`POST /api/portfolio/virtual` כאשר הפתיחה מגיעה מהאנליזר (עם ציוני קונצנזוס) — כדי להעשיר את `agent_verdict` בפוסט-מורטם.
- **מקורות נתונים:** חיבור מקורות אמיתיים ל-Open Interest, Funding Rates, ולבחירה — USDT dominance, ETF flows, DXY — להזנת השדות האופציונליים ב-`ConsensusEngineInput` ולשפר את איכות הניתוח.

---

*דוח זה מסכם את שדרוג ה-God-Mode לארכיטקטורת הפלטפורמה. כל השינויים תואמים את דרישות המנמ"ר: העמקת מומחיות קריפטו ב-MoE, מדדי סימולציה מתקדמים, לוח בקרה עם מתגים מתקדמים, ומרכז למידה עם פוסט-מורטם מובנה ל-RAG ו-Self-Reflective AI.*
