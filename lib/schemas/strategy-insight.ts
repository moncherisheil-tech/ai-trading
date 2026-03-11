export interface StrategyInsight {
  id: string;
  pattern_summary: string;
  actionable_rule: string;
  confidence_score: number;
  created_at: string;
  status: 'pending' | 'approved' | 'rejected';
}

