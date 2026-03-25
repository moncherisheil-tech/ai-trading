import Link from 'next/link';
import { ArrowRight, AlertTriangle } from 'lucide-react';

export const metadata = {
  title: 'אזהרת סיכון פיננסי | Mon Chéri Quant AI',
  description: 'אזהרת סיכון — המערכת לניתוח וסימולציה אינה ייעוץ השקעות. Smart Money, קבוצת Mon Chéri.',
};

export default function RiskPage() {
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

        {/* Critical banner — highly visible */}
        <div
          className="mb-10 rounded-2xl border-2 border-rose-500/60 bg-rose-500/10 p-6 sm:p-8"
          role="alert"
          aria-labelledby="risk-heading"
        >
          <div className="flex items-start gap-4">
            <AlertTriangle className="w-10 h-10 shrink-0 text-rose-400 mt-0.5" aria-hidden />
            <div className="space-y-3 min-w-0">
              <h1 id="risk-heading" className="text-2xl sm:text-3xl font-bold text-rose-200">
                אזהרת סיכון פיננסי
              </h1>
              <p className="text-base sm:text-lg text-rose-100/90 leading-relaxed font-medium">
                המערכת מספקת אלגוריתמי סריקת שוק וכלי סימולציה (Paper Trading) <strong className="text-white">למטרות לימוד ומידע בלבד</strong>. אין במערכת ייעוץ השקעות, המלצה לפעולה או תחליף לייעוץ פיננסי מקצועי. ביצועי עבר אינם מבטיחים תוצאות עתידיות. <strong className="text-white">Smart Money וקבוצת Mon Chéri אינן נושאות באחריות לכל הפסד או נזק פיננסי שייגרם למשתמש.</strong>
              </p>
            </div>
          </div>
        </div>

        <article
          className="prose prose-invert prose-lg max-w-none space-y-8 text-right text-zinc-300 leading-relaxed prose-headings:text-white prose-p:leading-relaxed prose-li:leading-relaxed"
          style={{ fontFamily: 'system-ui, sans-serif' }}
        >
          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-white">1. אופי השירות — לימוד וסימולציה בלבד</h2>
            <p>
              המערכת המופעלת על ידי Smart Money (חלק מקבוצת Mon Chéri) כוללת סריקת שוק ואלגוריתמים לניתוח, וכן כלים לסימולציית מסחר (&quot;Paper Trading&quot;) — כלומר מסחר וירטואלי ללא כסף אמיתי. כל אלה נועדו <strong className="text-zinc-200">למטרות חינוכיות ומידעיות בלבד</strong>. אין בהם המלצה לרכישה או מכירה של נכסים, ואין בהם ייעוץ השקעות או שיווק השקעות.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-white">2. אין ייעוץ פיננסי מקצועי</h2>
            <p>
              התוכן, התחזיות והניתוחים במערכת אינם מהווים ייעוץ השקעות, ייעוץ מס או ייעוץ משפטי. כל החלטה פיננסית או השקעתית היא על אחריות המשתמש הבלעדית. מומלץ להתייעץ עם יועץ השקעות מורשה ו/או עורך דין לפני ביצוע החלטות כספיות.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-white">3. ביצועי עבר אינם מבטיחים תוצאות עתידיות</h2>
            <p>
              תוצאות סימולציה, מדדי ביצועים או נתונים היסטוריים המוצגים במערכת אינם מבטיחים רווחים או תוצאות דומות בעתיד. שוקי הנכסים הדיגיטליים ומסחר בכלל כרוכים בסיכון משמעותי, כולל אפשרות של אובדן הון.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-white">4. מגבלת אחריות — אין אחריות להפסדים</h2>
            <p>
              <strong className="text-zinc-200">Smart Money וקבוצת Mon Chéri (כולל בעלי השליטה, העובדים והנציגים) אינן נושאות באחריות כלשהי — ישירה, עקיפה או תוצאתית — לכל נזק, הפסד כספי, רווח מבוזבז או כל תוצאה אחרת שייגרמו למשתמש או לצד שלישי בעקבות שימוש או הסתמכות על המערכת, המידע או הסימולציה שבה.</strong> השימוש במערכת הוא על אחריות המשתמש בלבד. במידה שהדין מתיר, לא תהיה כל אחריות מעבר לאמור במפורש בחוק.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-white">5. סיכוני מסחר ונכסים דיגיטליים</h2>
            <p>
              מסחר בנכסים דיגיטליים ובנכסים פיננסיים כרוך בסיכון גבוה ועשוי לא להתאים לכל משקיע. יש להבין היטב את הסיכונים לפני כל פעולה. המערכת אינה מבצעת מסחר אמיתי ואינה מחזיקה כסף או נכסים של המשתמש.
            </p>
          </section>

          <section className="pt-6 border-t border-white/10 text-sm text-zinc-500 space-y-1">
            <p>
              כניסה למערכת או שימוש בה מהווים הכרה והסכמה לאזהרה זו. Smart Money · קבוצת Mon Chéri.
            </p>
            <p aria-hidden>
              תאריך עדכון אחרון: 14/03/2026
            </p>
          </section>
        </article>
      </div>
    </div>
  );
}
