'use client';
import { useState, useEffect, useCallback } from 'react';
import { StockAnalysis } from '@/types/stock';

interface ChartData {
  ticker:     string;
  closes:     number[];
  ema10:      number[];
  ema20:      number[];
  last:       number;
  todayPct:   number;
  trend:      string;
}

type CategoryKey = 'breakout' | 'strong_buy' | 'buy' | 'high_rs';
const CATEGORIES: { key: CategoryKey; label: string; desc: string }[] = [
  { key: 'breakout',   label: '52주 신고가',   desc: '최근 돌파 종목' },
  { key: 'strong_buy', label: '즉시매수',      desc: 'STRONG_BUY 신호' },
  { key: 'buy',        label: '매수',          desc: 'BUY 신호 + RS 상위' },
  { key: 'high_rs',    label: 'RS 90%↑',       desc: '상대강도 최상위' },
];

type RangeKey = '1mo' | '3mo' | '6mo';
const RANGES: { key: RangeKey; label: string }[] = [
  { key: '1mo', label: '1개월' },
  { key: '3mo', label: '3개월' },
  { key: '6mo', label: '6개월' },
];

const TREND_TEXT: Record<string, { label: string; color: string }> = {
  strong_up:  { label: 'EMA10 > EMA20  강한 상승추세', color: '#10b981' },
  decent_up:  { label: 'EMA20 위  상승추세',           color: '#34d399' },
  down:       { label: 'EMA 하회  조정 중',             color: '#f87171' },
  major_down: { label: 'EMA 크게 하회  하락',           color: '#ef4444' },
};

