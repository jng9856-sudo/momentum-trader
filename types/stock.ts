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
  // MA data
  ma10?:              number;
  ma20?:              number;
  ma30?:              number;
  ma50?:              number;
  ma120?:             number;
  above_ma_count?:    number;
  stacked_bull?:      boolean;
  stacked_bear?:      boolean;
  // OBV
  obv_trend?:         'UP' | 'DOWN' | 'FLAT';
  obv_divergence?:    boolean;
  obv_detail?:        string;

  // Weekly timeframe
  weekly_trend?:       'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' | null;
  weekly_align_score?: number | null;
  weekly_is_entry?:    boolean;
  weekly_pullback?:    number | null;
  weekly_above_mas?:   boolean;
  weekly_detail?:      string | null;
  weekly_rsi?:         number | null;

  // Short Interest
  short_pct?:         number | null;
  short_ratio?:       number | null;
  short_squeeze?:     'HIGH' | 'MEDIUM' | 'LOW';
  short_detail?:      string | null;

  // VCP / Pivot data
  vcp_score?:         number;
  vcp_is_vcp?:        boolean;
  vcp_contraction_count?: number;
  vcp_last_pullback?: number;
  vcp_base_weeks?:    number;
  vcp_lowest_vol?:    boolean;
  vcp_pivot?:         number | null;
  vcp_detail?:        string;
  pivot_broken?:      boolean;
  pivot_dist?:        number;
  pivot_within_chase?: boolean;
}

export interface AnalysisResult {
  stocks:         StockAnalysis[];
  market_context: string;
  analyzed_at:    string;
}
