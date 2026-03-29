import fs from 'fs';
const p = 'lib/consensus-engine.ts';
let s = fs.readFileSync(p, 'utf8');
const marker = "  const envVarName = 'GROQ_API_KEY';";
const idx = s.indexOf(marker);
if (idx < 0) throw new Error('marker');
const insert = `  const useGroqMacro = process.env.MACRO_EXPERT_USE_GROQ === '1';
  const gemModelMacro = geminiFallbackModel ?? GEMINI_MACRO_FALLBACK_MODEL;
  if (!useGroqMacro) {
    try {
      const gemOut = await callGeminiJson<ExpertMacroOutput>(
        userPrompt,
        ['macro_score', 'macro_logic'],
        gemModelMacro,
        timeoutMs,
        { symbol, expert: 'Macro (Gemini primary)' }
      );
      const macro_score = Math.max(0, Math.min(100, Number(gemOut.macro_score) ?? 50));
      return {
        macro_score,
        macro_logic: String(gemOut.macro_logic || 'ללא נימוק').slice(0, 500),
      };
    } catch (gemErr) {
      console.warn('[ConsensusEngine] Gemini Macro primary failed, falling back to Groq if available:', gemErr instanceof Error ? gemErr.message : gemErr);
    }
  }

`;
s = s.slice(0, idx) + insert + s.slice(idx);
fs.writeFileSync(p, s);
console.log('macro gemini primary ok');
