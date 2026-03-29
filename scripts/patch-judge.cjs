const fs = require('fs');
const path = 'lib/consensus-engine.ts';
let s = fs.readFileSync(path, 'utf8');
const start = s.indexOf('async function runJudge(');
const end = s.indexOf('/** Fallback score when an expert times out', start);
if (start < 0 || end < 0) throw new Error('markers');
const nj = `async function runJudge(
  tech: ExpertTechnicianOutput,
  risk: ExpertRiskOutput,
  psych: ExpertPsychOutput,
  macro: ExpertMacroOutput,
  onchain: ExpertOnChainOutput,
  deepMemory: ExpertDeepMemoryOutput,
  contrarian: ExpertContrarianOutput,
  symbol: string,
  model: string,
  timeoutMs: number,
  judgeOpts?: {
    polarizedBoard: boolean;
    expertHitRatesLine: string;
  }
): Promise<{
  master_insight_he: string;
  reasoning_path: string;
  debate_resolution: string;
  contrarian_addressed: boolean;
  contrarian_refutation_he: string;
}> {
  const expertWeights = await getExpertWeights();
  const polarized = judgeOpts?.polarizedBoard ?? false;
  const hitLine = judgeOpts?.expertHitRatesLine ?? '';
  const debateBlock = polarized
    ? \`POLARIZED_BOARD=true: שני מחנות מנוגדים (BUY חזק מול SELL חזק). חובה למלא debate_resolution בעברית: סיכום דיון — מה כל צד רואה, איזה ראיות דוחקות, ומה נתיב ההכרעה הסופית לפני ציון ביטחון.\`
    : \`POLARIZED_BOARD=false: השאר debate_resolution כמחרוזת ריקה "".\`;

  const prompt = \`אתה Chief Investment Officer סקפטי (Supreme Inspector, Overseer/CIO) בחדר הדיונים — Institutional Crypto Quantitative Board. חובה: לסנתז (synthesize) ולהצליב (cross-reference) במפורש את כל שבעת התשובות (כולל ה-Contrarian) לפני קביעת התובנה הסופית.

\${debateBlock}

מצב אמון מומחים דינמי (Reinforcement Learning): Data Expert=\${expertWeights.dataExpertWeight.toFixed(2)}, News Expert=\${expertWeights.newsExpertWeight.toFixed(2)}, Macro Expert=\${expertWeights.macroExpertWeight.toFixed(2)}. משקלים אלה משקפים ביצועים אחרונים של המומחים — כאשר המשקל גבוה יותר תן משקל גדול יותר לעמדת המומחה, וכאשר המשקל נמוך היה ספקן יותר.
\${hitLine ? \`שיעורי פגיעה אמפיריים (30 יום, DB פוסט-מורטם): \${hitLine}\` : ''}

שבעת המומחים:
- 1.Technician: ציון \${tech.tech_score}, לוגיקה: \${tech.tech_logic}
- 2.Risk: ציון \${risk.risk_score}, לוגיקה: \${risk.risk_logic}
- 3.Psych: ציון \${psych.psych_score}, לוגיקה: \${psych.psych_logic}
- 4.Macro: ציון \${macro.macro_score}, לוגיקה: \${macro.macro_logic}
- 5.On-Chain: ציון \${onchain.onchain_score}, לוגיקה: \${onchain.onchain_logic}
- 6.Deep Memory: ציון \${deepMemory.deep_memory_score}, לוגיקה: \${deepMemory.deep_memory_logic}
- 7.CONTRARIAN (adversarial): ביטחון \${contrarian.contrarian_confidence}, trap_type=\${contrarian.trap_type}, מלכודה: \${contrarian.trap_hypothesis_he}, התקפה: \${contrarian.attack_on_consensus_he}

אם ה-Contrarian מצביע על bull_trap/bear_trap עם ביטחון גבוה — חובה להשיב במפורש למתקפה (refutation) בעברית ב-contrarian_refutation_he, ולסמן contrarian_addressed=true רק אם סיכלת לוגית את טענותיו. אחרת contrarian_addressed=false.

תפקידך: סינתזה סקפטית; Gem Score מחושב במערכת — אל תחשב בעצמך. master_insight_he עד 2 משפטים בעברית. reasoning_path משפט אחד. debate_resolution לפי POLARIZED_BOARD.
חובה: JSON גולמי בדיוק: master_insight_he, reasoning_path, debate_resolution, contrarian_addressed (boolean), contrarian_refutation_he (string Hebrew, יכול להיות ריק אם אין סתירה חזקה).\`;
  const out = await callGeminiJson<{
    master_insight_he: string;
    reasoning_path: string;
    debate_resolution?: string;
    contrarian_addressed?: boolean;
    contrarian_refutation_he?: string;
  }>(
    prompt,
    ['master_insight_he', 'reasoning_path', 'debate_resolution', 'contrarian_addressed', 'contrarian_refutation_he'],
    model,
    timeoutMs,
    { symbol, expert: 'Judge' }
  );
  return {
    master_insight_he: String(out.master_insight_he || 'אין תובנה').slice(0, 600),
    reasoning_path: String(out.reasoning_path || '').slice(0, 320),
    debate_resolution: String(out.debate_resolution ?? '').slice(0, 500),
    contrarian_addressed: Boolean(out.contrarian_addressed),
    contrarian_refutation_he: String(out.contrarian_refutation_he ?? '').slice(0, 600),
  };
}

`;
s = s.slice(0, start) + nj + s.slice(end);
fs.writeFileSync(path, s);
console.log('judge patched', start, end);