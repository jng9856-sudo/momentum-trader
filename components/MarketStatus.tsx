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

// 🆕 매크로 이벤트 타입
interface MacroEvent {
  id: string;
  type: 'FOMC' | 'CPI' | 'NFP' | 'PCE' | 'GDP';
  title: string;
  date: string;
  time: string;
  impact: 'HIGH' | 'MEDIUM';
  description: string;
  daysUntil?: number;
  isUrgent?: boolean;
  isPast?: boolean;
}
interface MacroData {
  events: MacroEvent[];
  nextUrgent: MacroEvent | null;
  nextHigh: MacroEvent | null;
  highWithin7: number;
  buyWarning: boolean;
  analyzed_at: string;
}

const CONDITION_STYLE = {
  GO:      { bar: '#10b981', text: 'text-emerald-400', bg: 'bg-emerald-950/40 border-emerald-800', label: '✅ 매수 가능 구간' },
  CAUTION: { bar: '#f59e0b', text: 'text-amber-400',   bg: 'bg-amber-950/40 border-amber-800',   label: '⚠️ 선별적 매수' },
  STOP:    { bar: '#ef4444', text: 'text-red-400',     bg: 'bg-red-950/40 border-red-800',       label: '🚫 매수 자제' },
};
const FG_COLOR = (score: number) => score >= 65 ? '#10b981' : score >= 45 ? '#f59e0b' : '#ef4444';

// 🆕 이벤트 타입별 스타일
const EVENT_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  FOMC: { color: 'text-red-300',    bg: 'bg-red-950/40',    border: 'border-red-800' },
  CPI:  { color: 'text-orange-300', bg: 'bg-orange-950/40', border: 'border-orange-800' },
  NFP:  { color: 'text-amber-300',  bg: 'bg-amber-950/40',  border: 'border-amber-800' },
  PCE:  { color: 'text-purple-300', bg: 'bg-purple-950/40', border: 'border-purple-800' },
  GDP:  { color: 'text-sky-300',    bg: 'bg-sky-950/40',    border: 'border-sky-800' },
};

function dDayLabel(days: number | undefined): string {
  if (days === undefined) return '';
  if (days === 0) return 'D-Day';
  if (days < 0)  return `D+${Math.abs(days)}`;
  return `D-${days}`;
}

function dDayColor(days: number | undefined): string {
  if (days === undefined) return 'text-zinc-500';
  if (days <= 0) return 'text-red-400';
  if (days <= 3) return 'text-red-400';
  if (days <= 7) return 'text-amber-400';
  return 'text-zinc-400';
}