function MiniSparkline({ closes, ema10, ema20, trend }: { closes: number[]; ema10: number[]; ema20: number[]; trend: string }) {
  const W = 200, H = 80;
  if (!closes || closes.length < 2) return <div style={{ width: W, height: H, background: '#09090b', borderRadius: 4 }} />;

  const allVals = [...closes, ...ema10, ...ema20].filter(Boolean);
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const rng = max - min || 1;
  const pad = { x: 4, y: 6 };

  function toPath(arr: number[]): string {
    return arr.map((v, i) => {
      const x = pad.x + (i / (arr.length - 1)) * (W - pad.x * 2);
      const y = H - pad.y - ((v - min) / rng) * (H - pad.y * 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }

  const lineColor = trend === 'strong_up' ? '#10b981' : trend === 'decent_up' ? '#34d399' : trend === 'major_down' ? '#ef4444' : '#f87171';

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      <path d={toPath(closes)} fill="none" stroke={lineColor} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <path d={toPath(ema10)}  fill="none" stroke="#f87171"  strokeWidth="1" strokeDasharray="none" opacity="0.8" />
      <path d={toPath(ema20)}  fill="none" stroke="#4ade80"  strokeWidth="1" opacity="0.7" />
    </svg>
  );
}

function filterTickers(stocks: StockAnalysis[], category: CategoryKey): string[] {
  switch (category) {
    case 'breakout':
      return stocks
        .filter(s => s.breakout_52w)
        .sort((a, b) => Number(b.momentum_score) - Number(a.momentum_score))
        .slice(0, 18).map(s => s.ticker);
    case 'strong_buy':
      return stocks
        .filter(s => s.signal === 'STRONG_BUY')
        .sort((a, b) => Number(b.momentum_score) - Number(a.momentum_score))
        .slice(0, 18).map(s => s.ticker);
    case 'buy':
      return stocks
        .filter(s => s.signal === 'BUY' || s.signal === 'STRONG_BUY')
        .sort((a, b) => Number(b.momentum_score) - Number(a.momentum_score))
        .slice(0, 18).map(s => s.ticker);
    case 'high_rs':
      return stocks
        .filter(s => (s.rs_rank ?? 0) >= 90)
        .sort((a, b) => (b.rs_rank ?? 0) - (a.rs_rank ?? 0))
        .slice(0, 18).map(s => s.ticker);
    default:
      return [];
  }
}

export default function MiniChartGrid({ stocks }: { stocks: StockAnalysis[] }) {
  const [category, setCategory] = useState<CategoryKey>('breakout');
  const [range,    setRange]    = useState<RangeKey>('3mo');
  const [charts,   setCharts]   = useState<ChartData[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [perRow,   setPerRow]   = useState(6);

  const tickers = filterTickers(stocks, category);

  const loadCharts = useCallback(async () => {
    if (tickers.length === 0) { setCharts([]); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/chart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers, range }),
      });
      if (res.ok) {
        const d = await res.json();
        setCharts(d.charts ?? []);
      }
    } catch {}
    setLoading(false);
  }, [tickers.join(','), range]);

  useEffect(() => { loadCharts(); }, [loadCharts]);

  if (stocks.length === 0) return null;

  const catInfo = CATEGORIES.find(c => c.key === category)!;

  return (
    <div className="mb-6 p-4 border border-zinc-800 rounded-xl bg-zinc-900/40">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <div className="text-sm font-semibold text-zinc-100">{catInfo.label} 차트 그리드</div>
          <div className="text-[10px] text-zinc-500 mt-0.5">{catInfo.desc} · EMA10 <span className="text-red-400">빨강</span> · EMA20 <span className="text-emerald-400">초록</span></div>
        </div>
        <div className="flex gap-1 flex-wrap">
          {/* 종목당 열 수 */}
          <div className="flex border border-zinc-800 rounded-lg overflow-hidden mr-1">
            {([4, 6] as const).map(n => (
              <button key={n} onClick={() => setPerRow(n)}
                className={`text-xs px-2.5 py-1 transition-colors ${perRow === n ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>
                {n}열
              </button>
            ))}
          </div>
          {/* 기간 */}
          {RANGES.map(r => (
            <button key={r.key} onClick={() => setRange(r.key)}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${range === r.key ? 'bg-zinc-700 border-zinc-600 text-zinc-100' : 'bg-transparent border-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* 카테고리 탭 */}
      <div className="flex gap-1 mb-3 flex-wrap">
        {CATEGORIES.map(c => {
          const cnt = filterTickers(stocks, c.key).length;
          return (
            <button key={c.key} onClick={() => setCategory(c.key)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${category === c.key ? 'bg-zinc-700 border-zinc-600 text-zinc-100' : 'bg-transparent border-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>
              {c.label} <span className="opacity-60">({cnt})</span>
            </button>
          );
        })}
      </div>

      {/* 로딩 */}
      {loading && (
        <div className="flex items-center gap-2 text-xs text-zinc-500 py-4">
          <div className="w-3 h-3 border border-zinc-600 border-t-emerald-500 rounded-full animate-spin" />
          차트 데이터 로딩 중...
        </div>
      )}

      {/* 차트 없음 */}
      {!loading && tickers.length === 0 && (
        <div className="text-xs text-zinc-600 py-4 text-center">해당 조건의 종목이 없습니다.</div>
      )}

      {/* 차트 그리드 */}
      {!loading && charts.length > 0 && (
        <div className={`grid gap-2`} style={{ gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))` }}>
          {charts.map(chart => {
            const stock = stocks.find(s => s.ticker === chart.ticker);
            const trendInfo = TREND_TEXT[chart.trend] ?? TREND_TEXT.down;
            return (
              <div key={chart.ticker} className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-900/60 hover:border-zinc-600 transition-colors">
                {/* 종목 헤더 */}
                <div className="px-2 pt-2 pb-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-bold text-zinc-100 font-mono">{chart.ticker}</span>
                    <span className={`text-[10px] font-mono font-semibold ${chart.todayPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {chart.todayPct >= 0 ? '+' : ''}{chart.todayPct}%
                    </span>
                  </div>
                  {stock && (
                    <div className="flex items-center gap-1 mt-0.5">
                      {stock.breakout_52w && <span className="text-[8px] bg-emerald-950 text-emerald-300 border border-emerald-800 px-1 rounded">신고가</span>}
                      {stock.pocket_pivot && <span className="text-[8px] bg-violet-950 text-violet-300 border border-violet-800 px-1 rounded">피벗</span>}
                      {(stock.rs_rank ?? 0) >= 90 && <span className="text-[8px] bg-amber-950 text-amber-300 border border-amber-800 px-1 rounded">RS{stock.rs_rank}%</span>}
                    </div>
                  )}
                </div>
                {/* 차트 */}
                <div style={{ width: '100%', overflow: 'hidden' }}>
                  <MiniSparkline
                    closes={chart.closes}
                    ema10={chart.ema10}
                    ema20={chart.ema20}
                    trend={chart.trend}
                  />
                </div>
                {/* 추세 레이블 */}
                <div className="px-2 py-1.5">
                  <div className="text-[9px] leading-tight" style={{ color: trendInfo.color }}>
                    {trendInfo.label}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 범례 */}
      {charts.length > 0 && (
        <div className="flex items-center gap-4 mt-3 text-[10px] text-zinc-600">
          <div className="flex items-center gap-1"><div className="w-3 h-px bg-emerald-500" />종목 가격</div>
          <div className="flex items-center gap-1"><div className="w-3 h-px bg-red-400" />EMA10</div>
          <div className="flex items-center gap-1"><div className="w-3 h-px bg-green-400" />EMA20</div>
        </div>
      )}
    </div>
  );
}

