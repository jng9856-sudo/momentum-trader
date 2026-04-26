'use client';
import { useState, useEffect } from 'react';

interface SectorData {
  ticker: string; name: string; group: string;
  price: number; change1d: number; ret1w: number;
  ret1m: number; ret3m: number; retYtd: number;
  volRatio: number; heatColor: string; textColor: string;
}
interface SectorResponse {
  sectors: SectorData[]; leaders: string[]; laggards: string[]; analyzed_at: string;
}

type PeriodKey = 'change1d' | 'ret1w' | 'ret1m' | 'ret3m' | 'retYtd';
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'change1d', label: '1일' },
  { key: 'ret1w',    label: '1주' },
  { key: 'ret1m',    label: '1개월' },
  { key: 'ret3m',    label: '3개월' },
  { key: 'retYtd',   label: 'YTD' },
];

function bgColor(pct: number): string {
  if (pct >= 5)  return 'rgba(6,78,59,0.9)';
  if (pct >= 3)  return 'rgba(6,95,70,0.8)';
  if (pct >= 1)  return 'rgba(22,101,52,0.7)';
  if (pct >= 0)  return 'rgba(20,83,45,0.5)';
  if (pct >= -1) return 'rgba(127,29,29,0.5)';
  if (pct >= -3) return 'rgba(153,27,27,0.7)';
  return 'rgba(69,10,10,0.9)';
}
function txtColor(pct: number): string {
  return pct >= 0 ? '#86efac' : '#fca5a5';
}

export default function SectorHeatmap() {
  const [data,    setData]    = useState<SectorResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [period,  setPeriod]  = useState<PeriodKey>('ret1m');
  const [error,   setError]   = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/sectors');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) { setError(String(e)); }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const mainSectors  = data?.sectors.filter(s => s.group === 'main')  ?? [];
  const themeSectors = data?.sectors.filter(s => s.group === 'theme') ?? [];
  const indexSectors = data?.sectors.filter(s => s.group === 'index') ?? [];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">섹터 로테이션 히트맵</div>
          {data?.analyzed_at && (
            <div className="text-[10px] text-zinc-700">{new Date(data.analyzed_at).toLocaleString('ko-KR')}</div>
          )}
        </div>
        <div className="flex gap-1 items-center">
          {PERIODS.map(p => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-colors
                ${period === p.key ? 'bg-zinc-700 border-zinc-600 text-zinc-100' : 'bg-transparent border-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>
              {p.label}
            </button>
          ))}
          <button onClick={load} disabled={loading}
            className="ml-2 text-xs px-3 py-1 rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors disabled:opacity-40">
            {loading ? '로딩...' : '↺ 새로고침'}
          </button>
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-red-950 border border-red-800 rounded-lg text-xs text-red-300">{error}</div>}

      {/* Leaders / Laggards */}
      {data && (
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="p-3 bg-emerald-950/30 border border-emerald-900/50 rounded-xl">
            <div className="text-[10px] text-emerald-600 uppercase tracking-widest mb-2">📈 자금 유입 (1개월)</div>
            <div className="flex flex-wrap gap-1.5">
              {data.leaders.map(n => <span key={n} className="text-xs text-emerald-300 bg-emerald-950 border border-emerald-800 px-2 py-0.5 rounded">{n}</span>)}
            </div>
          </div>
          <div className="p-3 bg-red-950/30 border border-red-900/50 rounded-xl">
            <div className="text-[10px] text-red-600 uppercase tracking-widest mb-2">📉 자금 이탈 (1개월)</div>
            <div className="flex flex-wrap gap-1.5">
              {data.laggards.map(n => <span key={n} className="text-xs text-red-300 bg-red-950 border border-red-800 px-2 py-0.5 rounded">{n}</span>)}
            </div>
          </div>
        </div>
      )}

      {/* Index benchmarks */}
      {indexSectors.length > 0 && (
        <div className="mb-6">
          <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2">지수 벤치마크</div>
          <div className="grid grid-cols-3 gap-2">
            {indexSectors.map(s => (
              <HeatCell key={s.ticker} sector={s} period={period} />
            ))}
          </div>
        </div>
      )}

      {/* Main sectors */}
      <div className="mb-6">
        <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2">11개 메인 섹터 (SPDR ETF)</div>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {mainSectors
            .sort((a, b) => (b[period] ?? 0) - (a[period] ?? 0))
            .map(s => <HeatCell key={s.ticker} sector={s} period={period} />)}
        </div>
      </div>

      {/* Theme sectors */}
      <div className="mb-4">
        <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2">테마 ETF</div>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {themeSectors
            .sort((a, b) => (b[period] ?? 0) - (a[period] ?? 0))
            .map(s => <HeatCell key={s.ticker} sector={s} period={period} />)}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 text-[10px] text-zinc-600 mt-4">
        <span>색상:</span>
        {[['강한상승 +5%↑','rgba(6,78,59,0.9)','#86efac'], ['상승','rgba(22,101,52,0.7)','#86efac'], ['약보합','rgba(20,83,45,0.5)','#4ade80'], ['하락','rgba(153,27,27,0.7)','#fca5a5'], ['강한하락 -3%↓','rgba(69,10,10,0.9)','#f87171']].map(([label, bg, txt]) => (
          <div key={label} className="flex items-center gap-1">
            <div className="w-3 h-3 rounded" style={{ background: bg }} />
            <span style={{ color: txt }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HeatCell({ sector: s, period }: { sector: SectorData; period: PeriodKey }) {
  const val = s[period];
  const bg  = bgColor(val);
  const tc  = txtColor(val);
  return (
    <div className="rounded-lg p-3 border border-zinc-800/50 transition-all hover:border-zinc-600"
      style={{ background: bg }}>
      <div className="text-[10px] text-zinc-400 mb-0.5">{s.ticker}</div>
      <div className="text-sm font-medium text-zinc-100 mb-1">{s.name}</div>
      <div className="text-base font-bold font-mono" style={{ color: tc }}>
        {val >= 0 ? '+' : ''}{val}%
      </div>
      <div className="text-[10px] text-zinc-600 mt-1">
        거래량 <span className={s.volRatio > 1.3 ? 'text-emerald-500' : 'text-zinc-500'}>{s.volRatio}x</span>
      </div>
    </div>
  );
}

