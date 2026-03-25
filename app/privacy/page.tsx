import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export const metadata = {
  title: 'מדיניות פרטיות | Mon Chéri Quant AI',
  description: 'מדיניות הפרטיות של מערכת ניתוח כמותי וסימולציה — Smart Money, קבוצת Mon Chéri',
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#050505] text-zinc-100" dir="rtl">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-amber-500 transition-colors mb-8 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 rounded"
        >
          <ArrowRight className="w-4 h-4 rtl:scale-x-[-1]" aria-hidden />
          חזרה לדף הבית
        </Link>

        <article
          className="prose prose-invert prose-lg max-w-none space-y-8 text-right text-zinc-300 leading-relaxed prose-headings:text-white prose-p:leading-relaxed prose-li:leading-relaxed"
          style={{ fontFamily: 'system-ui, sans-serif' }}
        >
          <header className="border-b border-white/10 pb-6">
            <h1 className="text-3xl font-bold text-white mb-2">מדיניות פרטיות</h1>
            <p className="text-sm text-zinc-500">
              עדכון אחרון: מרץ 2025 · Smart Money, קבוצת Mon Chéri
            </p>
          </header>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-white">1. כללי</h2>
            <p>
              Smart Money (חלק מקבוצת Mon Chéri) מכבדת את פרטיות המשתמשים. מדיניות זו מתארת אילו נתונים נאספים, כיצד הם משמשים ואיך הם נשמרים במסגרת מערכת הניתוח הכמותי והסימולציה.
            </p>
            <p className="text-amber-200/90 text-sm font-medium">
              תזכורת: המערכת מיועדת למטרות לימוד וסימולציה בלבד. מסחר כרוך בסיכון גבוה ואין לראות במידע כאן ייעוץ השקעות.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-white">2. נתונים שאנו אוספים</h2>
            <p>בהתאם לשימוש בשירות, אנו עשויים לאסוף או לעבד:</p>
            <ul className="list-disc list-inside space-y-2 pr-4">
              <li><strong className="text-zinc-200">מזהה Telegram (Telegram ID):</strong> משמש לצורך שליחת התראות והתייחסות להמלצות סריקה שהמשתמש בחר לקבל. המזהה נשמר במערכת רק לצורך קישור בין החשבון במערכת לבין חשבון ה‑Telegram.</li>
              <li><strong className="text-zinc-200">נתוני גישה (Session):</strong> כגון כתובת IP וסוג דפדפן, לצורך אבטחה, מניעת ניצול לרעה וניתוח שימוש כללי.</li>
              <li><strong className="text-zinc-200">נתוני סימולציה:</strong> עסקאות סימולציה (Paper Trading), יתרות וירטואליות ותוצאות ניתוח — כולם למטרות תפעול השירות והצגת היסטוריה למשתמש. אין בהם כסף אמיתי או גישה לברוקר/בורסה.</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-white">3. אי־אחזקת כספים או פרטי ברוקר</h2>
            <p>
              <strong className="text-zinc-200">המערכת אינה מחזיקה כסף אמיתי ואינה שומרת פרטי גישה לברוקר או לבורסה.</strong> כל פעילות המסחר במערכת היא סימולציה (Paper Trading) בלבד. יתרות, רווחים והפסדים המוצגים הם וירטואליים ומשמשים למטרות לימוד ומידע. אין במערכת הפקדות, משיכות או חיבור לחשבונות מסחר אמיתיים.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-white">4. שימוש בנתונים</h2>
            <p>הנתונים משמשים כדי:</p>
            <ul className="list-disc list-inside space-y-2 pr-4">
              <li>לספק את שירותי הסריקה, הניתוח והסימולציה.</li>
              <li>לשלוח התראות ל‑Telegram בהתאם להגדרות המשתמש.</li>
              <li>לשפר את אבטחת המערכת ולמנוע שימוש לרעה.</li>
              <li>לעמוד בדרישות חוק ורגולציה במידת הצורך.</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-white">5. שיתוף עם צד שלישי</h2>
            <p>
              איננו מוכרים נתונים אישיים. נתונים עשויים להיות מועברים לספקי תשתית (אירוח, מסד נתונים) הנדרשים להפעלת השירות, בכפוף להתחייבויות סודיות והגנה. שליחת הודעות ל‑Telegram מתבצעת באמצעות ממשקי Telegram הרשמיים.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-white">6. שמירה ואבטחה</h2>
            <p>
              אנו נוקטים אמצעים סבירים להגנה על הנתונים (הצפנה, גישה מוגבלת, גיבויים). למרות זאת, אין להבטיח אבטחה מוחלטת ברשת; המשתמש אחראי על שמירת סודיות פרטי הגישה שלו.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-white">7. זכויות המשתמש</h2>
            <p>
              בהתאם לדין החל, למשתמש עשויות להיות זכויות לגישה, תיקון או מחיקה של נתונים אישיים. לפניות בנושא פרטיות יש להשתמש בדרכי ההתקשרות שמופיעות במערכת או במדיניות הצור קשר.
            </p>
          </section>

          <section className="pt-6 border-t border-white/10 text-sm text-zinc-500">
            <p>
              עדכונים למדיניות זו יפורסמו בדף זה. המשך שימוש לאחר עדכון מהווה הסכמה למדיניות המעודכנת. Smart Money · קבוצת Mon Chéri.
            </p>
          </section>
        </article>
      </div>
    </div>
  );
}
