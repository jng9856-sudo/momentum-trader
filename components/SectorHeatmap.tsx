'use client';
import { useState, useEffect, useRef } from 'react';

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
  if (pct >= 5)  return '#064e3b';
  if (pct >= 3)  return '#065f46';
  if (pct >= 1)  return '#166534';
  if (pct >= 0)  return '#14532d80';
  if (pct >= -1) return '#7f1d1d80';
  if (pct >= -3) return '#991b1b';
  return '#450a0a';
}
function txtColor(pct: number): string {
  if (pct >= 1)  return '#86efac';
  if (pct >= 0)  return '#4ade80';
  if (pct >= -1) return '#fca5a5';
  return '#f87171';
}
function borderColor(pct: number): string {
  if (pct >= 3)  return '#10b98140';
  if (pct >= 0)  return '#16653440';
  if (pct >= -3) return '#991b1b40';
  return '#ef444440';
}

// ── 간단 트리맵 레이아웃 (Slice-and-dice) ──────────────────────────────────
interface TreemapBox {
  x: number; y: number; w: number; h: number;
  item: SectorData;
}

function computeTreemap(items: SectorData[], period: PeriodKey, W: number, H: number): TreemapBox[] {
  if (items.length === 0) return [];
  const weights = items.map(s => Math.max(0.5, Math.abs(s[period] ?? 1) + 1));
  const total   = weights.reduce((a, b) => a + b, 0);
  const boxes: TreemapBox[] = [];
  let x = 0;
  items.forEach((item, i) => {
    const w = (weights[i] / total) * W;
    boxes.push({ x, y: 0, w, h: H, item });
    x += w;
  });
  return boxes;
}

// ── 2행 트리맵 (큰 타일 위, 작은 타일 아래) ──────────────────────────────
function computeTreemap2Row(items: SectorData[], period: PeriodKey, W: number, H: number): TreemapBox[] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => Math.abs(b[period] ?? 0) - Math.abs(a[period] ?? 0));
  const big    = sorted.slice(0, Math.ceil(sorted.length / 2));
  const small  = sorted.slice(Math.ceil(sorted.length / 2));
  const H1 = H * 0.58, H2 = H - H1;
  return [
    ...computeTreemap(big,   period, W, H1).map(b => ({ ...b, h: H1 })),
    ...computeTreemap(small, period, W, H2).map(b => ({ ...b, y: H1, h: H2 })),
  ];
}

