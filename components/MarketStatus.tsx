'use client';
import { useState, useEffect } from 'react';

interface MarketData {
  vix: number | null;
  vixTrend: string | null;
  spyRet1m: number;
  qqqRet1m: number;
  spyAboveMA50: boolean;
  putCallProxy: number | null;
  marketBreadth: number;
  fearGreed: { score: number; label: string };
  marketCondition: 'BULL' | 'NEUTRAL' | 'BEAR';
  buyCondition: 'GO' | 'CAUTION' | 'STOP';
  conditionDetail: string;
  analyzed_at: string;
}

const CONDITION_STYLE = {
  GO:      { bar: '#10b981', text: 'text-emerald-400', bg: 'bg-emerald-950/40 border-emerald-800', label: '✅ 매수 가능 구간' },
  CAUTION: { bar: '#f59e0b', text: 'text-amber-400',   bg: 'bg-amber-950/40 border-amber-800',   label: '⚠️ 선별적 매수' },
  STOP:    { bar: '#ef4444', text: 'text-red-400',     bg: 'bg-red-950/40 border-red-800',       label: '🚫 매수 자제' },
};

const FG_COLOR = (score: number) =>
  score >= 65 ? '#10b981' : score >= 45 ? '#f59e0b' : '#ef4444';

export default function MarketStatus() {
  const [data,    setData]    = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [open,    setOpen]    = useState(true);

  useEffect(() => {
    // Try cache first
    try {
      const cached = localStorage.getItem('mt_market_v1');
      if (cached) {
        const p = JSON.parse(cached);
        const age = Date.now() - new Date(p.analyzed_at).getTime();
        if (age < 3600000) { setData(p); setLoading(false); return; }
      }
    } catch {}

    fetch('/api/market')
      .then(r => r.json())
      .then(d => {
        setData(d);
        try { localStorage.setItem('mt_market_v1', JSON.stringify(d)); } catch {}
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="mb-4 p-3 border border-zinc-800 rounded-xl bg-zinc-900/40 animate-pulse">
      <div className="h-4 bg-zinc-800 rounded w-48" />
    </div>
  );
  if (!data) return null;

  const cs = CONDITION_STYLE[data.buyCondition];

  return (
    <div className={`mb-6 border rounded-xl overflow-hidden ${cs.bg}`}>
      {/* Header — always visible */}
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <span className={`text-sm font-semibold ${cs.text}`}>{cs.label}</span>
          <span className="text-xs text-zinc-500">{data.conditionDetail}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs font-mono ${cs.text}`}>
            F&G {data.fearGreed.score} — {data.fearGreed.label}
          </span>
          <span className="text-zinc-600 text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* Expandable detail */}
      {open && (
        <div className="px-4 pb-4 border-t border-zinc-800/50">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 mb-4">
            {/* Fear & Greed */}
            <div className="bg-zinc-900/60 rounded-lg p-3 text-center">
              <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">Fear & Greed</div>
              <div className="text-xl font-bold font-mono mb-0.5" style={{ color: FG_COLOR(data.fearGreed.score) }}>
                {data.fearGreed.score}
              </div>
              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden mb-1">
                <div className="h-full rounded-full" style={{ width: `${data.fearGreed.score}%`, background: FG_COLOR(data.fearGreed.score) }} />
              </div>
              <div className="text-[10px]" style={{ color: FG_COLOR(data.fearGreed.score) }}>{data.fearGreed.label}</div>
            </div>

            {/* VIX */}
            <div className="bg-zinc-900/60 rounded-lg p-3 text-center">
              <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">VIX 공포지수</div>
              <div className={`text-xl font-bold font-mono mb-0.5 ${
                data.vix === null ? 'text-zinc-500' :
                data.vix < 16 ? 'text-emerald-400' : data.vix < 25 ? 'text-amber-400' : 'text-red-400'
              }`}>{data.vix ?? '-'}</div>
              <div className={`text-[10px] ${
                data.vixTrend === 'RISING' ? 'text-red-400' :
                data.vixTrend === 'FALLING' ? 'text-emerald-400' : 'text-zinc-500'
              }`}>
                {data.vix === null ? '-' : data.vix < 16 ? '낮음 (안정)' : data.vix < 25 ? '보통' : '높음 (위험)'}
                {data.vixTrend === 'RISING' ? ' ▲' : data.vixTrend === 'FALLING' ? ' ▼' : ''}
              </div>
            </div>

            {/* SPY momentum */}
            <div className="bg-zinc-900/60 rounded-lg p-3 text-center">
              <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">SPY 1개월</div>
              <div className={`text-xl font-bold font-mono mb-0.5 ${data.spyRet1m >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {data.spyRet1m > 0 ? '+' : ''}{data.spyRet1m}%
              </div>
              <div className={`text-[10px] ${data.spyAboveMA50 ? 'text-emerald-500' : 'text-red-500'}`}>
                {data.spyAboveMA50 ? '50일선 위 ▲' : '50일선 아래 ▼'}
              </div>
            </div>

            {/* QQQ momentum */}
            <div className="bg-zinc-900/60 rounded-lg p-3 text-center">
              <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">QQQ 1개월</div>
              <div className={`text-xl font-bold font-mono mb-0.5 ${data.qqqRet1m >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {data.qqqRet1m > 0 ? '+' : ''}{data.qqqRet1m}%
              </div>
              <div className="text-[10px] text-zinc-500">나스닥 모멘텀</div>
            </div>
          </div>

          {/* Buy condition bar */}
          <div className="flex items-center gap-3 text-xs">
            <span className="text-zinc-600 shrink-0">매수 신호:</span>
            <div className="flex gap-2">
              {(['STOP', 'CAUTION', 'GO'] as const).map(s => (
                <span key={s} className={`px-2 py-0.5 rounded text-[10px] border ${
                  data.buyCondition === s
                    ? CONDITION_STYLE[s].bg + ' ' + CONDITION_STYLE[s].text + ' font-semibold'
                    : 'border-zinc-800 text-zinc-700'
                }`}>
                  {s === 'GO' ? '매수' : s === 'CAUTION' ? '주의' : '중단'}
                </span>
              ))}
            </div>
            <span className="text-zinc-600 text-[10px]">
              {new Date(data.analyzed_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 기준
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

