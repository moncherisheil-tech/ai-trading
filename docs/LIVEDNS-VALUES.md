# LiveDNS — ערכי A ו-CNAME לפריסת Vercel (Dennis)

הערכים הבאים להעתקה ישירה לפאנל **LiveDNS** עבור דומיין **www.moncherigroup.co.il** בפריסה סטנדרטית ב-**Vercel**.

---

## רשומת A (דומיין שורש — moncherigroup.co.il)

| שדה | ערך להעתקה |
|-----|-------------|
| **סוג (Type)** | A |
| **שם / Host** | `@` (או ריק — דומיין שורש) |
| **ערך / Value / Points to** | `76.76.21.21` |
| **TTL** | `3600` (או ברירת מחדל) |

---

## רשומת CNAME (תת-דומיין www — www.moncherigroup.co.il)

| שדה | ערך להעתקה |
|-----|-------------|
| **סוג (Type)** | CNAME |
| **שם / Host** | `www` |
| **ערך / Value / Target** | `cname.vercel-dns.com` |
| **TTL** | `3600` (או ברירת מחדל) |

---

## סיכום להעתקה מהירה

```
Type:   A
Host:   @
Value:  76.76.21.21

Type:   CNAME
Host:   www
Value:  cname.vercel-dns.com
```

---

## אחרי הוספת הרשומות ב-LiveDNS

1. ב-**Vercel** → הפרויקט → **Settings** → **Domains**: הוסיפו את הדומיין `moncherigroup.co.il` ואת `www.moncherigroup.co.il`.
2. Vercel יאמת את הרשומות; לאחר ה-propagation (עד 48 שעות, לרוב דקות) האתר יהיה זמין ב־`https://www.moncherigroup.co.il`.
3. וודאו ש־**APP_URL** ב-Vercel Environment Variables מוגדר ל־`https://www.moncherigroup.co.il`.

---

## העדכון ב-LiveDNS עכשיו (לדניס)

**מה להזין בדיוק:**

1. **רשומת A (דומיין ראשי)**  
   - סוג: **A**  
   - שם: **@** (או להשאיר ריק אם הפאנל מבקש "דומיין שורש")  
   - ערך: **76.76.21.21**  
   - TTL: **3600**

2. **רשומת CNAME (www)**  
   - סוג: **CNAME**  
   - שם: **www**  
   - ערך: **cname.vercel-dns.com**  
   - TTL: **3600**

אחרי שמירה, המתינו כמה דקות ובדקו: `https://www.moncherigroup.co.il` ו־`https://www.moncherigroup.co.il/login`.
