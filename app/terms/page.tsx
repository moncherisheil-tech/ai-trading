import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export const metadata = {
  title: 'תנאי שימוש | Mon Chéri Quant AI',
  description: 'תנאי השימוש במערכת ניתוח כמותי וסימולציה — Smart Money, קבוצת Mon Chéri',
};

export default function TermsPage() {
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
            <h1 className="text-3xl font-bold text-white mb-2">תנאי שימוש</h1>
            <p className="text-sm text-zinc-500">
              עדכון אחרון: מרץ 2025 · Smart Money, קבוצת Mon Chéri
            </p>
          </header>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-white">1. קבלה ותוקף</h2>
            <p>
              גישה לשירות מערכת הניתוח הכמותי והסימולציה (&quot;המערכת&quot;) מהווה הסכמה לתנאים אלה. אם אינך מסכים לתנאים, אל תשתמש בשירות.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-white">2. אופי השירות ואי־ייעוץ השקעות</h2>
            <p>
              <strong className="text-amber-200/90">המערכת מיועדת למטרות חינוכיות, מחקריות וסימולציה בלבד.</strong> התוכן, התחזיות והניתוחים המוצגים בה נוצרים באמצעות בינה מלאכותית ואינם מהווים ייעוץ השקעות, המלצה לרכישה או מכירה של נכסים פיננסיים, או תחליף לייעוץ מקצועי.
            </p>
            <p>
              <strong className="text-amber-200/90">מסחר במטבעות קריפטוגרפיים ובנכסים פיננסיים כרוך בסיכון גבוה ועלול לגרום להפסד כספי.</strong> אין להסתמך על המערכת כבסיס להחלטות השקעה. כל החלטה מסחרית היא על אחריותך הבלעדית.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-white">3. סימולציה ולא ביצוע אמיתי</h2>
            <p>
              ארנק הסימולציה, יתרות וירטואליות ותוצאות &quot;מסחר&quot; במערכת הם לצורכי תרגול ומידע בלבד. אין במערכת הפקדות או משיכות כסף אמיתי, ואין חיבור לברוקר או בורסה. כל רווח או הפסד המוצג במסגרת הסימולציה הוא וירטואלי.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-white">4. שימוש הוגן ואבטחה</h2>
            <p>
              אתה מתחייב להשתמש בשירות בהתאם לדין, לא לנצל פגיעויות, לא להציף את המערכת ולא לגשת לנתונים של משתמשים אחרים. הפרה של תנאים אלה עלולה לגרום להפסקת הגישה.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-white">5. קניין רוחני</h2>
            <p>
              כל הזכויות בממשק, בלוגיקה ובתכנים של המערכת שייכות לספק השירות (או לבעל הזכויות). אסור להעתיק, לשכפל או לעשות שימוש מסחרי ללא רשות.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-white">6. הגבלת אחריות</h2>
            <p>
              השירות ניתן &quot;כמות שהוא&quot;. ספק השירות לא יהיה אחראי לכל נזק ישיר או עקיף הנובע משימוש או אי־שימוש במערכת, כולל אובדן רווחים או נתונים. במידת הרלוונטיות, האחריות תוגבל להיקף המותר על פי הדין.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-white">7. עדכונים</h2>
            <p>
              תנאי שימוש אלה עשויים להתעדכן מעת לעת. המשך שימוש לאחר פרסום עדכון מהווה הסכמה לגרסה המעודכנת. מומלץ לעיין בתנאים מעת לעת.
            </p>
          </section>

          <section className="pt-6 border-t border-white/10 text-sm text-zinc-500">
            <p>
              לשאלות בנושא תנאי שימוש או מדיניות פרטיות, עיין ב־
              <Link href="/privacy" className="text-amber-500/90 hover:text-amber-400 underline underline-offset-2">מדיניות הפרטיות</Link>
              {' '}או בדרכי ההתקשרות שמופיעות במערכת. Smart Money · קבוצת Mon Chéri.
            </p>
          </section>
        </article>
      </div>
    </div>
  );
}
