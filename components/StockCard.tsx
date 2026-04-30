'use client';
import { StockAnalysis } from '@/types/stock';
import { useRouter } from 'next/navigation';
import EarningsBadge from '@/components/EarningsBadge';
import { useState, useEffect } from 'react';

const SIG_KO: Record<string, string> = { STRONG_BUY: '즉시매수', BUY: '매수', HOLD: '관망', SELL: '매도', STRONG_SELL: '즉시매도' };
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
function barColor(score: number) { return score >= 7 ? '#10b981' : score >= 4 ? '#f59e0b' : '#ef4444'; }

function rrColors(grade: string | null) {
  switch (grade) {
    case 'EXCELLENT': return { text: 'text-emerald-400', bg: 'bg-emerald-950', border: 'border-emerald-700', bar: '#10b981' };
    case 'GOOD':      return { text: 'text-sky-400',     bg: 'bg-sky-950',     border: 'border-sky-700',     bar: '#38bdf8' };
    case 'FAIR':      return { text: 'text-amber-400',   bg: 'bg-amber-950',   border: 'border-amber-700',   bar: '#f59e0b' };
    case 'POOR':      return { text: 'text-red-400',     bg: 'bg-red-950',     border: 'border-red-700',     bar: '#ef4444' };
    default:          return { text: 'text-zinc-500',    bg: 'bg-zinc-900',    border: 'border-zinc-700',    bar: '#71717a' };
  }
}

// 🆕 눌림목 등급 색상
function pullbackColors(grade: string | null) {
  switch (grade) {
    case 'IDEAL': return { text: 'text-emerald-300', border: 'border-emerald-600', bg: 'bg-emerald-950/30', badge: 'bg-emerald-900 text-emerald-200 border-emerald-700' };
    case 'GOOD':  return { text: 'text-sky-300',     border: 'border-sky-700',     bg: 'bg-sky-950/20',     badge: 'bg-sky-900 text-sky-200 border-sky-700' };
    case 'WEAK':  return { text: 'text-amber-300',   border: 'border-amber-700',   bg: 'bg-amber-950/20',   badge: 'bg-amber-900 text-amber-200 border-amber-700' };
    default:      return { text: 'text-zinc-400',    border: 'border-zinc-700',    bg: 'bg-zinc-900/20',    badge: 'bg-zinc-800 text-zinc-400 border-zinc-700' };
  }
}

function regimeBadgeStyle(note: string) {
  if (note.includes('🔴')) return { bg: 'bg-red-950', text: 'text-red-300', border: 'border-red-700', block: 'border-red-800 bg-red-950/30 text-red-300' };
  if (note.includes('🟠')) return { bg: 'bg-orange-950', text: 'text-orange-300', border: 'border-orange-700', block: 'border-orange-800 bg-orange-950/30 text-orange-300' };
  if (note.includes('🟡')) return { bg: 'bg-amber-950', text: 'text-amber-300', border: 'border-amber-700', block: 'border-amber-800 bg-amber-950/30 text-amber-300' };
  return { bg: 'bg-zinc-900', text: 'text-zinc-400', border: 'border-zinc-700', block: 'border-zinc-700 bg-zinc-900/30 text-zinc-400' };
}

interface EarningsInfo { earningsDate: string | null; daysUntil: number | null; epsEstimate: number | null; revenueEstimate: string | null; lastEPS: number | null; }

