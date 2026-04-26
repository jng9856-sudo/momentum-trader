'use client';
import { StockAnalysis } from '@/types/stock';
import { useRouter } from 'next/navigation';
import EarningsBadge from '@/components/EarningsBadge';

const SIG_KO: Record<string, string> = {
  STRONG_BUY: '즉시매수', BUY: '매수', HOLD: '관망', SELL: '매도', STRONG_SELL: '즉시매도',
};
const RS_KO:  Record<string, string> = { STRONG: '강세', NEUTRAL: '중립', WEAK: '약세' };
const MA_KO:  Record<string, string> = { ABOVE: '50일선 위', AT: '50일선 근접', BELOW: '50일선 아래' };
const PT_KO:  Record<string, string> = { CUP: '컵앤핸들', W_BASE: 'W베이스', BREAKOUT: '돌파', DOWNTREND: '하락추세', NONE: '패턴없음' };

function sigColors(s: string) {
  switch (s) {
    case 'STRONG_BUY':  return { border: 'border-l-emerald-400', badge: 'bg-emerald-900 text-emerald-200 border-emerald-600', bar: '#10b981' };
    case 'BUY':         return { border: 'border-l-emerald-700', badge: 'bg-emerald-950 text-emerald-400 border-emerald-800', bar: '#34d399' };
    case 'HOLD':        return { border: 'border-l-amber-600',   badge: 'bg-amber-950  text-amber-300   border-amber-800',   bar: '#f59e0b' };
    case 'SELL':        return { border: 'border-l-red-700',     badge: 'bg-red-950    text-red-400     border-red-800',     bar: '#f87171' };
    case 'STRONG_SELL': return { border: 'border-l-red-400',     badge: 'bg-red-900    text-red-200     border-red-500',     bar: '#ef4444' };
    default:            return { border: 'border-l-zinc-600',    badge: 'bg-zinc-900   text-zinc-400    border-zinc-700',    bar: '#71717a' };
  }
}
function rsClass(r: string) { return r === 'STRONG' ? 'text-emerald-400' : r === 'WEAK' ? 'text-red-400' : 'text-zinc-400'; }
function confDot(c: string) { return c === 'HIGH' ? 'bg-emerald-400' : c === 'MEDIUM' ? 'bg-amber-400' : 'bg-zinc-500'; }

