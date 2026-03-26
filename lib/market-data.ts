type EnvKeyValidation = {
  present: boolean;
  valid: boolean;
  reason?: string;
};

function validateProviderApiKey(keyName: 'CRYPTOQUANT_API_KEY' | 'CMC_API_KEY'): EnvKeyValidation {
  const raw = (process.env[keyName] || '').trim();
  if (!raw) {
    return { present: false, valid: false, reason: `${keyName} is missing` };
  }
  if (raw.length < 8 || /todo|changeme|example/i.test(raw)) {
    return { present: true, valid: false, reason: `${keyName} appears invalid` };
  }
  return { present: true, valid: true };
}

export function getMarketDataProviderStatus() {
  return {
    cryptoQuant: validateProviderApiKey('CRYPTOQUANT_API_KEY'),
    coinMarketCap: validateProviderApiKey('CMC_API_KEY'),
  };
}

export function ensureMarketDataProviderOrFallback(
  provider: 'CryptoQuant' | 'CoinMarketCap'
): { enabled: boolean; reason: string | null } {
  const keyName = provider === 'CryptoQuant' ? 'CRYPTOQUANT_API_KEY' : 'CMC_API_KEY';
  const status = validateProviderApiKey(keyName);
  if (status.valid) return { enabled: true, reason: null };

  const reason = status.reason ?? `${keyName} is unavailable`;
  console.error(`[CRITICAL] [MarketData] ${provider} disabled: ${reason}. Falling back to degraded data path.`);
  return { enabled: false, reason };
}
