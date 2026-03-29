import fs from 'fs';
const p = 'lib/consensus-engine.ts';
let s = fs.readFileSync(p, 'utf8');
const needle = `  const out = await callGeminiJson<ExpertTechnicianOutput>(
    prompt,
    ['tech_score', 'tech_logic'],
    model,
    timeoutMs,
    { symbol: input.symbol, expert: 'Technician' }
  );
  const tech_score = Math.max(0, Math.min(100, Number(out.tech_score) || 50));
  return { tech_score, tech_logic: String(out.tech_logic || 'ללא נימוק').slice(0, 500) };`;
const repl = `  const groqKey = getGroqApiKey();
  if (groqKey) {
    try {
      const groq = new Groq({ apiKey: groqKey });
      const started = Date.now();
      const completion = await Promise.race([
        groq.chat.completions.create({
          model: GROQ_MODEL,
          messages: [
            {
              role: 'system',
              content:
                'You are Expert 1 (Technician): LOB microstructure, FVG, order blocks. Output ONLY raw JSON. Keys: tech_score (0-100 number), tech_logic (Hebrew string, concise).',
            },
            { role: 'user', content: prompt },
          ],
          temperature: getConsensusEngineLlmTemperature(),
          max_tokens: 1024,
          response_format: { type: 'json_object' },
        }),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('Groq technician timeout')), Math.min(timeoutMs, 55_000))
        ),
      ]);
      recordProviderSample('groq', { ok: true, latencyMs: Date.now() - started });
      const raw = completion.choices?.[0]?.message?.content?.trim() ?? '';
      if (raw) {
        const parsed = JSON.parse(extractFirstJsonObject(raw.replace(/[\u0000-\u001F]+/g, ' '))) as Record<string, unknown>;
        const tech_score = Math.max(0, Math.min(100, Number(parsed.tech_score) || 50));
        const tech_logic = String(parsed.tech_logic || 'ללא נימוק').slice(0, 500);
        return { tech_score, tech_logic };
      }
    } catch (e) {
      recordProviderSample('groq', { ok: false, latencyMs: HAWKEYE_HOT_SWAP_LATENCY_MS });
      console.warn('[ConsensusEngine] Groq Technician failed, falling back to Gemini:', e instanceof Error ? e.message : e);
    }
  }
  const out = await callGeminiJson<ExpertTechnicianOutput>(
    prompt,
    ['tech_score', 'tech_logic'],
    model,
    timeoutMs,
    { symbol: input.symbol, expert: 'Technician (Gemini fallback)' }
  );
  const tech_score = Math.max(0, Math.min(100, Number(out.tech_score) || 50));
  return { tech_score, tech_logic: String(out.tech_logic || 'ללא נימוק').slice(0, 500) };`;
if (!s.includes(needle)) {
  console.error('technician needle missing');
  process.exit(1);
}
s = s.replace(needle, repl);
fs.writeFileSync(p, s);
console.log('technician groq ok');
