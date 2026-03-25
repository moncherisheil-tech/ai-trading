# אימות בנייה (Build Verification)

## תיקון שבוצע בקוד

- **`app/actions.ts`**: הוסר ה-export של הקבוע `ERROR_451_MESSAGE` — בקובץ עם `'use server'` מותר לייצא רק פונקציות אסינכרוניות (Server Actions). הקבוע נשאר לשימוש פנימי בלבד.

## בנייה מקומית (Windows)

בסביבת Windows עלולות להופיע:

1. **lightningcss / @next/swc** — מודולים עם קבצי `.node` (native). אם מופיעה שגיאה כמו `lightningcss.win32-x64-msvc.node` או `next-swc.win32-x64-msvc.node is not a valid Win32 application`:
   - לרוב מדובר בהתקנה פגומה או העתקת פרויקט. נסה:
   - `Remove-Item -Recurse -Force node_modules; npm install`
   - או התקנת [Windows Build Tools](https://github.com/nodejs/node-gyp#on-windows) (Visual Studio עם "Desktop development with C++" + Windows SDK).

2. **better-sqlite3** — דורש קומפילציה מקומית (node-gyp). אם אין Visual Studio עם C++:
   - התקנה עם `npm install --ignore-scripts` (מדלג על בניית native), או
   - שימוש ב־`DB_DRIVER=postgres` + `DATABASE_URL` בלי SQLite מקומי.

3. **react-redux / immer** — נדרשים ל-Recharts. הם מופיעים ב-`package.json`. אם ה-build מדווח "Module not found":
   - הרץ `npm install` עד סיום (אם better-sqlite3 נכשל, נסה `npm install --ignore-scripts` מתוך תיקיית הפרויקט).

## בנייה ב-Vercel (מומלץ לאימות)

ב-Vercel (Linux) אין את בעיות ה-native של Windows:

- SWC ו-lightningcss רצים עם בינאריות ל-Linux.
- `better-sqlite3` לא נבנה אם לא נעשה שימוש ב-SQLite (או משתמשים ב-Postgres).
- `react-redux` ו-`immer` מותקנים אוטומטית מ-`package.json`.

**לאמת שהכול מקושר ועובד:** דחוף ל-GitHub והפעל build ב-Vercel. אם ה-build עובר שם — הקוד והחיבורים תקינים.

## סיכום

| בעיה              | פתרון מקומי (Windows)              | Vercel        |
|-------------------|-------------------------------------|---------------|
| `ERROR_451_MESSAGE` export | תוקן בקוד (ללא export)            | —             |
| lightningcss/swc  | התקנה מחדש / Build Tools           | עובד          |
| react-redux/immer | `npm install` או `--ignore-scripts` | עובד          |
| better-sqlite3    | Build Tools או `--ignore-scripts`   | לא רלוונטי אם משתמשים ב-Postgres |
