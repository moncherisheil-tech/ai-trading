import Link from 'next/link';
import { ArrowRight, BookOpen, Sparkles, Users, Target, Wallet } from 'lucide-react';

export const metadata = {
  title: 'איך לקרוא את המערכת | Mon Chéri Quant AI',
  description: 'מדריך למשתמש — הסבר על ציון הג\'ם, ששת המומחים, TP/SL וארנק הסימולציה',
};

export default function GuidePage() {
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

        <header className="border-b border-white/10 pb-6 mb-8">
          <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-3">
            <BookOpen className="w-8 h-8 text-amber-500" aria-hidden />
            איך לקרוא את המערכת
          </h1>
          <p className="text-zinc-400">
            מדריך קצר להבנת ציון הג&#39;ם, המומחים, TP/SL וארנק הסימולציה. Smart Money · קבוצת Mon Chéri.
          </p>
        </header>

        <article className="space-y-10 text-zinc-300 leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-white mb-3 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-500" />
              מהו ציון הג&#39;ם (Gem Score)?
            </h2>
            <p>
              ציון הג&#39;ם הוא ציון משוקלל (0–100) שמסכם את דעת ששת המומחים של המערכת. ככל שהציון גבוה יותר, הקונצנזוס חזק יותר שהתחזית אמינה. מעל 75 בדרך כלל נחשב להמלצה &quot;אישור כניסה&quot; מצד הדירקטוריון הוירטואלי. הציון לא מבטיח רווח — הוא כלי עזר להערכת רמת הביטחון של הניתוח.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3 flex items-center gap-2">
              <Users className="w-5 h-5 text-violet-500" />
              איך עובדים שישה המומחים?
            </h2>
            <p>
              המערכת מריצה שישה &quot;מומחים&quot; במקביל: טכני (גרפים, RSI), מנהל סיכונים, פסיכולוג שוק, מקרו/Order Book, On-Chain (בלוקצ&#39;יין), ו-Deep Memory (היסטוריית תבניות). כל מומחה נותן ציון 0–100 והנחיית Judge (דירקטוריון) ממזגת אותם ל&quot;החלטת דירקטוריון&quot; ולציון ג&#39;ם סופי. כך אתה רואה לא רק את התוצאה אלא גם מאיפה היא מגיעה.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3 flex items-center gap-2">
              <Target className="w-5 h-5 text-cyan-500" />
              מה זה TP ו-SL?
            </h2>
            <p>
              <strong className="text-zinc-200">TP (Take Profit)</strong> — יעד רווח: המחיר שהמערכת מציעה ליעד לרווח (למשל למכור כשהמחיר עולה לרמה X). <strong className="text-zinc-200">SL (Stop Loss)</strong> — סטופ לוס: רמת מחיר שמומלץ לצאת בה אם השוק זז נגדך, כדי להגביל הפסד. שני הערכים מחושבים על בסיס ATR (תנודתיות) ורמות HVN (נפח גבוה) כדי להתאים לשוק.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3 flex items-center gap-2">
              <Wallet className="w-5 h-5 text-emerald-500" />
              איך משתמשים בארנק הסימולציה?
            </h2>
            <p>
              ארנק הסימולציה הוא וירטואלי בלבד — אין כסף אמיתי. אתה מתחיל עם יתרה התחלתית (למשל 10,000 דולר) ויכול ללחוץ &quot;קנה&quot; או &quot;מכור&quot; לפי המחיר החי שמוצג. הכפתורים 25%, 50%, 100% ממלאים את הסכום לפי אחוז מיתרת הארנק. כך אתה יכול לתרגל החלטות בלי סיכון כספי. &quot;איפוס&quot; מחזיר את הארנק להתחלה. הנתונים נשמרים במערכת כדי שתוכל לראות היסטוריית סימולציה.
            </p>
          </section>

          <p className="text-sm text-amber-200/90 font-medium pt-4 border-t border-white/5">
            תזכורת: המערכת למטרות לימוד וסימולציה בלבד. אין לראות במידע כאן ייעוץ השקעות. מסחר כרוך בסיכון.
          </p>
        </article>
      </div>
    </div>
  );
}
