'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  GraduationCap,
  Layers,
  Brain,
  Shield,
  BarChart3,
  Target,
  Activity,
  TrendingUp,
  Cpu,
  AlertTriangle,
} from 'lucide-react';
import { runAcademyRagAction } from '@/app/actions';
const AGENTS = [
  {
    name: 'מומחה טכני',
    nameEn: 'Technician',
    icon: BarChart3,
    role: 'מזהה דפוסים טכניים, בלוקי פקודות, ויקוף, גריפות נזילות ואזורי כניסה (OI, Funding, Sweeps).',
  },
  {
    name: 'מנהל סיכונים',
    nameEn: 'Risk Manager',
    icon: Shield,
    role: 'מנטר ATR, תנודתיות, יחס R:R וסטופ לוס חובה כדי להגן על ההון.',
  },
  {
    name: 'פסיכולוג שוק',
    nameEn: 'Market Psychologist',
    icon: Brain,
    role: 'מנתח FOMO/פחד, דומיננטיות סושיאל וסט‑אפים קונטראריים (Euphoria vs צבירה שקטה).',
  },
  {
    name: 'מקרו / Order Book',
    nameEn: 'Macro & Order Book',
    icon: Target,
    role: 'מנתח דומיננטיות USDT, תזרים ETF, DXY, קירות פקודות וזיוף לווייתנים.',
  },
  {
    name: 'On-Chain Sleuth',
    nameEn: 'On-Chain',
    icon: Activity,
    role: 'מנתח תנועות לווייתנים ו־Exchange Inflow/Outflow (זרימות אל/מהבורסות).',
  },
  {
    name: 'Deep Memory (Vector)',
    nameEn: 'Deep Memory',
    icon: Layers,
    role: 'מפיק חוות דעת עצמאית על בסיס עסקאות היסטוריות דומות: "על בסיס X עסקאות, הסתברות הצלחה Y%".',
  },
];

