/**
 * רשימת מטבעות קריפטו נתמכים לחיזוי וסימולציה.
 * כל סימבול מופיע כ־base (למשל BTC) ומשולב עם USDT בבקשות ל־Binance.
 */

export const CRYPTO_SYMBOLS = [
  'BTC',
  'ETH',
  'BNB',
  'SOL',
  'XRP',
  'ADA',
  'DOGE',
  'AVAX',
  'LINK',
  'DOT',
  'MATIC',
  'UNI',
  'ATOM',
  'LTC',
  'BCH',
  'ETC',
  'XLM',
  'ALGO',
  'VET',
  'FIL',
  'TRX',
  'NEAR',
  'APT',
  'ARB',
  'OP',
  'INJ',
  'SUI',
  'SEI',
  'PEPE',
  'WIF',
  'FET',
  'RENDER',
  'GRT',
  'AAVE',
  'MKR',
  'SNX',
  'CRV',
  'COMP',
  'SAND',
  'MANA',
  'AXS',
  'GALA',
  'APE',
  'SHIB',
  'FLOKI',
] as const;

export type CryptoBaseSymbol = (typeof CRYPTO_SYMBOLS)[number];

/** שמות בעברית לתצוגה (אופציונלי). */
export const CRYPTO_LABELS_HE: Partial<Record<CryptoBaseSymbol, string>> = {
  BTC: 'ביטקוין',
  ETH: 'איתריום',
  BNB: 'ביננס',
  SOL: 'סולנה',
  XRP: 'ריפל',
  ADA: 'קרדانو',
  DOGE: 'דוגקוין',
  AVAX: 'אבאלנצ׳',
  LINK: 'צ׳יינאלינק',
  DOT: 'פולקדוט',
  MATIC: 'פוליגון',
  UNI: 'יוניסוואפ',
  ATOM: 'קוסמוס',
  LTC: 'לייטקוין',
  BCH: 'ביטקוין קאש',
  ETC: 'איתריום קלאסיק',
  XLM: 'סטלר',
  ALGO: 'אלגורנד',
  VET: 'ויצ׳יין',
  FIL: 'פיילקוין',
  TRX: 'טרון',
  NEAR: 'ניר',
  APT: 'אפטוס',
  ARB: 'ארביטרום',
  OP: 'אופטימיזם',
  INJ: 'אינג׳קטיב',
  SUI: 'סואי',
  SEI: 'סיי',
  PEPE: 'פפה',
  WIF: 'דוג וויף',
  FET: 'פרץ׳',
  RENDER: 'רנדר',
  GRT: 'הגרף',
  AAVE: 'אייף',
  MKR: 'מייקר',
  SNX: 'סינתטיקס',
  CRV: 'קर्व',
  COMP: 'קומפאונד',
  SAND: 'סנדבוקס',
  MANA: 'דسنترלנד',
  AXS: 'אקסי אינפיניטי',
  GALA: 'גאלה',
  APE: 'אפתור',
  SHIB: 'שיבה אינואו',
  FLOKI: 'פלוקי',
};

export function toSymbol(base: string): string {
  const u = base.toUpperCase().trim();
  return u.endsWith('USDT') ? u : `${u}USDT`;
}

export function getLabelHe(base: CryptoBaseSymbol | string): string {
  const key = base as CryptoBaseSymbol;
  return CRYPTO_LABELS_HE[key] ?? base;
}

export function isSupportedBase(value: string): value is CryptoBaseSymbol {
  return CRYPTO_SYMBOLS.includes(value.toUpperCase() as CryptoBaseSymbol);
}