export default function MarketStatus() {
  const [data,    setData]    = useState<MarketData | null>(null);
  const [macro,   setMacro]   = useState<MacroData | null>(null);  // 🆕
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // 시장 데이터
    try {
      const cached = localStorage.getItem('mt_market_v1');
      if (cached) {
        const p = JSON.parse(cached);
        const age = Date.now() - new Date(p.analyzed_at).getTime();
        if (age < 3600000) { setData(p); setLoading(false); }
      }
    } catch {}
    fetch('/api/market')
      .then(r => r.json())
      .then(d => { setData(d); try { localStorage.setItem('mt_market_v1', JSON.stringify(d)); } catch {} })
      .catch(() => {})
      .finally(() => setLoading(false));

    // 🆕 매크로 이벤트 (14일 이내)
    try {
      const cachedMacro = localStorage.getItem('mt_macro_v1');
      if (cachedMacro) {
        const p = JSON.parse(cachedMacro);
        const age = Date.now() - new Date(p.analyzed_at).getTime();
        if (age < 3600000) { setMacro(p); return; }
      }
    } catch {}
    fetch('/api/macro?days=14')
      .then(r => r.json())
      .then(d => { setMacro(d); try { localStorage.setItem('mt_macro_v1', JSON.stringify(d)); } catch {} })
      .catch(() => {});
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
      {/* Header */}
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <span className={`text-sm font-semibold ${cs.text}`}>{cs.label}</span>
          <span className="text-xs text-zinc-500">{data.conditionDetail}</span>
          {/* 🆕 이벤트 임박 알림 배지 */}
          {macro?.buyWarning && (
            <span className="text-[9px] bg-red-950 text-red-300 border border-red-700 px-1.5 py-0.5 rounded animate-pulse">
              ⚡ 이벤트 임박
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs font-mono ${cs.text}`}>F&G {data.fearGreed.score} — {data.fearGreed.label}</span>
          <span className="text-zinc-600 text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-zinc-800/50">

          {/* 시장 지표 4개 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 mb-4">
            <div className="bg-zinc-900/60 rounded-lg p-3 text-center">
              <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">Fear & Greed</div>
              <div className="text-xl font-bold font-mono mb-0.5" style={{ color: FG_COLOR(data.fearGreed.score) }}>{data.fearGreed.score}</div>
              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden mb-1">
                <div className="h-full rounded-full" style={{ width: `${data.fearGreed.score}%`, background: FG_COLOR(data.fearGreed.score) }} />
              </div>
              <div className="text-[10px]" style={{ color: FG_COLOR(data.fearGreed.score) }}>{data.fearGreed.label}</div>
            </div>
            <div className="bg-zinc-900/60 rounded-lg p-3 text-center">
              <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">VIX 공포지수</div>
              <div className={`text-xl font-bold font-mono mb-0.5 ${data.vix === null ? 'text-zinc-500' : data.vix < 16 ? 'text-emerald-400' : data.vix < 25 ? 'text-amber-400' : 'text-red-400'}`}>{data.vix ?? '-'}</div>
              <div className={`text-[10px] ${data.vixTrend === 'RISING' ? 'text-red-400' : data.vixTrend === 'FALLING' ? 'text-emerald-400' : 'text-zinc-500'}`}>
                {data.vix === null ? '-' : data.vix < 16 ? '낮음 (안정)' : data.vix < 25 ? '보통' : '높음 (위험)'}
                {data.vixTrend === 'RISING' ? ' ▲' : data.vixTrend === 'FALLING' ? ' ▼' : ''}
              </div>
            </div>
            <div className="bg-zinc-900/60 rounded-lg p-3 text-center">
              <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">SPY 1개월</div>
              <div className={`text-xl font-bold font-mono mb-0.5 ${data.spyRet1m >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{data.spyRet1m > 0 ? '+' : ''}{data.spyRet1m}%</div>
              <div className={`text-[10px] ${data.spyAboveMA50 ? 'text-emerald-500' : 'text-red-500'}`}>{data.spyAboveMA50 ? '50일선 위 ▲' : '50일선 아래 ▼'}</div>
            </div>
            <div className="bg-zinc-900/60 rounded-lg p-3 text-center">
              <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">QQQ 1개월</div>
              <div className={`text-xl font-bold font-mono mb-0.5 ${data.qqqRet1m >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{data.qqqRet1m > 0 ? '+' : ''}{data.qqqRet1m}%</div>
              <div className="text-[10px] text-zinc-500">나스닥 모멘텀</div>
            </div>
          </div>

          {/* 매수 신호 바 */}
          <div className="flex items-center gap-3 text-xs mb-4">
            <span className="text-zinc-600 shrink-0">매수 신호:</span>
            <div className="flex gap-2">
              {(['STOP', 'CAUTION', 'GO'] as const).map(s => (
                <span key={s} className={`px-2 py-0.5 rounded text-[10px] border ${data.buyCondition === s ? CONDITION_STYLE[s].bg + ' ' + CONDITION_STYLE[s].text + ' font-semibold' : 'border-zinc-800 text-zinc-700'}`}>
                  {s === 'GO' ? '매수' : s === 'CAUTION' ? '주의' : '중단'}
                </span>
              ))}
            </div>
            <span className="text-zinc-600 text-[10px]">{new Date(data.analyzed_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 기준</span>
          </div>

          {/* 🆕 매크로 이벤트 캘린더 */}
          {macro && macro.events.length > 0 && (
            <div className="border-t border-zinc-800/50 pt-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-widest">매크로 이벤트 캘린더</span>
                  {macro.buyWarning && (
                    <span className="text-[9px] bg-red-950 text-red-300 border border-red-700 px-1.5 py-0.5 rounded">
                      ⚡ 3일 이내 이벤트
                    </span>
                  )}
                  {macro.highWithin7 > 0 && !macro.buyWarning && (
                    <span className="text-[9px] bg-amber-950 text-amber-300 border border-amber-700 px-1.5 py-0.5 rounded">
                      ⚠ 7일 이내 {macro.highWithin7}건
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-zinc-600">14일 이내 주요 지표</span>
              </div>

              {/* 이벤트 리스트 */}
              <div className="flex flex-col gap-2">
                {macro.events.map(e => {
                  const style = EVENT_STYLE[e.type] ?? EVENT_STYLE.GDP;
                  const isToday = e.daysUntil === 0;
                  const isPast  = e.isPast;
                  return (
                    <div key={e.id} className={`flex items-center justify-between px-3 py-2 rounded-lg border ${isPast ? 'border-zinc-800 bg-zinc-900/20 opacity-50' : e.isUrgent ? `${style.border} ${style.bg}` : 'border-zinc-800 bg-zinc-900/30'}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        {/* 타입 배지 */}
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${style.bg} ${style.color} border ${style.border}`}>
                          {e.type}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-xs font-medium ${isPast ? 'text-zinc-600' : 'text-zinc-300'}`}>{e.title}</span>
                            {isToday && <span className="text-[9px] bg-red-900 text-red-200 border border-red-700 px-1 py-0.5 rounded">오늘</span>}
                          </div>
                          <p className={`text-[10px] truncate ${isPast ? 'text-zinc-700' : 'text-zinc-500'}`} style={{ fontFamily: 'system-ui' }}>{e.description}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 ml-2">
                        <span className="text-[10px] text-zinc-600 font-mono">{e.time} ET</span>
                        <span className="text-[10px] text-zinc-500 font-mono">{e.date.slice(5)}</span>
                        <span className={`text-xs font-bold font-mono ${dDayColor(e.daysUntil)}`}>{dDayLabel(e.daysUntil)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 이벤트 임박 경고 메시지 */}
              {macro.nextUrgent && (
                <div className="mt-3 p-2 rounded-lg border border-red-800 bg-red-950/20">
                  <p className="text-[10px] text-red-300" style={{ fontFamily: 'system-ui' }}>
                    ⚡ <strong>{macro.nextUrgent.title}</strong> {dDayLabel(macro.nextUrgent.daysUntil)} ({macro.nextUrgent.date}) — 이벤트 전후 변동성 주의, 신규 진입 자제 권고
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
