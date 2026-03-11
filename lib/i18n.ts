export type Locale = 'en' | 'he';

export const messages = {
  en: {
    title: 'Crypto Quant AI',
    newAnalysis: 'New Analysis',
    assetSymbol: 'Asset Symbol',
    runAnalysis: 'Run Quantitative Analysis',
    analyzing: 'Analyzing Market Data...',
    feedbackLoop: 'Feedback Loop',
    evaluate: 'Evaluate Past Predictions',
    evaluating: 'Evaluating...',
    latestPrediction: 'Latest Prediction',
    history: 'Prediction History & Learning',
    noPredictions: 'No Predictions Yet',
    loadMore: 'Load 10 More Records',
    keyboardHint: 'Ctrl+Enter analyze, Alt+E evaluate',
  },
  he: {
    title: 'Crypto Quant AI',
    newAnalysis: 'ניתוח חדש',
    assetSymbol: 'סימול נכס',
    runAnalysis: 'הרץ ניתוח כמותי',
    analyzing: 'מנתח נתוני שוק...',
    feedbackLoop: 'לולאת פידבק',
    evaluate: 'הערך תחזיות עבר',
    evaluating: 'מעריך...',
    latestPrediction: 'תחזית אחרונה',
    history: 'היסטוריית תחזיות ולמידה',
    noPredictions: 'אין תחזיות עדיין',
    loadMore: 'טען עוד 10 רשומות',
    keyboardHint: 'Ctrl+Enter לניתוח, Alt+E להערכה',
  },
} as const;
