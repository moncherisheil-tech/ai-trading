type GeminiRequestOptions = {
  apiVersion?: 'v1' | 'v1beta';
};

export function resolveGeminiModel(modelName: string): {
  model: string;
  requestOptions?: GeminiRequestOptions;
} {
  const raw = (modelName || '').trim();
  if (!raw) {
    return { model: 'gemini-2.5-flash' };
  }

  const normalized = raw.replace(/^models\//, '');
  if (normalized.startsWith('gemini-1.5-flash')) {
    // Gemini 1.5 Flash is served on production v1 endpoints.
    return {
      model: `models/${normalized}`,
      requestOptions: { apiVersion: 'v1' },
    };
  }

  return { model: raw };
}
