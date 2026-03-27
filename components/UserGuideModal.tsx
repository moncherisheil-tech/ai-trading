'use client';

import { useEffect } from 'react';
import { X, BookOpen, Sparkles, Users, Target, Wallet } from 'lucide-react';
import Link from 'next/link';

const GUIDE_TITLE = 'איך לקרוא את המערכת';

type UserGuideModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export default function UserGuideModal({ isOpen, onClose }: UserGuideModalProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="guide-title"
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/95 shadow-[0_18px_48px_rgba(0,0,0,0.45)] flex flex-col"
        dir="rtl"
      >
        <div className="flex items-center gap-3 p-4 border-b border-slate-800 shrink-0">
          <h2 id="guide-title" className="text-lg font-bold text-white flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-amber-500" aria-hidden />
            {GUIDE_TITLE}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="ms-auto p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500"
            aria-label="סגור מדריך"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto p-6 space-y-6 text-sm text-zinc-300 leading-relaxed">
          <section>
            <h3 className="text-base font-semibold text-white mb-2 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              מהו ציון הג&#39;ם (Gem Score)?
            </h3>
            <p>
              ציון הג&#39;ם הוא ציון משוקלל (0–100) שמסכם את דעת ששת המומחים של המערכת. ככל שהציון גבוה יותר, הקונצנזוס חזק יותר שהתחזית אמינה. מעל 75 בדרך כלל נחשב להמלצה &quot;אישור כניסה&quot; מצד הדירקטוריון הוירטואלי. הציון לא מבטיח רווח — הוא כלי עזר להערכת רמת הביטחון של הניתוח.
            </p>
          </section>
          <section>
            <h3 className="text-base font-semibold text-white mb-2 flex items-center gap-2">
              <Users className="w-4 h-4 text-violet-500" />
              איך עובדים שישה המומחים?
            </h3>
            <p>
              המערכת מריצה שישה &quot;מומחים&quot; במקביל: טכני (גרפים, RSI), מנהל סיכונים, פסיכולוג שוק, מקרו/Order Book, On-Chain (בלוקצ&#39;יין), ו-Deep Memory (היסטוריית תבניות). כל מומחה נותן ציון 0–100 והנחיית Judge (דירקטוריון) ממזגת אותם ל&quot;החלטת דירקטוריון&quot; ולציון ג&#39;ם סופי. כך אתה רואה לא רק את התוצאה אלא גם מאיפה היא מגיעה.
            </p>
          </section>
          <section>
            <h3 className="text-base font-semibold text-white mb-2 flex items-center gap-2">
              <Target className="w-4 h-4 text-cyan-500" />
              מה זה TP ו-SL?
            </h3>
            <p>
              <strong className="text-zinc-200">TP (Take Profit)</strong> — יעד רווח: המחיר שהמערכת מציעה ליעד לרווח (למשל למכור כשהמחיר עולה לרמה X). <strong className="text-zinc-200">SL (Stop Loss)</strong> — סטופ לוס: רמת מחיר שמומלץ לצאת בה אם השוק זז נגדך, כדי להגביל הפסד. שני הערכים מחושבים על בסיס ATR (תנודתיות) ורמות HVN (נפח גבוה) כדי להתאים לשוק.
            </p>
          </section>
          <section>
            <h3 className="text-base font-semibold text-white mb-2 flex items-center gap-2">
              <Wallet className="w-4 h-4 text-emerald-500" />
              איך משתמשים בארנק הסימולציה?
            </h3>
            <p>
              ארנק הסימולציה הוא וירטואלי בלבד — אין כסף אמיתי. אתה מתחיל עם יתרה התחלתית (למשל 10,000 דולר) ויכול ללחוץ &quot;קנה&quot; או &quot;מכור&quot; לפי המחיר החי שמוצג. הכפתורים 25%, 50%, 100% ממלאים את הסכום לפי אחוז מיתרת הארנק. כך אתה יכול לתרגל החלטות בלי סיכון כספי. &quot;איפוס&quot; מחזיר את הארנק להתחלה. הנתונים נשמרים במערכת כדי שתוכל לראות היסטוריית סימולציה.
            </p>
          </section>
          <p className="text-xs text-zinc-500 pt-2 border-t border-white/5">
            למידע מלא ומפורט ניתן לעיין בעמוד{' '}
            <Link href="/guide" className="text-amber-500/90 hover:text-amber-400 underline" onClick={onClose}>
              איך לקרוא את המערכת
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
