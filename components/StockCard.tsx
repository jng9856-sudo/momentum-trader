'use client';

import { StockAnalysis } from '@/types/stock';

const SIGNAL_LABEL: Record<string, string> = { BUY: '매수', SELL: '매도', HOLD: '관망' };
const CONF_LABEL:   Record<string, string> = { HIGH: '신뢰도 높음', MEDIUM: '신뢰도 중간', LOW: '신뢰도 낮음' };
const RS_LABEL:     Record<string, string> = { STRONG: '강세', NEUTRAL: '중립', WEAK: '약세' };
const MA50_LABEL:   Record<string, string> = { ABOVE: '50일선 위', AT: '50일선 근접', BELOW: '50일선 아래' };
const PATTERN_LABEL: Record<string, string> = {
  CUP: '컵앤핸들', W_BASE: 'W베이스', BREAKOUT: '돌파', DOWNTREND: '하락추세', NONE: '패턴없음',
};

function signalColor(s: string) {
  if (s === 'BUY')  return 'text-emerald-400';
  if (s === 'SELL') return 'text-red-400';
  return 'text-amber-400';
}
function signalBg(s: string) {
  if (s === 'BUY')  return 'bg-emerald-950 text-emerald-300 border-emerald-800';
  if (s === 'SELL') return 'bg-red-950 text-red-300 border-red-800';
  return 'bg-amber-950 text-amber-300 border-amber-800';
}
function signalBorder(s: string) {
  if (s === 'BUY')  return 'border-l-emerald-500 glow-buy';
  if (s === 'SELL') return 'border-l-red-500 glow-sell';
  return 'border-l-amber-500 glow-hold';
}
function rsColor(r: string) {
  if (r === 'STRONG') return 'text-emerald-400';
  if (r === 'WEAK')   return 'text-red-400';
  return 'text-zinc-400';
}
function barColor(score: number) {
  if (score >= 7) return '#10b981';
  if (score >= 4) return '#f59e0b';
  return '#ef4444';
}
function confDot(c: string) {
  if (c === 'HIGH')   return 'bg-emerald-400';
  if (c === 'MEDIUM') return 'bg-amber-400';
  return 'bg-zinc-500';
}

export default function StockCard({ stock, highlight = false }: { stock: StockAnalysis; highlight?: boolean }) {
  const score = Math.min(10, Math.max(1, Math.round(Number(stock.momentum_score) || 5)));
  const barW  = Math.round((score / 10) * 100);

  return (
    <div
      className={`stock-card border border-border border-l-4 ${signalBorder(stock.signal)} rounded-xl p-5 bg-bg-card ${highlight ? 'ring-1 ring-emerald-500/30' : ''}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-xl font-semibold tracking-tight text-zinc-100">{stock.ticker}</span>
          <span className={`w-2 h-2 rounded-full ${confDot(stock.confidence)}`} />
          <span className="text-xs text-zinc-500">{CONF_LABEL[stock.confidence]}</span>
        </div>
        <span className={`text-xs font-semibold px-3 py-1 rounded-md border ${signalBg(stock.signal)}`}>
          {SIGNAL_LABEL[stock.signal]}
        </span>
      </div>

      {/* Momentum bar */}
      <div className="mb-4">
        <div className="flex justify-between text-xs text-zinc-500 mb-1.5">
          <span>모멘텀 강도</span>
          <span className={`font-semibold ${signalColor(stock.signal)}`}>{score} / 10</span>
        </div>
        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="momentum-bar-fill h-full rounded-full"
            style={{ '--target-width': `${barW}%`, width: `${barW}%`, background: barColor(score) } as React.CSSProperties}
          />
        </div>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Metric label="지수 대비 RS">
          <span className={`text-sm font-medium ${rsColor(stock.rs_vs_index)}`}>{RS_LABEL[stock.rs_vs_index]}</span>
        </Metric>
        <Metric label="섹터 내 RS">
          <span className={`text-sm font-medium ${rsColor(stock.rs_vs_sector)}`}>{RS_LABEL[stock.rs_vs_sector]}</span>
        </Metric>
        <Metric label="이동평균선">
          <span className={`text-sm font-medium ${stock.ma50_status === 'ABOVE' ? 'text-emerald-400' : stock.ma50_status === 'BELOW' ? 'text-red-400' : 'text-zinc-400'}`}>
            {MA50_LABEL[stock.ma50_status]}
          </span>
        </Metric>
        <Metric label="차트 패턴">
          <span className="text-sm font-medium text-zinc-300">{PATTERN_LABEL[stock.pattern]}</span>
        </Metric>
      </div>

      {/* Summary */}
      <p className="text-xs text-zinc-400 leading-relaxed font-sans mb-3" style={{ fontFamily: 'system-ui, sans-serif' }}>
        {stock.summary}
      </p>

      {/* Caution */}
      {stock.caution && (
        <div className="text-xs text-amber-400 bg-amber-950/40 border-l-2 border-amber-500 pl-3 py-2 rounded-r-md mb-3" style={{ fontFamily: 'system-ui, sans-serif' }}>
          ⚡ {stock.caution}
        </div>
      )}

      {/* Price levels */}
      <div className="flex flex-wrap gap-2">
        {stock.entry_zone  && <LevelPill label="진입" value={stock.entry_zone} color="text-emerald-300 border-emerald-800 bg-emerald-950/40" />}
        {stock.key_support && <LevelPill label="지지" value={stock.key_support} color="text-sky-300 border-sky-800 bg-sky-950/40" />}
        {stock.key_resistance && <LevelPill label="저항" value={stock.key_resistance} color="text-purple-300 border-purple-800 bg-purple-950/40" />}
        {stock.stop_loss   && <LevelPill label="손절" value={stock.stop_loss} color="text-red-300 border-red-800 bg-red-950/40" />}
      </div>
    </div>
  );
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] text-zinc-600 uppercase tracking-widest">{label}</span>
      {children}
    </div>
  );
}

function LevelPill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span className={`text-xs px-2 py-1 border rounded-md ${color}`}>
      {label} {value}
    </span>
  );
}