function TreemapSection({
  title, items, period, height = 200,
}: {
  title: string; items: SectorData[]; period: PeriodKey; height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [tooltip, setTooltip] = useState<{ item: SectorData; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(es => setWidth(es[0].contentRect.width));
    ro.observe(containerRef.current);
    setWidth(containerRef.current.clientWidth);
    return () => ro.disconnect();
  }, []);

  const boxes = items.length <= 6
    ? computeTreemap(items, period, width, height)
    : computeTreemap2Row(items, period, width, height);

  return (
    <div className="mb-3">
      <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">{title}</div>
      <div ref={containerRef} style={{ position: 'relative', height, background: '#09090b', borderRadius: 8, overflow: 'hidden' }}>
        {/* Treemap tiles */}
        {boxes.map(({ x, y, w, h, item }) => {
          const val  = item[period];
          const bg   = bgColor(val);
          const tc   = txtColor(val);
          const bc   = borderColor(val);
          const isSmall = w < 70 || h < 50;
          const isTiny  = w < 45 || h < 38;
          return (
            <div
              key={item.ticker}
              onMouseEnter={e => setTooltip({ item, x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setTooltip(null)}
              style={{
                position: 'absolute',
                left: x + 1, top: y + 1,
                width: w - 2, height: h - 2,
                background: bg,
                border: `1px solid ${bc}`,
                borderRadius: 4,
                overflow: 'hidden',
                cursor: 'default',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                padding: isTiny ? '2px' : '6px',
                transition: 'filter 0.15s',
              }}
            >
              {!isTiny && (
                <div style={{ fontSize: isSmall ? 9 : 11, color: '#a1a1aa', fontFamily: 'monospace', lineHeight: 1, marginBottom: 1 }}>
                  {item.ticker}
                </div>
              )}
              {!isTiny && (
                <div style={{ fontSize: isSmall ? 10 : 13, color: '#f4f4f5', fontWeight: 500, lineHeight: 1.1, textAlign: 'center', marginBottom: 2 }}>
                  {isSmall ? item.ticker : item.name}
                </div>
              )}
              <div style={{ fontSize: isTiny ? 9 : isSmall ? 12 : 16, color: tc, fontWeight: 700, fontFamily: 'monospace', lineHeight: 1 }}>
                {val >= 0 ? '+' : ''}{val}%
              </div>
              {!isSmall && (
                <div style={{ fontSize: 9, color: '#71717a', marginTop: 2 }}>
                  거래량 {item.volRatio > 1.3 ? <span style={{ color: '#4ade80' }}>{item.volRatio}x</span> : `${item.volRatio}x`}
                </div>
              )}
            </div>
          );
        })}
        {/* Tooltip */}
        {tooltip && (
          <div style={{
            position: 'fixed', left: tooltip.x + 12, top: tooltip.y - 8, zIndex: 999,
            background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8,
            padding: '8px 12px', pointerEvents: 'none', minWidth: 140,
          }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#f4f4f5', marginBottom: 4 }}>
              {tooltip.item.ticker} — {tooltip.item.name}
            </div>
            {PERIODS.map(p => (
              <div key={p.key} style={{ fontSize: 11, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ color: '#71717a' }}>{p.label}</span>
                <span style={{ color: txtColor(tooltip.item[p.key]), fontFamily: 'monospace', fontWeight: 500 }}>
                  {tooltip.item[p.key] >= 0 ? '+' : ''}{tooltip.item[p.key]}%
                </span>
              </div>
            ))}
            <div style={{ fontSize: 10, color: '#52525b', marginTop: 4 }}>거래량 {tooltip.item.volRatio}x</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SectorHeatmap() {
  const [data,    setData]    = useState<SectorResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [period,  setPeriod]  = useState<PeriodKey>('ret1m');
  const [error,   setError]   = useState('');
  const [view,    setView]    = useState<'treemap' | 'grid'>('treemap');

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
  const sorted = [...mainSectors].sort((a, b) => (b[period] ?? 0) - (a[period] ?? 0));

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">섹터 로테이션 — {view === 'treemap' ? '트리맵' : '히트맵'}</div>
          {data?.analyzed_at && <div className="text-[10px] text-zinc-700">{new Date(data.analyzed_at).toLocaleString('ko-KR')}</div>}
        </div>
        <div className="flex gap-1 flex-wrap">
          {/* 뷰 전환 */}
          <div className="flex border border-zinc-800 rounded-lg overflow-hidden mr-2">
            <button onClick={() => setView('treemap')}
              className={`text-xs px-3 py-1 transition-colors ${view === 'treemap' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>
              트리맵
            </button>
            <button onClick={() => setView('grid')}
              className={`text-xs px-3 py-1 transition-colors ${view === 'grid' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>
              그리드
            </button>
          </div>
          {/* 기간 */}
          {PERIODS.map(p => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-colors
                ${period === p.key ? 'bg-zinc-700 border-zinc-600 text-zinc-100' : 'bg-transparent border-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>
              {p.label}
            </button>
          ))}
          <button onClick={load} disabled={loading}
            className="ml-1 text-xs px-3 py-1 rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-40">
            {loading ? '로딩...' : '↺'}
          </button>
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-red-950 border border-red-800 rounded-lg text-xs text-red-300">{error}</div>}

      {/* Leaders / Laggards */}
      {data && (
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="p-3 bg-emerald-950/30 border border-emerald-900/50 rounded-xl">
            <div className="text-[10px] text-emerald-600 uppercase tracking-widest mb-2">📈 자금 유입</div>
            <div className="flex flex-wrap gap-1.5">
              {data.leaders.map(n => <span key={n} className="text-xs text-emerald-300 bg-emerald-950 border border-emerald-800 px-2 py-0.5 rounded">{n}</span>)}
            </div>
          </div>
          <div className="p-3 bg-red-950/30 border border-red-900/50 rounded-xl">
            <div className="text-[10px] text-red-600 uppercase tracking-widest mb-2">📉 자금 이탈</div>
            <div className="flex flex-wrap gap-1.5">
              {data.laggards.map(n => <span key={n} className="text-xs text-red-300 bg-red-950 border border-red-800 px-2 py-0.5 rounded">{n}</span>)}
            </div>
          </div>
        </div>
      )}

      {/* ── 트리맵 뷰 ── */}
      {view === 'treemap' && data && (
        <>
          <TreemapSection title="지수 벤치마크" items={indexSectors} period={period} height={80} />
          <TreemapSection title="11개 메인 섹터 (SPDR ETF)" items={sorted} period={period} height={220} />
          <TreemapSection title="테마 ETF" items={themeSectors} period={period} height={160} />
          <div className="text-[10px] text-zinc-700 mt-2">※ 타일 크기 = 수익률 절댓값 비례 · 마우스 오버 시 전 기간 수익률 표시</div>
        </>
      )}

      {/* ── 그리드 뷰 (기존) ── */}
      {view === 'grid' && data && (
        <>
          {indexSectors.length > 0 && (
            <div className="mb-5">
              <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2">지수 벤치마크</div>
              <div className="grid grid-cols-3 gap-2">
                {indexSectors.map(s => <HeatCell key={s.ticker} sector={s} period={period} />)}
              </div>
            </div>
          )}
          <div className="mb-5">
            <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2">11개 메인 섹터</div>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {[...mainSectors].sort((a, b) => (b[period] ?? 0) - (a[period] ?? 0)).map(s => <HeatCell key={s.ticker} sector={s} period={period} />)}
            </div>
          </div>
          <div className="mb-4">
            <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2">테마 ETF</div>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {[...themeSectors].sort((a, b) => (b[period] ?? 0) - (a[period] ?? 0)).map(s => <HeatCell key={s.ticker} sector={s} period={period} />)}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function HeatCell({ sector: s, period }: { sector: SectorData; period: PeriodKey }) {
  const val = s[period];
  return (
    <div className="rounded-lg p-3 border border-zinc-800/50 hover:border-zinc-600 transition-all"
      style={{ background: bgColor(val) }}>
      <div className="text-[10px] text-zinc-400 mb-0.5">{s.ticker}</div>
      <div className="text-sm font-medium text-zinc-100 mb-1">{s.name}</div>
      <div className="text-base font-bold font-mono" style={{ color: txtColor(val) }}>
        {val >= 0 ? '+' : ''}{val}%
      </div>
      <div className="text-[10px] text-zinc-600 mt-1">
        거래량 <span className={s.volRatio > 1.3 ? 'text-emerald-500' : 'text-zinc-500'}>{s.volRatio}x</span>
      </div>
    </div>
  );
}
