# פריסה ל־LiveDNS — www.moncherigroup.co.il

הנחיות בעברית לחיבור הדומיין **www.moncherigroup.co.il** לשרת האירוח (VPS / Cloud / Node) באמצעות פאנל LiveDNS.

---

## דרישות מקדימות

- גישה לפאנל **LiveDNS** (או לפאנל ניהול ה-DNS של רשם הדומיין).
- שרת שאליו אתם מפריסים את האפליקציה (כתובת IP או שרת עם CNAME).
- האפליקציה רצה ב-production (למשל `npm run build && npm run start` או שרת Node/PM2).

---

## שלב 1: קבלת כתובת השרת

1. **אם יש לכם שרת עם IP קבוע**  
   רישמו את כתובת ה-IP (למשל `185.xxx.xxx.xxx`).

2. **אם אתם משתמשים בשירות אירוח (למשל Cloud Run, Vercel, Render)**  
   בדרך כלל תקבלו:
   - **CNAME** (למשל `your-app.run.app` או `your-app.vercel.app`), או  
   - **A Record** אם השירות מספק כתובת IP.

---

## שלב 2: כניסה ל־LiveDNS

1. היכנסו לאתר רשם הדומיין (למשל One.com, LiveDNS, או הרשם שבו נרשם הדומיין).
2. מצאו את האפשרות **ניהול דומיין** / **DNS** / **LiveDNS**.
3. בחרו את הדומיין **moncherigroup.co.il** (או את הדומיין הרלוונטי).

---

## שלב 3: עדכון רשומות A (כתובת IP)

מטרה: לחבר את **www.moncherigroup.co.il** (ותת-דומיין www) לכתובת ה-IP של השרת.

1. ברשימת הרשומות, חפשו רשומת **A** עבור **www** (או הוסיפו רשומה חדשה).
2. **שם / Host:**
   - הזינו `www` (או את התת-דומיין המתאים).
   - בחלק מהפאנלים זה יופיע כ־`www.moncherigroup.co.il` או כ־"Host" = `www`.
3. **ערך / Value / Points to:**
   - הזינו את **כתובת ה-IP** של השרת (למשל `185.xxx.xxx.xxx`).
4. **TTL:**  
   השאירו ברירת מחדל (למשל 3600 או 300) או הפחיתו ל־300 אם אתם משנים הרבה.
5. שמרו את השינויים.

**דוגמה:**

| סוג   | Host | ערך           | TTL  |
|------|------|----------------|------|
| A    | www  | 185.xxx.xxx.xxx | 3600 |

---

## שלב 4: עדכון רשומת CNAME (אם השרת הוא שם ולא IP)

אם ספק האירוח נתן לכם **שם שרת** (למשל `app.run.app` או `myapp.vercel.app`):

1. הוסיפו או ערכו רשומת **CNAME**.
2. **Host:**  
   `www` (כדי ש־www.moncherigroup.co.il יצביע לשם השרת).
3. **Value / Target / Points to:**  
   את שם השרת שקיבלתם (למשל `your-service.run.app`).  
   **ללא** `https://` ו**בלי** סלאש בסוף.
4. שמרו.

**דוגמה:**

| סוג  | Host | ערך                    | TTL  |
|------|------|-------------------------|------|
| CNAME| www  | your-app.run.app        | 3600 |

---

## שלב 5: דומיין שורש (moncherigroup.co.il בלי www)

אם תרצו שגם **moncherigroup.co.il** (בלי www) יופנה לאפליקציה:

- **אפשרות א' — A Record:**  
  הוסיפו רשומת **A** עם Host ריק או `@`, וערך = אותו IP של השרת.
- **אפשרות ב' — CNAME / Redirect:**  
  בחלק מהפאנלים יש "Redirect" או "URL Redirect": הפנו את `moncherigroup.co.il` ל־`https://www.moncherigroup.co.il`.

---

## שלב 6: SSL (HTTPS)

כדי ש־**https://www.moncherigroup.co.il** יעבוד:

1. **אם השרת מאחורי reverse proxy (Nginx, Caddy):**  
   התקינו אישור SSL (למשל Let's Encrypt) על ה־proxy.
2. **אם אתם על Vercel/Cloud Run וכו':**  
   בדרך כלל HTTPS מופעל אוטומטית אחרי שה-CNAME מצביע נכון.

אחרי עדכון ה-DNS חכו כמה דקות עד כ־48 שעות (תלוי ב-TTL) ובדקו:

- `https://www.moncherigroup.co.il`  
- דף הכניסה: `https://www.moncherigroup.co.il/login`  
- דשבורד Ops (אחרי התחברות): `https://www.moncherigroup.co.il/ops`

---

## סיכום — מה לעשות ב־LiveDNS

| מטרה                         | סוג רשומה | Host | ערך              |
|------------------------------|-----------|------|------------------|
| www מצביע לשרת (IP)         | A         | www  | 185.xxx.xxx.xxx  |
| www מצביע לשרת (שם)         | CNAME     | www  | your-app.run.app |
| דומיין שורש מצביע לאותו שרת | A         | @    | 185.xxx.xxx.xxx  |

אחרי השמירה ב־LiveDNS, המתינו ל־propagation ובדקו את האתר והדף `/login` בדפדפן.

---

## אימות סופי — מוכנות למבקרים

לאחר הפריסה ל־www.moncherigroup.co.il:

1. **התחברות:** גלשו ל־`https://www.moncherigroup.co.il/login`, הזינו את הסיסמה (משתנה `ADMIN_LOGIN_PASSWORD`) ולחצו "Secure Login".
2. **דשבורד Ops:** וודאו גישה ל־`/ops` ו־`/ops/pnl` אחרי ההתחברות.
3. **תחזית ראשונה:** הרצת תחזית BTC פעם אחת (מדף האנליזר או מכפתור "Run BTC Simulation" ב־Ops) מוודאת שהמסד והקבצים מוכנים לתצוגה הציבורית הראשונה.
