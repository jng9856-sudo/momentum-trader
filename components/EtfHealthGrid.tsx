'use client';

export interface EtfItem {
  ticker:   string;
  label:    string;
  closes:   number[];
  last:     number;
  todayPct: number;
  ema10:    number;
  ema20:    number;
  trend:    string;
}

const TREND_MAP: Record<string, { text: string; color: string }> = {
  strong_up:  { text: 'Price > EMA10 > EMA20  강한 상승추세', color: '#10b981' },
  decent_up:  { text: 'Price > EMA20  상승추세',              color: '#34d399' },
  down:       { text: 'EMA 하회  단기 하락',                  color: '#f87171' },
  major_down: { text: 'EMA 크게 하회  하락추세',              color: '#ef4444' },
};

function Sparkline({ closes, trend }: { closes: number[]; trend: string }) {
  const W = 136, H = 44;
  if (!closes || closes.length < 2) return <svg width={W} height={H} />;

  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const rng = max - min || 1;
  const pad = 2;

  const pts = closes.map((c, i) => {
    const x = pad + (i / (closes.length - 1)) * (W - pad * 2);
    const y = H - pad - ((c - min) / rng) * (H - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const color = trend === 'strong_up' ? '#10b981' : trend === 'decent_up' ? '#34d399' : trend === 'major_down' ? '#ef4444' : '#f87171';

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function EtfHealthGrid({ etfData }: { etfData: EtfItem[] }) {
  if (!etfData || etfData.length === 0) return null;

  return (
    <div className="mt-4 border-t border-zinc-800/50 pt-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] text-zinc-500 uppercase tracking-widest">주요 지수 / ETF 건강도</span>
        <span className="text-[10px] text-zinc-700">EMA10 · EMA20 기준</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {etfData.map(etf => {
          const tl = TREND_MAP[etf.trend] ?? TREND_MAP.down;
          return (
            <div key={etf.ticker} className="bg-zinc-900/60 rounded-lg p-2.5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-zinc-100 font-mono">{etf.ticker}</span>
                <span className={`text-[10px] font-mono font-semibold ${etf.todayPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {etf.todayPct >= 0 ? '+' : ''}{etf.todayPct.toFixed(2)}%
                </span>
              </div>
              <div className="text-[9px] text-zinc-600 mb-1.5">{etf.label}</div>
              <Sparkline closes={etf.closes} trend={etf.trend} />
              <div className="mt-1.5 text-[9px] truncate leading-tight" style={{ color: tl.color }}>
                {tl.text}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