export default function AcademyPage() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [question, setQuestion] = useState('מה ניתן ללמוד מהיסטוריית העסקאות של הסמל הזה?');
  const [loading, setLoading] = useState(false);
  const [ragStatus, setRagStatus] = useState<'LIVE' | 'AWAITING_LIVE_DATA' | null>(null);
  const [ragAnswer, setRagAnswer] = useState('');
  const [retrieved, setRetrieved] = useState<Array<{ symbol: string; trade_id: number; text: string }>>([]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setRagStatus('AWAITING_LIVE_DATA');
    try {
      const payload = await runAcademyRagAction({ symbol, question });
      if (!payload?.ok) {
        setRagAnswer(payload?.error ?? 'בקשת RAG נכשלה. בדוק חיבור Pinecone/Gemini.');
        setRetrieved([]);
        return;
      }

      setRagStatus(payload.status ?? 'LIVE');
      setRagAnswer(payload.answer ?? '');
      setRetrieved(Array.isArray(payload.retrieved) ? payload.retrieved : []);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] overflow-x-hidden pb-20 sm:pb-0 max-w-full" dir="rtl" lang="he">
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-14 sm:pt-16 pb-6 sm:pb-8 min-w-0 space-y-10">
        {/* Hero */}
        <section className="rounded-2xl border border-white/10 bg-black/40 frosted-obsidian p-6 sm:p-8 overflow-hidden" aria-labelledby="academy-hero-heading">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0" aria-hidden>
              <GraduationCap className="w-6 h-6 text-amber-500" />
            </div>
            <div className="min-w-0">
              <h1 id="academy-hero-heading" className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                אקדמיית Mon Chéri — מרכז הלמידה
              </h1>
              <p className="text-sm text-zinc-400 mt-0.5">הכלים והרעיונות מאחורי המערכת — בהסבר ברור למתחילים</p>
            </div>
          </div>
          <p className="text-zinc-300 text-sm sm:text-base leading-relaxed max-w-2xl">
            דף זה מיועד למשתמשים ללא ניסיון. תלמד מהו מסחר כמותי, איך ששת המומחים וה־Overseer חושבים, ואיך לנהל סיכונים עם TP ו־SL.
          </p>
        </section>

        <section className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 frosted-obsidian p-6 sm:p-8" aria-labelledby="academy-rag-heading">
          <h2 id="academy-rag-heading" className="text-lg sm:text-xl font-bold text-white mb-3">
            Deep Memory RAG — Live Retrieval
          </h2>
          <p className="text-sm text-zinc-300 mb-4">
            ממשק חי ל־Pinecone + Gemini. אין תשובות מדומות: אם אין retrieval אמיתי, הסטטוס יציג AWAITING_LIVE_DATA.
          </p>
          <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3">
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
              placeholder="BTCUSDT"
            />
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white min-h-24"
              placeholder="שאלת RAG"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg border border-cyan-400/35 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-200 disabled:opacity-60"
            >
              {loading ? 'טוען...' : 'הרץ שאילתת RAG חיה'}
            </button>
          </form>
          <div className="mt-4 rounded-lg border border-white/10 bg-black/30 p-4">
            <p className="text-xs font-mono text-zinc-400">STATUS: {ragStatus ?? 'IDLE'}</p>
            <p className="mt-2 text-sm text-zinc-200 whitespace-pre-wrap">{ragAnswer || 'No response yet.'}</p>
            <div className="mt-3 space-y-2">
              {retrieved.map((item) => (
                <div key={`${item.symbol}-${item.trade_id}`} className="rounded-md border border-white/10 p-2 text-xs text-zinc-300">
                  <p className="font-mono text-zinc-400">{item.symbol} #{item.trade_id}</p>
                  <p>{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Section A: Intro to Quant Trading */}
        <section
          className="rounded-2xl border border-white/10 bg-black/40 frosted-obsidian overflow-hidden"
          aria-labelledby="section-intro-heading"
        >
          <div className="p-6 sm:p-8 border-b border-white/5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0" aria-hidden>
                <TrendingUp className="w-6 h-6 text-emerald-400" />
              </div>
              <div>
                <h2 id="section-intro-heading" className="text-lg sm:text-xl font-bold text-white">
                  מבוא למסחר כמותי
                </h2>
                <p className="text-sm text-zinc-400 mt-0.5">הבסיס — בלי ז&apos;רגון מיותר</p>
              </div>
            </div>
            <div className="space-y-4 text-zinc-300 text-sm sm:text-base leading-relaxed">
              <p>
                <strong className="text-zinc-200">מסחר כמותי (Quant)</strong> הוא גישה שמסתמכת על נתונים ומדדים מספריים במקום על תחושות בטן. המערכת שלנו אוספת מידע מהשוק — מחירים, נפחים, פקודות, ונתוני בלוקצ&apos;יין — ומזינה אותו ל־AI שמנתח תבניות ומציע כיוונים.
              </p>
              <p>
                המטרה אינה &quot;לנחש&quot; את השוק, אלא להעריך רמת ביטחון: כמה מהמומחים מסכימים? מה רמת התנודתיות? כך תוכל להבין את ההמלצות (למשל &quot;ציון ג&apos;ם 78&quot;) ולקבל החלטות מושכלות.
              </p>
              <p className="text-amber-200/90 text-sm">
                חשוב: כל התוכן והסימולציה כאן הם לימודיים בלבד — לא ייעוץ השקעות. השתמש בארנק הסימולציה כדי לתרגל בלי סיכון כספי.
              </p>
            </div>
          </div>
        </section>

        {/* Section B: How the system thinks — 6 Experts + Overseer */}
        <section
          className="rounded-2xl border border-white/10 bg-black/40 frosted-obsidian overflow-hidden"
          aria-labelledby="section-experts-heading"
        >
          <div className="p-6 sm:p-8 border-b border-white/5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0" aria-hidden>
                <Cpu className="w-6 h-6 text-violet-400" />
              </div>
              <div>
                <h2 id="section-experts-heading" className="text-lg sm:text-xl font-bold text-white">
                  איך המערכת חושבת?
                </h2>
                <p className="text-sm text-zinc-400 mt-0.5">ששת המומחים וה־Overseer (הדירקטוריון)</p>
              </div>
            </div>
            <p className="text-zinc-400 text-sm sm:text-base mb-6 leading-relaxed">
              המערכת משתמשת בארכיטקטורת <strong className="text-zinc-300">MoE (תערובת מומחים)</strong>: שישה מומחי AI מנתחים כל נכס במקביל — טכני, סיכון, פסיכולוגיית שוק, מקרו/Order Book, On-Chain ו־Deep Memory. ה־<strong className="text-zinc-300">Overseer</strong> (תפקיד דמוי CEO) מסנתז את כל הדעות ומגיע להחלטה אחת, כאשר לכל מומחה משקל שווה (1/6). כך אתה רואה לא רק את התוצאה אלא גם מאיפה היא מגיעה.
            </p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4 list-none p-0 m-0" role="list">
              {AGENTS.map((agent) => {
                const Icon = agent.icon;
                return (
                  <li
                    key={agent.nameEn}
                    className="rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:p-5 hover:bg-white/[0.04] transition-colors duration-300"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0" aria-hidden>
                        <Icon className="w-5 h-5 text-amber-500" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-white text-sm sm:text-base">{agent.name}</h3>
                        <p className="text-xs text-zinc-500 mt-0.5" dir="ltr">{agent.nameEn}</p>
                        <p className="text-zinc-400 text-xs sm:text-sm mt-2 leading-relaxed">{agent.role}</p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="text-zinc-500 text-xs sm:text-sm mt-4">
              ציון הג&apos;ם (0–100) הוא סיכום הקונצנזוס. מעל 75 בדרך כלל נחשב להמלצה חזקה מצד הדירקטוריון הוירטואלי.
            </p>
          </div>
        </section>

        {/* Section C: Practical risk management — TP/SL */}
        <section
          className="rounded-2xl border border-white/10 bg-black/40 frosted-obsidian overflow-hidden"
          aria-labelledby="section-risk-heading"
        >
          <div className="p-6 sm:p-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0" aria-hidden>
                <AlertTriangle className="w-6 h-6 text-amber-400" />
              </div>
              <div>
                <h2 id="section-risk-heading" className="text-lg sm:text-xl font-bold text-white">
                  ניהול סיכונים מעשי
                </h2>
                <p className="text-sm text-zinc-400 mt-0.5">TP, SL והגנה על ההון</p>
              </div>
            </div>
            <div className="space-y-6 text-zinc-300 text-sm sm:text-base leading-relaxed">
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
                <h3 className="font-semibold text-emerald-400/95 mb-2">TP — Take Profit (יעד רווח)</h3>
                <p>
                  המחיר שהמערכת מציעה ליעד לרווח: למשל למכור כשהמחיר מגיע לרמה X. עוזר לקבע רווח ולא להשאיר הכל בידי התנודתיות.
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
                <h3 className="font-semibold text-rose-400/95 mb-2">SL — Stop Loss (סטופ לוס)</h3>
                <p>
                  רמת מחיר שמומלץ לצאת בה אם השוק זז נגדך — כדי להגביל הפסד. מנהל הסיכונים מחשב אותה על בסיס ATR (תנודתיות) ורמות HVN (נפח גבוה) כדי להתאים לשוק.
                </p>
              </div>
              <p>
                <strong className="text-zinc-200">יחס סיכון/תגמול (R/R)</strong> — כמה אתה מוכן להפסיד (סיכון) לעומת כמה אתה מצפה להרוויח (תגמול). לדוגמה R/R 1:2 = סיכון של 1% לתגמול של 2%. המערכת מציגה TP ו־SL מוצעים בכל ניתוח; תוכל להשתמש בהם בארנק הסימולציה.
              </p>
            </div>
          </div>
        </section>

        {/* Glossary — compact, with BookOpen */}
        <section className="rounded-2xl border border-white/10 bg-black/40 frosted-obsidian p-6 sm:p-8 overflow-hidden" aria-labelledby="glossary-heading">
          <h2 id="glossary-heading" className="flex items-center gap-2 text-lg font-bold text-white mb-4">
            <BookOpen className="w-5 h-5 text-amber-500 shrink-0" aria-hidden />
            מילון מונחים — קריפטו ומסחר
          </h2>
          <ul className="space-y-4 list-none p-0 m-0" role="list">
            <li className="rounded-xl border border-white/10 bg-white/[0.02] p-4 hover:bg-white/[0.04] transition-colors">
              <h3 className="font-semibold text-amber-400/95 text-sm">בלוקי פקודות מוסדיים</h3>
              <p className="text-xs text-zinc-500 mt-0.5" dir="ltr">Institutional Order Blocks</p>
              <p className="text-zinc-300 text-sm mt-2">אזורים במחיר שבהם מוסדות ביצעו פקודות גדולות; המערכת מזהה תמיכה והתנגדות.</p>
            </li>
            <li className="rounded-xl border border-white/10 bg-white/[0.02] p-4 hover:bg-white/[0.04] transition-colors">
              <h3 className="font-semibold text-amber-400/95 text-sm">צבירה והפצה לפי ויקוף</h3>
              <p className="text-xs text-zinc-500 mt-0.5" dir="ltr">Wyckoff</p>
              <p className="text-zinc-300 text-sm mt-2">שיטת ניתוח שמזהה שלבים: צבירה (קונים בשקט), הפצה (מוכרים לציבור).</p>
            </li>
            <li className="rounded-xl border border-white/10 bg-white/[0.02] p-4 hover:bg-white/[0.04] transition-colors">
              <h3 className="font-semibold text-amber-400/95 text-sm">גריפת נזילות</h3>
              <p className="text-xs text-zinc-500 mt-0.5" dir="ltr">Liquidity Sweeps</p>
              <p className="text-zinc-300 text-sm mt-2">תנועה קצרה מעבר ל־stop loss של סוחרים ואז חזרה — מוסדות משתמשים בזה לפני עלייה.</p>
            </li>
            <li className="rounded-xl border border-white/10 bg-white/[0.02] p-4 hover:bg-white/[0.04] transition-colors">
              <h3 className="font-semibold text-amber-400/95 text-sm">פחד וחמדנות (FOMO)</h3>
              <p className="text-xs text-zinc-500 mt-0.5" dir="ltr">Fear & Greed Index</p>
              <p className="text-zinc-300 text-sm mt-2">מדד סנטימנט השוק; קיצוניות משני הצדדים מסמנת סיכון.</p>
            </li>
          </ul>
        </section>

        {/* CTA */}
        <section className="rounded-2xl border border-amber-500/20 bg-amber-500/5 frosted-obsidian p-6 text-center">
          <p className="text-zinc-300 text-sm mb-4">רוצה לראות את המומחים והמערכת בפעולה?</p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-400 hover:bg-amber-500/30 px-5 py-2.5 text-sm font-semibold transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
          >
            חזרה לאנליזר
            <ArrowRight className="w-4 h-4 rtl:rotate-180" aria-hidden />
          </Link>
        </section>
      </main>
    </div>
  );
}
