import fs from 'fs';
const p = 'lib/consensus-engine.ts';
let s = fs.readFileSync(p, 'utf8');
const start = s.indexOf('  const out = await callGeminiJson<ExpertOnChainOutput>(');
const ret = "  const onchain_score = Math.max(0, Math.min(100, Number(out.onchain_score) ?? 50));`n  return { onchain_score, onchain_logic: String(out.onchain_logic || 'ללא נימוק').slice(0, 500) };";
const end = s.indexOf(ret, start);
if (start < 0 || end < 0) throw new Error('bad ' + start + ' ' + end);
const end2 = end + ret.length;
const repl = `  let anthropicKey: string | undefined;
  try {
    anthropicKey = getRequiredAnthropicApiKey();
  } catch {
    anthropicKey = undefined;
  }
  if (anthropicKey) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: ANTHROPIC_SONNET_MODEL,
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content:
                prompt +
                '\\n\\nOutput ONLY a raw JSON object with keys onchain_score (0-100 number) and onchain_logic (Hebrew string). No markdown.',
            },
          ],
        }),
        cache: 'no-store',
      });
      if (res.ok) {
        const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
        let text = '';
        for (const c of data.content || []) {
          if (c.type === 'text' && c.text) text += c.text;
        }
        const parsed = JSON.parse(extractFirstJsonObject(text.replace(/[\u0000-\u001F]+/g, ' '))) as Record<string, unknown>;
        const onchain_score = Math.max(0, Math.min(100, Number(parsed.onchain_score) ?? 50));
        const onchain_logic = String(parsed.onchain_logic || 'ללא נימוק').slice(0, 500);
        return { onchain_score, onchain_logic };
      }
    } catch (e) {
      console.warn('[ConsensusEngine] Anthropic On-Chain failed, Gemini fallback:', e instanceof Error ? e.message : e);
    }
  }
  const out = await callGeminiJson<ExpertOnChainOutput>(
    prompt,
    ['onchain_score', 'onchain_logic'],
    model,
    timeoutMs,
    { symbol: input.symbol, expert: 'On-Chain (Gemini fallback)' }
  );
  const onchain_score = Math.max(0, Math.min(100, Number(out.onchain_score) ?? 50));
  return { onchain_score, onchain_logic: String(out.onchain_logic || 'ללא נימוק').slice(0, 500) };`;
s = s.slice(0, start) + repl + s.slice(end2);
fs.writeFileSync(p, s);
console.log('onchain ok');