export default function StockCard({ stock, highlight = false, onRemove, earnings }: {
  stock: StockAnalysis; highlight?: boolean; onRemove?: (ticker: string) => void; earnings?: EarningsInfo;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rtPrice, setRtPrice] = useState<{ price: number; changePct: number; isRealtime?: boolean } | null>(null);

  useEffect(() => {
    const fetchPrice = () => fetch(`/api/realtime?tickers=${stock.ticker}`)
      .then(r => r.json())
      .then(d => { if (d.price && d.price > 0) setRtPrice({ price: d.price, changePct: d.changePct ?? 0, isRealtime: d.isRealtime }); })
      .catch(() => {});
    fetchPrice();
    const iv = setInterval(fetchPrice, 30000);
    return () => clearInterval(iv);
  }, [stock.ticker]);

  const score = Math.min(10, Math.max(1, Math.round(Number(stock.momentum_score) * 2) / 2));
  const c = sigColors(stock.signal);
  const s = stock as Record<string, unknown>;

  const regimeNote = s.regime_note as string | null ?? null;
  const regimeStyle = regimeNote ? regimeBadgeStyle(regimeNote) : null;

  const rrRatio  = s.rr_ratio  as number | null ?? null;
  const rrGrade  = s.rr_grade  as string | null ?? null;
  const rrRisk   = s.rr_risk   as number | null ?? null;
  const rrReward = s.rr_reward as number | null ?? null;
  const rrLabel  = s.rr_label  as string ?? '계산 불가';
  const rrc = rrColors(rrGrade);
  const rrBarWidth = rrRatio ? Math.min(100, (rrRatio / 5) * 100) : 0;

  // 🆕 눌림목 데이터
  // 🆕 매크로 이벤트 경고 (localStorage에서 읽기)
  const [macroWarning, setMacroWarning] = useState<{ title: string; daysUntil: number; date: string } | null>(null);
  useEffect(() => {
    try {
      const cached = localStorage.getItem('mt_macro_v1');
      if (cached) {
        const macro = JSON.parse(cached);
        if (macro.nextUrgent) setMacroWarning({ title: macro.nextUrgent.title, daysUntil: macro.nextUrgent.daysUntil, date: macro.nextUrgent.date });
      }
    } catch {}
  }, []);

  const pbIs      = s.pullback_is      as boolean ?? false;
  const pbGrade   = s.pullback_grade   as string | null ?? null;
  const pbPct     = s.pullback_pct     as number ?? 0;
  const pbSupport = s.pullback_support as string | null ?? null;
  const pbSupportPrice = s.pullback_support_price as number | null ?? null;
  const pbDistToSupport = s.pullback_dist_to_support as number ?? 0;
  const pbVolTrend = s.pullback_vol_trend as string ?? 'FLAT';
  const pbRsiCooled = s.pullback_rsi_cooled as boolean ?? false;
  const pbHigh    = s.pullback_high    as number ?? 0;
  const pbDetail  = s.pullback_detail  as string ?? '';
  const pbc = pullbackColors(pbGrade);

  return (
    <div className={`stock-card border border-zinc-800 border-l-4 ${c.border} rounded-xl bg-bg-card ${highlight ? 'ring-1 ring-emerald-500/20' : ''}`}>

      {/* ── 헤더 ── */}
      <div className="flex items-center justify-between px-4 py-3 cursor-pointer select-none" onClick={() => setOpen(o => !o)}>
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <button onClick={e => { e.stopPropagation(); router.push(`/stock/${stock.ticker}`); }}
            className="text-base font-bold text-zinc-100 hover:text-emerald-300 transition-colors shrink-0">{stock.ticker} ↗</button>
          {onRemove && (
            <button onClick={e => { e.stopPropagation(); onRemove(stock.ticker); }}
              className="w-5 h-5 flex items-center justify-center rounded-full bg-zinc-800 hover:bg-red-900 text-zinc-500 hover:text-red-400 transition-colors text-xs shrink-0">✕</button>
          )}
          {stock.rs_rank !== undefined && (
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${stock.rs_rank >= 90 ? 'bg-emerald-950 text-emerald-300 border-emerald-700' : stock.rs_rank < 10 ? 'bg-red-950 text-red-400 border-red-800' : 'bg-zinc-900 text-zinc-500 border-zinc-800'}`}>
              RS {stock.rs_rank}%{stock.rs_rank >= 90 ? ' 🏆' : ''}
            </span>
          )}
          {rtPrice && (
            <div className="flex items-center gap-1">
              <span className="text-sm font-bold text-zinc-100 font-mono">${rtPrice.price.toLocaleString()}</span>
              <span className={`text-xs font-mono ${rtPrice.changePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{rtPrice.changePct >= 0 ? '+' : ''}{rtPrice.changePct?.toFixed(2)}%</span>
              <span className={`text-[9px] px-1 py-0.5 rounded ${rtPrice.isRealtime ? 'text-emerald-600 bg-emerald-950 border border-emerald-900 animate-pulse' : 'text-zinc-600 bg-zinc-900 border border-zinc-800'}`}>{rtPrice.isRealtime ? '실시간' : '15분'}</span>
            </div>
          )}
          {stock.breakout_52w && <span className="text-[9px] bg-emerald-900 text-emerald-200 border border-emerald-700 px-1.5 py-0.5 rounded">🚀 신고가</span>}
          {stock.weekly_is_entry && <span className="text-[9px] bg-amber-900 text-amber-200 border border-amber-700 px-1.5 py-0.5 rounded">🎯 최고타점</span>}
          {stock.pead_signal && <span className="text-[9px] bg-sky-900 text-sky-200 border border-sky-700 px-1.5 py-0.5 rounded">📈 PEAD</span>}
          {/* 🆕 눌림목 배지 */}
          {pbIs && pbGrade && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded border ${pbc.badge}`}>
              {pbGrade === 'IDEAL' ? '🎯 눌림목' : pbGrade === 'GOOD' ? '📉 눌림목' : '△ 눌림목'}
            </span>
          )}
          {rrRatio !== null && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded border font-mono ${rrc.bg} ${rrc.text} ${rrc.border}`}>R/R 1:{rrRatio}</span>
          )}
          {regimeNote && regimeStyle && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded border ${regimeStyle.bg} ${regimeStyle.text} ${regimeStyle.border}`}>{regimeNote.split('—')[0].trim()}</span>
          )}
          {/* 🆕 매크로 이벤트 임박 배지 — 매수 신호 종목만 */}
          {macroWarning && stock.signal.includes('BUY') && (
            <span className="text-[9px] bg-red-950 text-red-300 border border-red-700 px-1.5 py-0.5 rounded">
              ⚡ {macroWarning.title} D-{macroWarning.daysUntil}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-md border ${c.badge}`}>{SIG_KO[stock.signal] ?? stock.signal}</span>
          <span className="text-xs font-mono" style={{ color: barColor(score) }}>{score}</span>
          <span className="text-zinc-600 text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* ── 접힌 상태 ── */}
      {!open && (
        <div className="px-4 pb-3 border-t border-zinc-900 pt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-zinc-500">
          <span>지수RS <span className={rsClass(stock.rs_vs_index)}>{RS_KO[stock.rs_vs_index]}</span></span>
          <span>섹터RS <span className={rsClass(stock.rs_vs_sector)}>{RS_KO[stock.rs_vs_sector]}</span></span>
          <span>RSI <span className={stock.rsi > 78 ? 'text-red-400' : stock.rsi >= 45 && stock.rsi <= 72 ? 'text-emerald-400' : 'text-amber-400'}>{stock.rsi}</span></span>
          <span>MACD <span className={stock.macd_histogram > 0 ? 'text-emerald-400' : 'text-red-400'}>{stock.macd_histogram > 0 ? '▲상승' : '▼하락'}</span></span>
          <span>거래량 <span className={stock.volume_ratio > 1.5 ? 'text-emerald-400' : 'text-zinc-400'}>{stock.volume_ratio}x</span></span>
          <span className={stock.ma50_status === 'ABOVE' ? 'text-emerald-400' : 'text-red-400'}>{MA_KO[stock.ma50_status]}</span>
          {pbIs && <span>눌림목 <span className={pbc.text}>{Math.abs(pbPct)}% 조정{pbSupport ? ` → ${pbSupport}` : ''}</span></span>}
          {rrRatio !== null && <span>R/R <span className={rrc.text}>1:{rrRatio}</span></span>}
          {stock.entry_zone && <span>진입 <span className="text-emerald-400 font-mono">{stock.entry_zone}</span></span>}
          {stock.stop_loss  && <span>손절 <span className="text-red-400 font-mono">{stock.stop_loss}</span></span>}
          {regimeNote && regimeStyle && <span className={regimeStyle.text}>{regimeNote}</span>}
          {/* 🆕 접힌 상태 매크로 경고 */}
          {macroWarning && stock.signal.includes('BUY') && (
            <span className="text-red-400">⚡ {macroWarning.title} D-{macroWarning.daysUntil} — 진입 주의</span>
          )}
        </div>
      )}

      {/* ── 펼친 상태 ── */}
      {open && (
        <div className="px-5 pb-5 border-t border-zinc-900 pt-4">

          {earnings && <div className="mb-3"><EarningsBadge info={earnings} /></div>}

          {/* 시장 국면 경고 */}
          {regimeNote && regimeStyle && (
            <div className={`mb-4 p-3 rounded-lg border ${regimeStyle.block}`}>
              <span className="text-[10px] uppercase tracking-widest opacity-70">시장 국면 필터</span>
              <p className="text-xs font-semibold mt-0.5" style={{ fontFamily: 'system-ui' }}>{regimeNote}</p>
            </div>
          )}

          {/* 🆕 매크로 이벤트 경고 블록 */}
          {macroWarning && stock.signal.includes('BUY') && (
            <div className="mb-4 p-3 rounded-lg border border-red-800 bg-red-950/20">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] text-zinc-500 uppercase tracking-widest">매크로 이벤트 경고</span>
                <span className="text-[9px] bg-red-900 text-red-300 border border-red-700 px-1.5 py-0.5 rounded">D-{macroWarning.daysUntil}</span>
              </div>
              <p className="text-xs text-red-300 font-semibold" style={{ fontFamily: 'system-ui' }}>
                ⚡ {macroWarning.title} ({macroWarning.date}) — 이벤트 전 신규 진입 자제 권고
              </p>
              <p className="text-[10px] text-zinc-500 mt-1" style={{ fontFamily: 'system-ui' }}>
                FOMC/CPI/NFP 등 주요 지표 발표 전후 변동성이 크게 확대될 수 있습니다. 기존 포지션 손절 라인 재확인 권장.
              </p>
            </div>
          )}

          {/* 🆕 눌림목 분석 블록 */}
          {pbIs && (
            <div className={`mb-4 p-3 rounded-lg border ${pbc.border} ${pbc.bg}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-widest">눌림목 분석</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded border ${pbc.badge}`}>
                    {pbGrade === 'IDEAL' ? '🎯 이상적' : pbGrade === 'GOOD' ? '✓ 양호' : '△ 약함'}
                  </span>
                </div>
                <span className={`text-xs font-bold font-mono ${pbc.text}`}>
                  고점 대비 {Math.abs(pbPct)}% 조정
                </span>
              </div>

              {/* 눌림목 진행 바 (0% ~ -20%) */}
              <div className="mb-2">
                <div className="flex justify-between text-[9px] text-zinc-600 mb-1">
                  <span>얕음 (-3%)</span>
                  <span className="text-emerald-700">적정 (-5~-10%)</span>
                  <span>깊음 (-20%)</span>
                </div>
                <div className="relative h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="absolute h-full bg-emerald-900/50 rounded-full" style={{ left: '15%', width: '40%' }} />
                  <div className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full border-2 border-zinc-100 bg-zinc-900 -translate-x-1/2"
                    style={{ left: `${Math.min(99, Math.abs(pbPct) / 20 * 100)}%` }} />
                </div>
              </div>

              {/* 핵심 지표 3개 */}
              <div className="grid grid-cols-3 gap-2 text-[10px] mb-2">
                <div className="text-center">
                  <div className="text-zinc-600 mb-0.5">근접 지지선</div>
                  <div className={`font-semibold ${pbc.text}`}>{pbSupport ?? '없음'}</div>
                  {pbSupportPrice && <div className="text-zinc-600 font-mono">${pbSupportPrice}</div>}
                </div>
                <div className="text-center">
                  <div className="text-zinc-600 mb-0.5">지지까지 거리</div>
                  <div className={`font-semibold ${pbDistToSupport <= 2 ? 'text-emerald-400' : 'text-zinc-400'}`}>
                    {pbDistToSupport > 0 ? `+${pbDistToSupport}%` : '도달'}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-zinc-600 mb-0.5">기준 고점</div>
                  <div className="text-zinc-300 font-mono">${pbHigh}</div>
                </div>
              </div>

              {/* 눌림목 품질 체크리스트 */}
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9px]">
                <span className={pbVolTrend === 'DECLINING' ? 'text-emerald-400' : pbVolTrend === 'RISING' ? 'text-red-400' : 'text-zinc-500'}>
                  {pbVolTrend === 'DECLINING' ? '✓ 거래량 감소' : pbVolTrend === 'RISING' ? '✕ 거래량 증가' : '— 거래량 보합'}
                </span>
                <span className={pbRsiCooled ? 'text-emerald-400' : 'text-zinc-500'}>
                  {pbRsiCooled ? '✓ RSI 냉각' : '— RSI 미냉각'}
                </span>
                <span className={pbSupport ? 'text-emerald-400' : 'text-zinc-500'}>
                  {pbSupport ? `✓ MA 지지 확인 (${pbSupport})` : '— MA 지지 없음'}
                </span>
              </div>

              <p className="text-[10px] text-zinc-500 mt-2" style={{ fontFamily: 'system-ui' }}>{pbDetail}</p>
            </div>
          )}

          {/* R/R 비율 */}
          {rrRatio !== null && (
            <div className={`mb-4 p-3 rounded-lg border ${rrc.border} ${rrc.bg}/20`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-widest">리스크 / 리워드 (R/R)</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded border ${rrc.bg} ${rrc.text} ${rrc.border}`}>
                    {rrGrade === 'EXCELLENT' ? '최상 🏆' : rrGrade === 'GOOD' ? '양호 ✓' : rrGrade === 'FAIR' ? '보통' : '불리 ✗'}
                  </span>
                </div>
                <span className={`text-sm font-bold font-mono ${rrc.text}`}>1 : {rrRatio}</span>
              </div>
              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden mb-2">
                <div className="h-full rounded-full transition-all" style={{ width: `${rrBarWidth}%`, background: rrc.bar }} />
              </div>
              <div className="grid grid-cols-3 gap-2 text-[10px]">
                <div className="text-center"><div className="text-zinc-600 mb-0.5">리스크</div><div className="text-red-400 font-mono font-semibold">${rrRisk}</div></div>
                <div className="text-center"><div className="text-zinc-600 mb-0.5">비율</div><div className={`font-mono font-semibold ${rrc.text}`}>{rrLabel.split('(')[0].trim()}</div></div>
                <div className="text-center"><div className="text-zinc-600 mb-0.5">리워드</div><div className="text-emerald-400 font-mono font-semibold">${rrReward}</div></div>
              </div>
              <div className="mt-2 flex gap-3 text-[9px] text-zinc-600 justify-center">
                <span className="text-red-700">1:1↓ 불리</span><span className="text-amber-700">1:2 최소</span><span className="text-sky-700">1:3 양호</span><span className="text-emerald-700">1:5 최상</span>
              </div>
            </div>
          )}

          {/* 모멘텀 바 */}
          <div className="mb-3">
            <div className="flex justify-between text-xs text-zinc-500 mb-1.5"><span>모멘텀 강도</span><span className="font-semibold" style={{ color: c.bar }}>{score} / 10</span></div>
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${score * 10}%`, background: c.bar }} /></div>
          </div>

          {/* 4개 핵심 지표 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <Metric label="지수 RS"><span className={`text-sm font-medium ${rsClass(stock.rs_vs_index)}`}>{RS_KO[stock.rs_vs_index]}</span></Metric>
            <Metric label="섹터 RS"><span className={`text-sm font-medium ${rsClass(stock.rs_vs_sector)}`}>{RS_KO[stock.rs_vs_sector]}</span></Metric>
            <Metric label="이동평균"><span className={`text-sm font-medium ${stock.ma50_status === 'ABOVE' ? 'text-emerald-400' : stock.ma50_status === 'BELOW' ? 'text-red-400' : 'text-zinc-400'}`}>{MA_KO[stock.ma50_status]}</span></Metric>
            <Metric label="패턴"><span className="text-sm font-medium text-zinc-300">{PT_KO[stock.pattern]}</span></Metric>
          </div>

          {/* 확장 지표 */}
          <div className="grid grid-cols-5 gap-2 mb-4 p-3 bg-zinc-900/50 rounded-lg">
            <IndBox label="RSI(14)" val={stock.rsi} color={stock.rsi > 78 ? 'text-red-400' : stock.rsi < 35 ? 'text-sky-400' : 'text-emerald-400'} sub={stock.rsi > 78 ? '과열' : stock.rsi < 35 ? '침체' : '정상'} />
            <IndBox label="MACD" val={stock.macd_histogram} color={stock.macd_histogram > 0 ? 'text-emerald-400' : 'text-red-400'} sub={stock.macd_histogram > 0 ? '상승' : '하락'} />
            <IndBox label="거래량" val={`${stock.volume_ratio}x`} color={stock.volume_ratio > 1.5 ? 'text-emerald-400' : stock.volume_ratio < 0.7 ? 'text-red-400' : 'text-zinc-400'} sub={stock.volume_ratio > 1.5 ? '강함' : '보통'} />
            <IndBox label="BB위치" val={`${stock.bb_position}%`} color={stock.bb_position > 80 ? 'text-amber-400' : 'text-zinc-400'} sub={stock.bb_position > 80 ? '상단' : '중간'} />
            <IndBox label="ATR%" val={`${stock.atr_pct}%`} color="text-zinc-400" sub="변동성" />
          </div>

          {/* RSI 바 */}
          <div className="mb-4">
            <div className="flex justify-between text-[10px] text-zinc-600 mb-1"><span>RSI</span><span className="flex gap-3"><span className="text-sky-700">침체30</span><span className="text-emerald-700">정상45–75</span><span className="text-red-700">과열80</span></span></div>
            <div className="relative h-1.5 bg-zinc-800 rounded-full">
              <div className="absolute h-full bg-sky-900/60 rounded-l-full" style={{ width: '30%' }} />
              <div className="absolute h-full bg-emerald-900/40" style={{ left: '45%', width: '30%' }} />
              <div className="absolute h-full bg-red-900/60 rounded-r-full" style={{ left: '80%', width: '20%' }} />
              <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-zinc-100 bg-zinc-900 -translate-x-1/2 transition-all" style={{ left: `${Math.min(99, stock.rsi)}%` }} />
            </div>
          </div>

          {/* 52w 신고가 */}
          {stock.breakout_52w && (
            <div className="mb-3 p-3 rounded-lg border border-emerald-600 bg-emerald-950/30">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-emerald-300">{stock.breakout_52w_day === 0 ? '🚀 오늘 52주 신고가 돌파!' : '어제 52주 신고가 돌파 — 추격 기회'}</span>
                {stock.breakout_52w_vol && <span className="text-[9px] bg-emerald-900 text-emerald-200 border border-emerald-700 px-1.5 py-0.5 rounded">거래량 ✓</span>}
              </div>
              <p className="text-[10px] text-zinc-400" style={{ fontFamily: 'system-ui' }}>{stock.breakout_52w_detail}</p>
            </div>
          )}

          {/* PEAD */}
          {stock.pead_signal && (
            <div className="mb-3 p-3 rounded-lg border border-sky-800 bg-sky-950/20">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] text-zinc-500 uppercase tracking-widest">PEAD 어닝 드리프트</span>
                <span className="text-[9px] bg-sky-900 text-sky-300 border border-sky-700 px-1.5 py-0.5 rounded">서프라이즈 +{stock.pead_surprise_pct}%</span>
              </div>
              <p className="text-[10px] text-zinc-500" style={{ fontFamily: 'system-ui' }}>{stock.pead_detail}</p>
            </div>
          )}

          {/* 섹터 경고 */}
          {stock.sector_warning && (
            <div className="mb-3 p-2 rounded-lg border border-amber-800 bg-amber-950/20">
              <p className="text-[10px] text-amber-400" style={{ fontFamily: 'system-ui' }}>⚠ {stock.sector_warning}</p>
            </div>
          )}

          {/* 주봉 멀티 타임프레임 */}
          {stock.weekly_trend && (
            <div className={`mb-3 p-3 rounded-lg border ${stock.weekly_is_entry ? 'border-emerald-600 bg-emerald-950/30' : stock.weekly_trend === 'UPTREND' ? 'border-emerald-900 bg-emerald-950/10' : stock.weekly_trend === 'DOWNTREND' ? 'border-red-900 bg-red-950/10' : 'border-zinc-800 bg-zinc-900/20'}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-widest">주봉 멀티 타임프레임</span>
                  {stock.weekly_is_entry && <span className="text-[9px] bg-emerald-800 text-emerald-200 border border-emerald-600 px-1.5 py-0.5 rounded font-semibold">🎯 최고 타점</span>}
                </div>
                <span className={`text-xs font-semibold ${stock.weekly_trend === 'UPTREND' ? 'text-emerald-400' : stock.weekly_trend === 'DOWNTREND' ? 'text-red-400' : 'text-zinc-400'}`}>
                  {stock.weekly_align_score ?? '-'}/10 {stock.weekly_trend === 'UPTREND' ? '▲ 주봉 상승' : stock.weekly_trend === 'DOWNTREND' ? '▼ 주봉 하락' : '— 횡보'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[10px] text-zinc-500">
                <span>MA 정렬 <span className={stock.weekly_above_mas ? 'text-emerald-400' : 'text-red-400'}>{stock.weekly_above_mas ? '✓ 완성' : '✕ 미완성'}</span></span>
                <span>주봉 RSI <span className="text-zinc-300">{stock.weekly_rsi ?? '-'}</span></span>
                <span>눌림폭 <span className={stock.weekly_pullback && stock.weekly_pullback >= -8 && stock.weekly_pullback <= -2 ? 'text-emerald-400' : 'text-zinc-400'}>{stock.weekly_pullback ? `${stock.weekly_pullback}%` : '-'}</span></span>
              </div>
            </div>
          )}

          {/* OBV */}
          {stock.obv_trend !== undefined && (
            <div className={`mb-3 p-3 rounded-lg border ${stock.obv_divergence ? 'border-red-800 bg-red-950/20' : stock.obv_trend === 'UP' ? 'border-emerald-900 bg-emerald-950/10' : 'border-zinc-800 bg-zinc-900/30'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-zinc-500 uppercase tracking-widest">OBV 기관 매집 분석</span>
                <span className={`text-xs font-semibold font-mono ${stock.obv_trend === 'UP' ? 'text-emerald-400' : stock.obv_trend === 'DOWN' ? 'text-red-400' : 'text-zinc-400'}`}>
                  {stock.obv_trend === 'UP' ? '▲ 매집' : stock.obv_trend === 'DOWN' ? '▼ 분산' : '— 중립'}
                </span>
              </div>
              <p className="text-[10px] text-zinc-500" style={{ fontFamily: 'system-ui' }}>{stock.obv_detail ?? ''}</p>
            </div>
          )}

          {/* 공매도 */}
          {stock.short_pct !== undefined && stock.short_pct !== null && (
            <div className={`mb-3 p-3 rounded-lg border ${stock.short_squeeze === 'HIGH' ? 'border-amber-800 bg-amber-950/20' : 'border-zinc-800 bg-zinc-900/20'}`}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-widest">공매도 현황</span>
                  {stock.short_squeeze === 'HIGH' && <span className="text-[9px] bg-amber-900 text-amber-300 border border-amber-700 px-1.5 py-0.5 rounded">숏스퀴즈 주의 ⚡</span>}
                </div>
                <span className={`text-xs font-mono ${stock.short_pct > 20 ? 'text-red-400' : stock.short_pct > 10 ? 'text-amber-400' : 'text-zinc-400'}`}>
                  {stock.short_pct}% {stock.short_ratio && `/ ${stock.short_ratio}일`}
                </span>
              </div>
              <p className="text-[10px] text-zinc-500" style={{ fontFamily: 'system-ui' }}>{stock.short_detail ?? ''}</p>
            </div>
          )}

          {/* VCP */}
          {stock.vcp_score !== undefined && (
            <div className={`mb-3 p-3 rounded-lg border ${stock.vcp_is_vcp ? 'border-emerald-800 bg-emerald-950/20' : 'border-zinc-800 bg-zinc-900/30'}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-widest">VCP 타점 분석</span>
                  {stock.vcp_is_vcp && <span className="text-[9px] bg-emerald-900 text-emerald-300 border border-emerald-700 px-1.5 py-0.5 rounded">VCP 감지</span>}
                  {stock.pivot_broken && stock.pivot_within_chase && <span className="text-[9px] bg-amber-900 text-amber-300 border border-amber-700 px-1.5 py-0.5 rounded">피봇 돌파 ✓</span>}
                </div>
                <span className={`text-sm font-semibold font-mono ${(stock.vcp_score ?? 0) >= 60 ? 'text-emerald-400' : (stock.vcp_score ?? 0) >= 40 ? 'text-amber-400' : 'text-zinc-500'}`}>{stock.vcp_score ?? 0}점</span>
              </div>
              <div className="h-1 bg-zinc-800 rounded-full overflow-hidden mb-2">
                <div className="h-full rounded-full" style={{ width: `${stock.vcp_score ?? 0}%`, background: (stock.vcp_score ?? 0) >= 60 ? '#10b981' : (stock.vcp_score ?? 0) >= 40 ? '#f59e0b' : '#52525b' }} />
              </div>
              <div className="grid grid-cols-3 gap-2 text-[10px] text-zinc-500 mb-1">
                <span>수렴 <span className="text-zinc-300">{stock.vcp_contraction_count ?? 0}회</span></span>
                <span>베이스 <span className="text-zinc-300">{stock.vcp_base_weeks ?? 0}주</span></span>
                <span>조정폭 <span className="text-zinc-300">{stock.vcp_last_pullback ?? 0}%</span></span>
                <span>저거래량 <span className={stock.vcp_lowest_vol ? 'text-emerald-400' : 'text-red-400'}>{stock.vcp_lowest_vol ? '✓ 확인' : '✕ 미확인'}</span></span>
                <span>피봇가 <span className="text-zinc-300">{stock.vcp_pivot ? `$${stock.vcp_pivot}` : '-'}</span></span>
                <span>피봇거리 <span className={stock.pivot_within_chase ? 'text-emerald-400' : 'text-zinc-400'}>{stock.pivot_broken ? `+${stock.pivot_dist}%` : '미돌파'}</span></span>
              </div>
              <p className="text-[10px] text-zinc-600" style={{ fontFamily: 'system-ui' }}>{stock.vcp_detail ?? ''}</p>
            </div>
          )}

          {/* 요약 */}
          <p className="text-xs text-zinc-400 leading-relaxed mb-3" style={{ fontFamily: 'system-ui, sans-serif' }}>{stock.summary}</p>

          {/* 주의사항 */}
          {stock.caution && (
            <div className="text-xs text-amber-400 bg-amber-950/30 border-l-2 border-amber-600 pl-3 py-2 rounded-r-md mb-3" style={{ fontFamily: 'system-ui' }}>⚡ {stock.caution}</div>
          )}

          {/* 가격 레벨 */}
          <div className="flex flex-wrap gap-2">
            {stock.entry_zone    && <LvPill label="진입" val={stock.entry_zone}      c="text-emerald-300 border-emerald-800 bg-emerald-950/40" />}
            {stock.key_support   && <LvPill label="지지" val={stock.key_support}     c="text-sky-300 border-sky-800 bg-sky-950/40" />}
            {stock.key_resistance && <LvPill label="저항" val={stock.key_resistance} c="text-purple-300 border-purple-800 bg-purple-950/40" />}
            {stock.stop_loss     && <LvPill label="손절" val={stock.stop_loss}       c="text-red-300 border-red-800 bg-red-950/40" />}
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1"><span className="text-[10px] text-zinc-600 uppercase tracking-widest">{label}</span>{children}</div>;
}
function IndBox({ label, val, color, sub }: { label: string; val: string | number; color: string; sub: string }) {
  return <div className="text-center"><div className="text-[9px] text-zinc-600 uppercase tracking-widest mb-0.5">{label}</div><div className={`text-sm font-semibold font-mono ${color}`}>{val}</div><div className="text-[9px] text-zinc-600">{sub}</div></div>;
}
function LvPill({ label, val, c }: { label: string; val: string; c: string }) {
  return <span className={`text-xs px-2 py-1 border rounded-md ${c}`}>{label} {val}</span>;
}
