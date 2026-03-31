/** Default Groq chat model for Tri-Core hourly leg (OpenAI-compatible API). */
export const GROQ_DEFAULT_MODEL = 'llama-3.3-70b-versatile';

export function resolveGroqModel(): string {
  const fromEnv = (process.env.GROQ_MODEL || '').trim();
  return fromEnv || GROQ_DEFAULT_MODEL;
}
