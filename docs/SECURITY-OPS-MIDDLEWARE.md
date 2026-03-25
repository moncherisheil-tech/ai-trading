# אבטחת מסלול /ops – Middleware ו-Defense in Depth

## מה בוצע

### 1. Middleware (`middleware.ts`)

- **Matcher:** רק `/ops` ו־`/ops/:path*` — המידלוור רץ רק על גישה ישירה ל־/ops ולכל תת-מסלול.
- **לוגיקה:** אם המסלול מתחיל ב־`/ops` ואין עוגיית `app_auth_token` (או שהיא ריקה), מתבצעת **הפניה מוחלטת** ל־`/login?from=<pathname>`.
- **אין אימות חתימה ב-Edge:** המידלוור בודק רק נוכחות עוגיה (ביצועים, תאימות ל-Edge). אימות הטוקן והתפקיד (admin) מתבצע בצד השרת ב־layout.

### 2. Defense in Depth – אימות בצד שרת (`app/ops/layout.tsx`)

- **בתחילת ה-layout:** אם `isSessionEnabled()` מופעל — קוראים את `app_auth_token` מ־cookies, מריצים `verifySessionToken` ו־`hasRequiredRole(session.role, 'admin')`.
- אם אין סשן תקף או שהתפקיד לא admin — `redirect('/login?from=/ops')`.
- כך גם אם מישהו עוקף את המידלוור (למשל עוגיה מזויפת), השרת לא ירנדר את דפי ה־/ops.

### 3. לוגין וניהול סשן

- **הגדרה:** הלוגין (ב־`app/actions.ts` – `loginWithPassword`) מגדיר עוגיה `app_auth_token` (HTTP-only, secure ב-production, sameSite: lax).
- **ערך:** טוקן חתום (HMAC) שנוצר ב־`createSessionToken('admin')` ומוגדר ב־`lib/session.ts`. המידלוור קורא את אותה עוגיה.

## איך זה עובד בפועל

1. **גישה ישירה ל־/ops או /ops/strategies וכו' ללא לוגין:**  
   המידלוור רואה שאין `app_auth_token` → מפנה ל־`/login?from=/ops` (או מהמסלול המלא). המשתמש לא רואה את דשבורד האופס.

2. **אחרי לוגין:**  
   הדפדפן שומר את `app_auth_token`. בכניסה ל־/ops המידלוור רואה עוגיה → מעביר לבקשה. ה-layout מריץ `verifySessionToken` + `hasRequiredRole` → אם הכל תקין, הדשבורד נטען.

3. **ניסיון לעקוף (למשל עוגיה מזויפת):**  
   גם אם המידלוור לא חוסם, ה-layout יזהה טוקן לא תקף או תפקיד לא admin ויבצע `redirect('/login?from=/ops')`.

## אימות

- **מקומי:** הרץ את האפליקציה, גלוש ישירות ל־`http://localhost:3000/ops` — תופנה ל־`/login?from=/ops`. אחרי התחברות מוצלחת, גישה ל־`/ops` תעבוד.
- **Production:** אותו התנהגות — גישה ישירה ל־`/ops` ללא עוגיה תגרום להפניה ל־דף הלוגין.
