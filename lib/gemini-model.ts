type GeminiRequestOptions = {
  apiVersion: 'v1';
};

export function resolveGeminiModel(modelName: string): {
  model: string;
  requestOptions: GeminiRequestOptions;
} {
  const raw = (modelName || '').trim();
  const normalized = raw.replace(/^models\//, '');
  const model = normalized ? `models/${normalized}` : 'models/gemini-2.5-flash';

  return {
    model,
    requestOptions: { apiVersion: 'v1' },
  };
}
