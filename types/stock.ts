export type SignalType     = 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
export type ConfidenceType = 'HIGH' | 'MEDIUM' | 'LOW';
export type StrengthType   = 'STRONG' | 'NEUTRAL' | 'WEAK';
export type MA50Type       = 'ABOVE' | 'AT' | 'BELOW';
export type PatternType    = 'CUP' | 'W_BASE' | 'BREAKOUT' | 'DOWNTREND' | 'NONE';

export interface StockAnalysis {
  ticker:             string;
  signal:             SignalType;
  confidence:         ConfidenceType;
  momentum_score:     number;
  rs_vs_index:        StrengthType;
  rs_vs_sector:       StrengthType;
  ma50_status:        MA50Type;
  pattern:            PatternType;
  volume_confirmation: boolean;
  entry_zone:         string | null;
  key_support:        string | null;
  key_resistance:     string | null;
  stop_loss:          string | null;
  summary:            string;
  caution:            string | null;
  // Extended indicators
  rsi:                number;
  macd_histogram:     number;
  volume_ratio:       number;
  bb_position:        number;
  atr_pct:            number;
}

export interface AnalysisResult {
  stocks:         StockAnalysis[];
  market_context: string;
  analyzed_at:    string;
}