function GaugeBar({ value, max, color }: { value: number; max: number; color: string }) {
  const w = Math.round(Math.min(100, Math.max(0, (value / max) * 100)));
  return (
    <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${w}%`, background: color }} />
    </div>
  );
}

interface EarningsInfo { earningsDate: string | null; daysUntil: number | null; epsEstimate: number | null; revenueEstimate: string | null; lastEPS: number | null; }

export default function StockCard({ stock, highlight = false, onRemove, earnings }: { stock: StockAnalysis; highlight?: boolean; onRemove?: (ticker: string) => void; earnings?: EarningsInfo }) {
  const router = useRouter();
  const score  = Math.min(10, Math.max(1, Math.round(Number(stock.momentum_score) * 2) / 2));
  const c      = sigColors(stock.signal);

  return (
    <div className={`stock-card border border-zinc-800 border-l-4 ${c.border} rounded-xl p-5 bg-bg-card
      ${highlight ? 'ring-1 ring-emerald-500/20' : ''}`}>

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <button onClick={() => router.push(`/stock/${stock.ticker}`)} className="text-xl font-semibold text-zinc-100 hover:text-emerald-300 transition-colors underline-offset-2 hover:underline cursor-pointer">{stock.ticker} ↗</button>
            {onRemove && (
              <button onClick={() => onRemove(stock.ticker)}
                className="w-5 h-5 flex items-center justify-center rounded-full bg-zinc-800 hover:bg-red-900 text-zinc-500 hover:text-red-400 transition-colors text-xs leading-none"
                title="목록에서 삭제">✕</button>
            )}
          </div>
          <span className={`w-2 h-2 rounded-full ${confDot(stock.confidence)}`} />
          <span className="text-xs text-zinc-500">
            {stock.confidence === 'HIGH' ? '신뢰↑' : stock.confidence === 'MEDIUM' ? '신뢰중' : '신뢰↓'}
          </span>
        </div>
        <span className={`text-xs font-semibold px-3 py-1 rounded-md border ${c.badge}`}>
          {SIG_KO[stock.signal] ?? stock.signal}
        </span>
      </div>

      {/* Earnings badge */}
      {earnings && <div className="mb-3"><EarningsBadge info={earnings} /></div>}

      {/* Momentum score */}
      <div className="mb-3">
        <div className="flex justify-between text-xs text-zinc-500 mb-1.5">
          <span>모멘텀 강도</span>
          <span className="font-semibold" style={{ color: c.bar }}>{score} / 10</span>
        </div>
        <GaugeBar value={score} max={10} color={c.bar} />
      </div>

      {/* Main metrics grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <Metric label="지수 RS"><span className={`text-sm font-medium ${rsClass(stock.rs_vs_index)}`}>{RS_KO[stock.rs_vs_index]}</span></Metric>
        <Metric label="섹터 RS"><span className={`text-sm font-medium ${rsClass(stock.rs_vs_sector)}`}>{RS_KO[stock.rs_vs_sector]}</span></Metric>
        <Metric label="이동평균">
          <span className={`text-sm font-medium ${stock.ma50_status === 'ABOVE' ? 'text-emerald-400' : stock.ma50_status === 'BELOW' ? 'text-red-400' : 'text-zinc-400'}`}>
            {MA_KO[stock.ma50_status]}
          </span>
        </Metric>
        <Metric label="패턴"><span className="text-sm font-medium text-zinc-300">{PT_KO[stock.pattern]}</span></Metric>
      </div>

      {/* Extended indicators */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4 p-3 bg-zinc-900/50 rounded-lg">
        <IndBox label="RSI(14)" value={stock.rsi}
          color={stock.rsi > 78 ? 'text-red-400' : stock.rsi < 35 ? 'text-sky-400' : 'text-emerald-400'}
          sub={stock.rsi > 78 ? '과열' : stock.rsi < 35 ? '침체' : '정상'} />
        <IndBox label="MACD" value={stock.macd_histogram}
          color={stock.macd_histogram > 0 ? 'text-emerald-400' : 'text-red-400'}
          sub={stock.macd_histogram > 0 ? '상승' : '하락'} />
        <IndBox label="거래량" value={`${stock.volume_ratio}x`}
          color={stock.volume_ratio > 1.5 ? 'text-emerald-400' : stock.volume_ratio < 0.7 ? 'text-red-400' : 'text-zinc-400'}
          sub={stock.volume_ratio > 1.5 ? '강함' : stock.volume_ratio < 0.7 ? '약함' : '보통'} />
        <IndBox label="BB위치" value={`${stock.bb_position}%`}
          color={stock.bb_position > 80 ? 'text-amber-400' : stock.bb_position < 20 ? 'text-sky-400' : 'text-zinc-400'}
          sub={stock.bb_position > 80 ? '상단' : stock.bb_position < 20 ? '하단' : '중간'} />
        <IndBox label="ATR%" value={`${stock.atr_pct}%`}
          color="text-zinc-400" sub="변동성" />
      </div>

      {/* OBV Section */}
      {stock.obv_trend !== undefined && (
        <div className={`mb-3 p-3 rounded-lg border ${
          stock.obv_divergence ? 'border-red-800 bg-red-950/20' :
          stock.obv_trend === 'UP' ? 'border-emerald-900 bg-emerald-950/10' :
          stock.obv_trend === 'DOWN' ? 'border-red-900 bg-red-950/10' : 'border-zinc-800 bg-zinc-900/30'
        }`}>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-zinc-500 uppercase tracking-widest">OBV 기관 매집 분석</span>
              {stock.obv_divergence && (
                <span className="text-[9px] bg-red-900 text-red-300 border border-red-700 px-1.5 py-0.5 rounded">다이버전스 ⚠</span>
              )}
            </div>
            <span className={`text-xs font-semibold font-mono ${
              stock.obv_trend === 'UP' ? 'text-emerald-400' :
              stock.obv_trend === 'DOWN' ? 'text-red-400' : 'text-zinc-400'
            }`}>
              {stock.obv_trend === 'UP' ? '▲ 매집' : stock.obv_trend === 'DOWN' ? '▼ 분산' : '— 중립'}
            </span>
          </div>
          <p className="text-[10px] text-zinc-500" style={{ fontFamily: 'system-ui' }}>{stock.obv_detail ?? ''}</p>
        </div>
      )}

      {/* Short Interest */}
      {stock.short_pct !== undefined && stock.short_pct !== null && (
        <div className={`mb-3 p-3 rounded-lg border ${
          stock.short_squeeze === 'HIGH' ? 'border-amber-800 bg-amber-950/20' :
          stock.short_squeeze === 'MEDIUM' ? 'border-zinc-700 bg-zinc-900/40' : 'border-zinc-800 bg-zinc-900/20'
        }`}>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-zinc-500 uppercase tracking-widest">공매도 현황</span>
              {stock.short_squeeze === 'HIGH' && (
                <span className="text-[9px] bg-amber-900 text-amber-300 border border-amber-700 px-1.5 py-0.5 rounded">숏스퀴즈 주의 ⚡</span>
              )}
            </div>
            <div className="flex items-center gap-2 font-mono text-xs">
              <span className={stock.short_pct > 20 ? 'text-red-400' : stock.short_pct > 10 ? 'text-amber-400' : 'text-zinc-400'}>
                {stock.short_pct}%
              </span>
              {stock.short_ratio && <span className="text-zinc-600">/ {stock.short_ratio}일</span>}
            </div>
          </div>
          <p className="text-[10px] text-zinc-500" style={{ fontFamily: 'system-ui' }}>{stock.short_detail ?? ''}</p>
        </div>
      )}

      {/* RSI bar */}
      <div className="mb-4">
        <div className="flex justify-between text-[10px] text-zinc-600 mb-1">
          <span>RSI</span>
          <span className="flex gap-3">
            <span className="text-sky-700">침체30</span>
            <span className="text-emerald-700">정상45–75</span>
            <span className="text-red-700">과열80</span>
          </span>
        </div>
        <div className="relative h-1.5 bg-zinc-800 rounded-full">
          <div className="absolute h-full bg-sky-900/60 rounded-l-full" style={{ width: '30%' }} />
          <div className="absolute h-full bg-emerald-900/40" style={{ left: '45%', width: '30%' }} />
          <div className="absolute h-full bg-red-900/60 rounded-r-full" style={{ left: '80%', width: '20%' }} />
          <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-zinc-100 bg-zinc-900 -translate-x-1/2 transition-all"
            style={{ left: `${Math.min(99, stock.rsi)}%` }} />
        </div>
      </div>

      {/* VCP Section */}
      {stock.vcp_score !== undefined && (
        <div className={`mb-3 p-3 rounded-lg border ${stock.vcp_is_vcp ? 'border-emerald-800 bg-emerald-950/20' : 'border-zinc-800 bg-zinc-900/30'}`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-zinc-500 uppercase tracking-widest">VCP 타점 분석</span>
              {stock.vcp_is_vcp && (
                <span className="text-[9px] bg-emerald-900 text-emerald-300 border border-emerald-700 px-1.5 py-0.5 rounded">VCP 감지</span>
              )}
              {stock.pivot_broken && stock.pivot_within_chase && (
                <span className="text-[9px] bg-amber-900 text-amber-300 border border-amber-700 px-1.5 py-0.5 rounded">피봇 돌파 ✓</span>
              )}
            </div>
            <span className={`text-sm font-semibold font-mono ${(stock.vcp_score ?? 0) >= 60 ? 'text-emerald-400' : (stock.vcp_score ?? 0) >= 40 ? 'text-amber-400' : 'text-zinc-500'}`}>
              {stock.vcp_score ?? 0}점
            </span>
          </div>
          <div className="h-1 bg-zinc-800 rounded-full overflow-hidden mb-2">
            <div className="h-full rounded-full transition-all" style={{ width: `${stock.vcp_score ?? 0}%`, background: (stock.vcp_score ?? 0) >= 60 ? '#10b981' : (stock.vcp_score ?? 0) >= 40 ? '#f59e0b' : '#52525b' }} />
          </div>
          <div className="grid grid-cols-3 gap-2 text-[10px] text-zinc-500 mb-2">
            <span>수렴 <span className="text-zinc-300">{stock.vcp_contraction_count ?? 0}회</span></span>
            <span>베이스 <span className="text-zinc-300">{stock.vcp_base_weeks ?? 0}주</span></span>
            <span>조정폭 <span className="text-zinc-300">{stock.vcp_last_pullback ?? 0}%</span></span>
            <span>저거래량 <span className={stock.vcp_lowest_vol ? 'text-emerald-400' : 'text-red-400'}>{stock.vcp_lowest_vol ? '✓ 확인' : '✕ 미확인'}</span></span>
            <span>피봇가 <span className="text-zinc-300">{stock.vcp_pivot ? `$${stock.vcp_pivot}` : '-'}</span></span>
            <span>피봇거리 <span className={stock.pivot_within_chase ? 'text-emerald-400' : 'text-zinc-400'}>{stock.pivot_broken ? `+${stock.pivot_dist}%` : '미돌파'}</span></span>
          </div>
          <p className="text-[10px] text-zinc-600" style={{ fontFamily: 'system-ui, sans-serif' }}>{stock.vcp_detail ?? ''}</p>
        </div>
      )}

      {/* Summary */}
      <p className="text-xs text-zinc-400 leading-relaxed mb-3" style={{ fontFamily: 'system-ui, sans-serif' }}>
        {stock.summary}
      </p>

      {/* Caution */}
      {stock.caution && (
        <div className="text-xs text-amber-400 bg-amber-950/30 border-l-2 border-amber-600 pl-3 py-2 rounded-r-md mb-3"
          style={{ fontFamily: 'system-ui, sans-serif' }}>
          ⚡ {stock.caution}
        </div>
      )}

      {/* Price levels */}
      <div className="flex flex-wrap gap-2">
        {stock.entry_zone    && <LvPill label="진입" val={stock.entry_zone}    c="text-emerald-300 border-emerald-800 bg-emerald-950/40" />}
        {stock.key_support   && <LvPill label="지지" val={stock.key_support}   c="text-sky-300     border-sky-800     bg-sky-950/40" />}
        {stock.key_resistance && <LvPill label="저항" val={stock.key_resistance} c="text-purple-300  border-purple-800  bg-purple-950/40" />}
        {stock.stop_loss     && <LvPill label="손절" val={stock.stop_loss}     c="text-red-300     border-red-800     bg-red-950/40" />}
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

function IndBox({ label, value, color, sub }: { label: string; value: string | number; color: string; sub: string }) {
  return (
    <div className="text-center">
      <div className="text-[9px] text-zinc-600 uppercase tracking-widest mb-0.5">{label}</div>
      <div className={`text-sm font-semibold font-mono ${color}`}>{value}</div>
      <div className="text-[9px] text-zinc-600">{sub}</div>
    </div>
  );
}

function LvPill({ label, val, c }: { label: string; val: string; c: string }) {
  return <span className={`text-xs px-2 py-1 border rounded-md ${c}`}>{label} {val}</span>;
}
