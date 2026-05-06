'use client';
import { useState, useRef } from 'react';
import type { BacktestResult, BacktestTrade } from '@/lib/backtest';

// ── 유틸 ───────────────────────────────────────────────────────────────────────
const fmt  = (n: number, d = 2) => n.toFixed(d);
const fmtK = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`;
const sign = (n: number) => n >= 0 ? `+${fmt(n)}%` : `${fmt(n)}%`;
const pColor = (n: number) => n >= 0 ? 'text-emerald-400' : 'text-red-400';

function MetricCard({ label, value, sub, color = 'text-zinc-100' }: {
  label: string; value: string; sub?: string; color?: string;
}) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col gap-1">
      <span className="text-[10px] text-zinc-500 uppercase tracking-widest">{label}</span>
      <span className={`text-xl font-bold font-mono ${color}`}>{value}</span>
      {sub && <span className="text-[10px] text-zinc-600">{sub}</span>}
    </div>
  );
}

// ── 에쿼티 커브 SVG ──────────────────────────────────────────────────────────
function EquityCurve({ data, initialCapital }: {
  data: { date: string; value: number }[];
  initialCapital: number;
}) {
  if (data.length < 2) return null;
  const W = 800, H = 200, PAD = { t: 16, r: 16, b: 32, l: 60 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;

  const vals = data.map(d => d.value);
  const minV = Math.min(...vals, initialCapital);
  const maxV = Math.max(...vals, initialCapital);
  const range = maxV - minV || 1;

  const px = (i: number) => PAD.l + (i / (data.length - 1)) * innerW;
  const py = (v: number) => PAD.t + (1 - (v - minV) / range) * innerH;

  const pts = data.map((d, i) => `${px(i)},${py(d.value)}`).join(' ');
  const areaPath = `M ${px(0)},${py(data[0].value)} ` +
    data.slice(1).map((d, i) => `L ${px(i + 1)},${py(d.value)}`).join(' ') +
    ` L ${px(data.length - 1)},${H - PAD.b} L ${px(0)},${H - PAD.b} Z`;

  const finalValue  = vals[vals.length - 1];
  const isPositive  = finalValue >= initialCapital;
  const lineColor   = isPositive ? '#10b981' : '#ef4444';
  const areaColor   = isPositive ? '#10b98118' : '#ef444418';

  // Y축 눈금 (3개)
  const yTicks = [minV, (minV + maxV) / 2, maxV];
  // X축 날짜 (첫/중/끝)
  const xLabels = [
    { i: 0, label: data[0].date.slice(0, 7) },
    { i: Math.floor(data.length / 2), label: data[Math.floor(data.length / 2)].date.slice(0, 7) },
    { i: data.length - 1, label: data[data.length - 1].date.slice(0, 7) },
  ];

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" style={{ minWidth: 320 }}>
        {/* 배경 그리드 */}
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={PAD.l} y1={py(v)} x2={W - PAD.r} y2={py(v)} stroke="#27272a" strokeWidth={1} />
            <text x={PAD.l - 6} y={py(v) + 4} textAnchor="end" fontSize={9} fill="#52525b">
              {fmtK(v)}
            </text>
          </g>
        ))}
        {/* 기준선 (초기 자본) */}
        <line x1={PAD.l} y1={py(initialCapital)} x2={W - PAD.r} y2={py(initialCapital)}
          stroke="#3f3f46" strokeWidth={1} strokeDasharray="4,4" />
        {/* 면적 */}
        <path d={areaPath} fill={areaColor} />
        {/* 라인 */}
        <polyline points={pts} fill="none" stroke={lineColor} strokeWidth={2} strokeLinejoin="round" />
        {/* X축 날짜 */}
        {xLabels.map(({ i, label }) => (
          <text key={i} x={px(i)} y={H - 6} textAnchor="middle" fontSize={9} fill="#52525b">{label}</text>
        ))}
      </svg>
    </div>
  );
}

// ── 거래 내역 테이블 ──────────────────────────────────────────────────────────
const EXIT_KO: Record<string, string> = {
  STOP_LOSS:     '손절',
  TRAILING_STOP: '트레일링',
  SIGNAL_EXIT:   '신호청산',
  END_OF_DATA:   '기간종료',
};

function TradeTable({ trades }: { trades: BacktestTrade[] }) {
  const [sortKey, setSortKey] = useState<keyof BacktestTrade>('entryDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const PER = 15;

  const sorted = [...trades].sort((a, b) => {
    const va = a[sortKey], vb = b[sortKey];
    if (typeof va === 'number' && typeof vb === 'number')
      return sortDir === 'asc' ? va - vb : vb - va;
    return sortDir === 'asc'
      ? String(va).localeCompare(String(vb))
      : String(vb).localeCompare(String(va));
  });

  const paged = sorted.slice(page * PER, (page + 1) * PER);
  const totalPages = Math.ceil(trades.length / PER);

  const th = (key: keyof BacktestTrade, label: string) => (
    <th
      onClick={() => { setSortKey(key); setSortDir(d => d === 'asc' ? 'desc' : 'asc'); setPage(0); }}
      className="px-3 py-2 text-left text-[10px] text-zinc-500 uppercase tracking-widest cursor-pointer hover:text-zinc-300 whitespace-nowrap select-none"
    >
      {label}{sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full text-xs">
          <thead className="bg-zinc-900 border-b border-zinc-800">
            <tr>
              {th('ticker',    '종목')}
              {th('entryDate', '진입일')}
              {th('exitDate',  '청산일')}
              {th('entryPrice','진입가')}
              {th('exitPrice', '청산가')}
              {th('pnlPct',   '수익률')}
              {th('pnl',       'P&L')}
              {th('holdDays',  '보유일')}
              {th('exitReason','청산사유')}
              {th('entryScore','진입점수')}
            </tr>
          </thead>
          <tbody>
            {paged.map((t, i) => (
              <tr key={i} className="border-b border-zinc-900 hover:bg-zinc-900/40">
                <td className="px-3 py-2 font-bold text-zinc-100">{t.ticker}</td>
                <td className="px-3 py-2 text-zinc-400 font-mono">{t.entryDate}</td>
                <td className="px-3 py-2 text-zinc-400 font-mono">{t.exitDate}</td>
                <td className="px-3 py-2 text-zinc-300 font-mono">${t.entryPrice}</td>
                <td className="px-3 py-2 text-zinc-300 font-mono">${t.exitPrice}</td>
                <td className={`px-3 py-2 font-mono font-bold ${pColor(t.pnlPct)}`}>{sign(t.pnlPct)}</td>
                <td className={`px-3 py-2 font-mono ${pColor(t.pnl)}`}>{t.pnl >= 0 ? '+' : ''}${t.pnl}</td>
                <td className="px-3 py-2 text-zinc-500">{t.holdDays}일</td>
                <td className="px-3 py-2">
                  <span className={`px-1.5 py-0.5 rounded text-[9px] border ${
                    t.exitReason === 'STOP_LOSS'     ? 'bg-red-950 text-red-400 border-red-800' :
                    t.exitReason === 'TRAILING_STOP' ? 'bg-amber-950 text-amber-400 border-amber-800' :
                    t.exitReason === 'SIGNAL_EXIT'   ? 'bg-zinc-900 text-zinc-400 border-zinc-700' :
                    'bg-zinc-900 text-zinc-600 border-zinc-800'
                  }`}>{EXIT_KO[t.exitReason]}</span>
                </td>
                <td className="px-3 py-2 font-mono text-zinc-400">{t.entryScore}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3 text-xs text-zinc-500">
          <span>{trades.length}건 중 {page * PER + 1}–{Math.min((page + 1) * PER, trades.length)}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="px-3 py-1 rounded border border-zinc-800 hover:border-zinc-600 disabled:opacity-30">이전</button>
            <span className="px-2 py-1">{page + 1} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
              className="px-3 py-1 rounded border border-zinc-800 hover:border-zinc-600 disabled:opacity-30">다음</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 메인 페이지 ──────────────────────────────────────────────────────────────
export default function BacktestPage() {
  const [tickerInput, setTickerInput] = useState('NVDA, AAPL, MSFT, TSLA, META');
  const [startDate,   setStartDate]   = useState('2022-01-01');
  const [endDate,     setEndDate]     = useState(new Date().toISOString().slice(0, 10));
  const [capital,     setCapital]     = useState('10000');
  const [posSizePct,  setPosSizePct]  = useState('20');
  const [maxPos,      setMaxPos]      = useState('5');
  const [atrMult,     setAtrMult]     = useState('2.0');

  const [loading,  setLoading]  = useState(false);
  const [result,   setResult]   = useState<BacktestResult | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const resultRef = useRef<HTMLDivElement>(null);

  const run = async () => {
    const tickers = tickerInput.split(/[\s,]+/).map(t => t.trim().toUpperCase()).filter(Boolean);
    if (tickers.length === 0) { setError('종목을 입력해주세요.'); return; }

    setLoading(true); setError(null); setResult(null);
    setProgress(`${tickers.length}개 종목 데이터 수집 중…`);

    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tickers,
          startDate,
          endDate,
          initialCapital:  Number(capital),
          positionSizePct: Number(posSizePct) / 100,
          maxPositions:    Number(maxPos),
          atrStopMult:     Number(atrMult),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? '오류가 발생했습니다.'); return; }
      setResult(data);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false); setProgress('');
    }
  };

  const m = result?.metrics;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-6xl mx-auto px-4 py-8">

        {/* ── 헤더 ── */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-zinc-100 mb-1">백테스트</h1>
          <p className="text-sm text-zinc-500">
            과거 데이터로 모멘텀 전략의 실제 성과를 검증합니다.
            VCP 제외 순수 기술지표 기반 (MA·RSI·MACD·거래량·52주 고점).
          </p>
        </div>

        {/* ── 설정 폼 ── */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            {/* 종목 */}
            <div className="lg:col-span-3">
              <label className="block text-[10px] text-zinc-500 uppercase tracking-widest mb-1.5">
                종목 (쉼표 또는 스페이스 구분, 최대 20개)
              </label>
              <input
                value={tickerInput}
                onChange={e => setTickerInput(e.target.value)}
                placeholder="NVDA, AAPL, MSFT, TSLA, META"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-600"
              />
            </div>
            {/* 시작일 */}
            <div>
              <label className="block text-[10px] text-zinc-500 uppercase tracking-widest mb-1.5">시작일</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-600"
              />
            </div>
            {/* 종료일 */}
            <div>
              <label className="block text-[10px] text-zinc-500 uppercase tracking-widest mb-1.5">종료일</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-600"
              />
            </div>
            {/* 초기 자본 */}
            <div>
              <label className="block text-[10px] text-zinc-500 uppercase tracking-widest mb-1.5">초기 자본 ($)</label>
              <input type="number" value={capital} onChange={e => setCapital(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-600"
              />
            </div>
          </div>

          {/* 고급 설정 */}
          <details className="mb-4">
            <summary className="text-[10px] text-zinc-500 uppercase tracking-widest cursor-pointer hover:text-zinc-300 select-none">
              ▶ 고급 설정
            </summary>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-3">
              <div>
                <label className="block text-[10px] text-zinc-500 uppercase tracking-widest mb-1.5">포지션 크기 (%)</label>
                <input type="number" min="5" max="100" value={posSizePct} onChange={e => setPosSizePct(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-600"
                />
                <p className="text-[9px] text-zinc-600 mt-1">자본 대비 1회 진입 비중</p>
              </div>
              <div>
                <label className="block text-[10px] text-zinc-500 uppercase tracking-widest mb-1.5">최대 동시 포지션</label>
                <input type="number" min="1" max="20" value={maxPos} onChange={e => setMaxPos(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-600"
                />
              </div>
              <div>
                <label className="block text-[10px] text-zinc-500 uppercase tracking-widest mb-1.5">ATR 손절 배수</label>
                <input type="number" min="0.5" max="5" step="0.5" value={atrMult} onChange={e => setAtrMult(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-600"
                />
                <p className="text-[9px] text-zinc-600 mt-1">진입가 - ATR × 배수 = 손절가</p>
              </div>
            </div>
          </details>

          {error && (
            <div className="mb-4 p-3 rounded-lg border border-red-800 bg-red-950/20 text-sm text-red-400">{error}</div>
          )}

          <button
            onClick={run}
            disabled={loading}
            className="w-full sm:w-auto px-6 py-2.5 bg-emerald-700 hover:bg-emerald-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-semibold rounded-lg transition-colors text-sm"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="inline-block w-3.5 h-3.5 border-2 border-zinc-600 border-t-emerald-400 rounded-full animate-spin" />
                {progress || '분석 중…'}
              </span>
            ) : '백테스트 실행'}
          </button>
        </div>

        {/* ── 결과 ── */}
        {result && m && (
          <div ref={resultRef}>

            {/* 요약 메트릭 */}
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-widest mb-3">성과 요약</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
                <MetricCard
                  label="총 수익률" value={sign(m.totalReturn)}
                  sub={`${fmtK(m.initialCapital)} → ${fmtK(m.finalCapital)}`}
                  color={pColor(m.totalReturn)}
                />
                <MetricCard
                  label="연환산 수익 (CAGR)" value={sign(m.cagr)}
                  sub={`${result.startDate} ~ ${result.endDate}`}
                  color={pColor(m.cagr)}
                />
                <MetricCard
                  label="승률" value={`${fmt(m.winRate)}%`}
                  sub={`${m.winTrades}승 / ${m.lossTrades}패 / ${m.totalTrades}건`}
                  color={m.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}
                />
                <MetricCard
                  label="손익비 (Profit Factor)" value={m.profitFactor >= 999 ? '∞' : fmt(m.profitFactor)}
                  sub="총수익 / 총손실"
                  color={m.profitFactor >= 1.5 ? 'text-emerald-400' : m.profitFactor >= 1 ? 'text-amber-400' : 'text-red-400'}
                />
                <MetricCard
                  label="최대 낙폭 (MDD)" value={`-${fmt(m.maxDrawdown)}%`}
                  sub="고점 대비 최대 하락"
                  color="text-red-400"
                />
                <MetricCard label="평균 수익" value={sign(m.avgWin)}  color="text-emerald-400" />
                <MetricCard label="평균 손실" value={sign(m.avgLoss)} color="text-red-400" />
                <MetricCard label="평균 보유일" value={`${m.avgHoldDays}일`} />
                <MetricCard label="최고 거래" value={sign(m.bestTrade)}  color="text-emerald-400" />
                <MetricCard label="최악 거래" value={sign(m.worstTrade)} color="text-red-400" />
              </div>
            </div>

            {/* 전략 평가 */}
            <div className="mb-6 p-4 rounded-xl border border-zinc-800 bg-zinc-900/50">
              <h2 className="text-[10px] text-zinc-500 uppercase tracking-widest mb-2">전략 평가</h2>
              <div className="flex flex-wrap gap-2 text-xs">
                {m.profitFactor >= 2    && <span className="px-2 py-1 bg-emerald-950 text-emerald-300 border border-emerald-800 rounded">✓ 손익비 양호 ({fmt(m.profitFactor)})</span>}
                {m.profitFactor < 1     && <span className="px-2 py-1 bg-red-950 text-red-400 border border-red-800 rounded">✕ 손익비 불량 ({fmt(m.profitFactor)}) — 손절 전략 재검토</span>}
                {m.winRate >= 50        && <span className="px-2 py-1 bg-emerald-950 text-emerald-300 border border-emerald-800 rounded">✓ 승률 {fmt(m.winRate)}%</span>}
                {m.winRate < 40         && <span className="px-2 py-1 bg-amber-950 text-amber-300 border border-amber-800 rounded">△ 낮은 승률 ({fmt(m.winRate)}%) — 진입 기준 강화 필요</span>}
                {m.maxDrawdown > 30     && <span className="px-2 py-1 bg-red-950 text-red-400 border border-red-800 rounded">✕ MDD {fmt(m.maxDrawdown)}% — 포지션 크기 축소 검토</span>}
                {m.maxDrawdown <= 15    && <span className="px-2 py-1 bg-emerald-950 text-emerald-300 border border-emerald-800 rounded">✓ MDD {fmt(m.maxDrawdown)}% 양호</span>}
                {m.cagr > 20            && <span className="px-2 py-1 bg-emerald-950 text-emerald-300 border border-emerald-800 rounded">✓ CAGR {fmt(m.cagr)}% (S&P500 대비 우수)</span>}
                {m.totalTrades < 10     && <span className="px-2 py-1 bg-amber-950 text-amber-300 border border-amber-800 rounded">⚠ 거래 수 부족 ({m.totalTrades}건) — 통계적 유의성 낮음</span>}
                {m.avgHoldDays <= 5     && <span className="px-2 py-1 bg-amber-950 text-amber-300 border border-amber-800 rounded">△ 평균 보유 {m.avgHoldDays}일 — 손절이 너무 빠름</span>}
              </div>
            </div>

            {/* 에쿼티 커브 */}
            {result.equityCurve.length > 1 && (
              <div className="mb-6 p-4 rounded-xl border border-zinc-800 bg-zinc-900/50">
                <h2 className="text-[10px] text-zinc-500 uppercase tracking-widest mb-3">자산 추이</h2>
                <EquityCurve data={result.equityCurve} initialCapital={m.initialCapital} />
              </div>
            )}

            {/* 종목별 성과 */}
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-widest mb-3">종목별 성과</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {result.tickerResults.map(tr => (
                  <div key={tr.ticker} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-zinc-100">{tr.ticker}</span>
                      <span className={`text-sm font-bold font-mono ${pColor(tr.totalPnl)}`}>
                        {tr.totalPnl >= 0 ? '+' : ''}${tr.totalPnl}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-zinc-500">
                      <span>거래 <span className="text-zinc-300">{tr.trades}건</span></span>
                      <span>승률 <span className={tr.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}>{tr.winRate}%</span></span>
                      <span>누적 <span className={pColor(tr.totalPnlPct)}>{sign(tr.totalPnlPct)}</span></span>
                    </div>
                    {tr.trades > 0 && (
                      <div className="mt-2 h-1 bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-600 rounded-full"
                          style={{ width: `${tr.winRate}%` }} />
                      </div>
                    )}
                    {tr.trades === 0 && (
                      <p className="text-[10px] text-zinc-600 mt-2">진입 신호 없음 — 기간 내 조건 미충족</p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* 거래 내역 */}
            {result.trades.length > 0 && (
              <div className="mb-6">
                <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-widest mb-3">
                  전체 거래 내역 ({result.trades.length}건)
                </h2>
                <TradeTable trades={result.trades} />
              </div>
            )}

            {result.trades.length === 0 && (
              <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/50 text-center">
                <p className="text-zinc-400 text-sm">해당 기간에 진입 신호가 발생하지 않았습니다.</p>
                <p className="text-zinc-600 text-xs mt-1">기간을 늘리거나 종목을 추가해보세요.</p>
              </div>
            )}

            {/* 주의사항 */}
            <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/30 text-[10px] text-zinc-600 leading-relaxed">
              <p className="font-semibold text-zinc-500 mb-1">⚠ 백테스트 주의사항</p>
              <p>• 슬리피지·수수료 미반영 — 실제 수익은 약 0.5~1% 낮을 수 있음</p>
              <p>• Look-ahead bias: 당일 신호 → 익일 시가 진입으로 최소화했으나 완전 제거 불가</p>
              <p>• VCP 패턴은 실시간 분석과 달리 백테스트에서 제외됨 (주봉 롤링 계산 한계)</p>
              <p>• 과거 성과가 미래 수익을 보장하지 않음. 반드시 소액 실전 검증 후 확대 운용할 것</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

