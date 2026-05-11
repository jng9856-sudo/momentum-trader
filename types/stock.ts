export type SignalType     = 'BREAKOUT' | 'SETUP' | 'COILING' | 'WATCH' | 'HOLD' | 'SELL' | 'STRONG_SELL';
export type ConfidenceType = 'HIGH' | 'MEDIUM' | 'LOW';
export type StrengthType   = 'STRONG' | 'NEUTRAL' | 'WEAK';
export type MA50Type       = 'ABOVE' | 'AT' | 'BELOW';
export type PatternType    = 'CUP' | 'W_BASE' | 'BREAKOUT' | 'DOWNTREND' | 'NONE';
export type StageType      = 1 | 2 | 3 | 4;

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
  prev_macd_histogram?: number;
  macd_expanding?:    boolean;
  macd_contracting?:  boolean;
  is_momentum_mode?:  boolean;
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

  // RS Ranking
  rs_rank?:           number;
  rs_rank_warning?:   boolean;
  sector_ytd?:        number | null;
  sector_warning?:    string | null;

  // 52w Breakout
  breakout_52w?:        boolean;
  breakout_52w_day?:    number;
  breakout_52w_vol?:    boolean;
  breakout_52w_detail?: string;

  // PEAD
  pead_signal?:         boolean;
  pead_surprise_pct?:   number | null;
  pead_detail?:         string | null;

  // Weekly timeframe
  weekly_trend?:        'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' | null;
  weekly_align_score?:  number | null;
  weekly_is_entry?:     boolean;
  weekly_pullback?:     number | null;
  weekly_above_mas?:    boolean;
  weekly_detail?:       string | null;
  weekly_rsi?:          number | null;

  // Short Interest
  short_pct?:           number | null;
  short_ratio?:         number | null;
  short_squeeze?:       'HIGH' | 'MEDIUM' | 'LOW';
  short_detail?:        string | null;

  // VCP / Pivot
  vcp_score?:               number;
  vcp_is_vcp?:              boolean;
  vcp_contraction_count?:   number;
  vcp_last_pullback?:       number;
  vcp_base_weeks?:          number;
  vcp_lowest_vol?:          boolean;
  vcp_pivot?:               number | null;
  vcp_detail?:              string;
  pivot_broken?:            boolean;
  pivot_dist?:              number;
  pivot_within_chase?:      boolean;

  // 시장 국면
  regime_note?:             string | null;

  // R/R
  rr_ratio?:                number | null;
  rr_grade?:                'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | null;
  rr_risk?:                 number | null;
  rr_reward?:               number | null;
  rr_label?:                string;

  // 눌림목
  pullback_is?:             boolean;
  pullback_grade?:          'IDEAL' | 'GOOD' | 'WEAK' | null;
  pullback_pct?:            number;
  pullback_support?:        string | null;
  pullback_support_price?:  number | null;
  pullback_dist_to_support?: number;
  pullback_vol_trend?:      'DECLINING' | 'FLAT' | 'RISING';
  pullback_rsi_cooled?:     boolean;
  pullback_high?:           number;
  pullback_detail?:         string;

  // 섹터
  sector?:                  string | null;
  industry?:                string | null;

  // Pocket Pivot
  pocket_pivot?:            boolean;
  pocket_pivot_days_ago?:   number;
  pocket_pivot_vol_ratio?:  number;
  pocket_pivot_above_ma?:   string | null;
  pocket_pivot_detail?:     string;

  // RS Line
  rs_line?:                 number;
  rs_line_trend?:           'UP' | 'DOWN' | 'FLAT';
  rs_line_divergence?:      'BULLISH' | 'BEARISH' | 'NONE';
  rs_line_new_high?:        boolean;
  rs_line_spy_new_low?:     boolean;
  rs_line_3m_change?:       number;
  rs_line_detail?:          string;

  // 트레일링 스탑
  trail_initial_stop?:      number;
  trail_stop_10?:           number;
  trail_stop_20?:           number;
  trail_stop_30?:           number;
  trail_multiplier?:        number;
  trail_break_even?:        number;
  trail_detail?:            string;

  // 분할 매수/매도
  split_entry1?:  { price: string; ratio: number; condition: string } | null;
  split_entry2?:  { price: string; ratio: number; condition: string } | null;
  split_entry3?:  { price: string; ratio: number; condition: string } | null;
  split_exit1?:   { price: string; ratio: number; gain: string } | null;
  split_exit2?:   { price: string; ratio: number; gain: string } | null;
  split_exit3?:   { price: string; ratio: number; gain: string } | null;
  split_avg_entry?: number | null;

  // ── 셋업 품질 분석 (신규) ──────────────────────────────────────────────────
  // "아직 안 오른" 베이스 빌딩 종목을 발굴하는 점수
  setup_score?:         number;       // 0-100 (높을수록 좋은 미발굴 셋업)
  setup_label?:         string;       // 🔥 최상급 셋업 / ⚡ 코일링 / 📐 형성 중 등
  setup_base_weeks?:    number;       // 베이스 기간 (주)
  setup_atr_contraction?: number;     // 현재ATR / 역사적ATR — 낮을수록 압축 (0.6이하 = 강한 코일)
  setup_price_range?:   number;       // 베이스 내 가격 변동폭 % (좁을수록 좋음)
  setup_vol_drying?:    boolean;      // 베이스 중 거래량 고갈 여부
  setup_rs_leading?:    boolean;      // RS Line이 주가보다 먼저 상승 (기관 조용히 매집 신호)
  setup_pivot?:         number;       // 베이스 고점 = 돌파 기준가
  setup_dist_pivot?:    number;       // 현재가 → 피봇까지 거리 % (음수 = 아직 돌파 전)
  setup_stage?:         StageType;    // Minervini Stage 1~4
  setup_is_coiling?:    boolean;      // 즉시 주목 셋업 플래그
  setup_detail?:        string;       // 셋업 요약 문자열
}

export interface AnalysisResult {
  stocks:         StockAnalysis[];
  market_context: string;
  analyzed_at:    string;
}
