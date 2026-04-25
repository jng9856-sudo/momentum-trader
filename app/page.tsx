'use client';

import { useState, useEffect } from 'react';
import type { AnalysisResult } from '@/types/stock';
import StockCard       from '@/components/StockCard';
import TopPicks        from '@/components/TopPicks';
import WatchlistManager from '@/components/WatchlistManager';

const DEFAULT_TICKERS = ['AMD', 'MRVL', 'AVGO', 'MU', 'INTC', 'ARM', 'NVDA', 'TSM'];
const CACHE_KEY = 'mt_analysis_v2';
const WATCHLIST_KEY = 'mt_watchlist_v1';

const STATUS_STEPS = [
  '> 웹 데이터 수집 중...',
  '> RS 지표 계산 중...',
  '> 패턴 분석 중 (컵앤핸들, W베이스)...',
  '> 매수/매도 신호 생성 중...',
  '> 분석 완료 중...',
];

type FilterType = 'ALL' | 'BUY' | 'SELL' | 'HOLD';
type SortType   = 'SCORE' | 'TICKER' | 'SIGNAL';

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export default function Home() {
  const [watchlist, setWatchlist] = useState<string[]>(DEFAULT_TICKERS);
  const [result,    setResult]    = useState<AnalysisResult | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [status,    setStatus]    = useState('');
  const [error,     setError]     = useState('');
  const [filter,    setFilter]    = useState<FilterType>('ALL');
  const [sort,      setSort]      = useState<SortType>('SCORE');
  const [stepIdx,   setStepIdx]   = useState(0);

  // Restore from localStorage
  useEffect(() => {
    try {
      const wl = localStorage.getItem(WATCHLIST_KEY);
      if (wl) setWatchlist(JSON.parse(wl));
    } catch {}
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.date === todayKey()) {
          setResult(parsed.result);
        }
      }
    } catch {}
  }, []);

  // Save watchlist
  useEffect(() => {
    try { localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist)); } catch {}
  }, [watchlist]);

  function addTicker(t: string) { setWatchlist(w => [...w, t]); }
  function removeTicker(t: string) { setWatchlist(w => w.filter(x => x !== t)); }

  async function runAnalysis() {
    if (watchlist.length === 0 || loading) return;
    setLoading(true);
    setError('');
    setStepIdx(0);

    const interval = setInterval(() => {
      setStepIdx(i => (i + 1) % STATUS_STEPS.length);
    }, 2500);
    setStatus(STATUS_STEPS[0]);

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: watchlist }),
      });

      clearInterval(interval);

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data: AnalysisResult = await res.json();
      setResult(data);
      setStatus(`> 분석 완료 — ${data.stocks.length}개 종목 | ${new Date().toLocaleTimeString('ko-KR')}`);

      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ date: todayKey(), result: data }));
      } catch {}
    } catch (err) {
      clearInterval(interval);
      setError(String(err));
      setStatus('');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (loading) setStatus(STATUS_STEPS[stepIdx]);
  }, [stepIdx, loading]);

  // Filtered + sorted stocks
  const displayedStocks = result
    ? [...result.stocks]
        .filter(s => filter === 'ALL' || s.signal === filter)
        .sort((a, b) => {
          if (sort === 'SCORE')  return Number(b.momentum_score) - Number(a.momentum_score);
          if (sort === 'TICKER') return a.ticker.localeCompare(b.ticker);
          const order = { BUY: 0, HOLD: 1, SELL: 2 } as Record<string, number>;
          return (order[a.signal] ?? 3) - (order[b.signal] ?? 3);
        })
    : [];

  const buyCnt  = result?.stocks.filter(s => s.signal === 'BUY').length  ?? 0;
  const sellCnt = result?.stocks.filter(s => s.signal === 'SELL').length ?? 0;
  const holdCnt = result?.stocks.filter(s => s.signal === 'HOLD').length ?? 0;

  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  });

  return (
    <div className="min-h-screen bg-bg-base">
      <div className="max-w-4xl mx-auto px-4 py-8">

        {/* ── Header ── */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 pb-6 border-b border-border">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-zinc-100">
              MOMENTUM SIGNAL
            </h1>
            <p className="text-xs text-zinc-600 mt-0.5">{today}</p>
          </div>
          <button
            onClick={runAnalysis}
            disabled={loading || watchlist.length === 0}
            className={`px-6 py-2.5 text-sm font-semibold rounded-lg border transition-all
              ${loading
                ? 'bg-zinc-900 border-zinc-700 text-zinc-500 cursor-not-allowed'
                : 'bg-emerald-500 border-emerald-400 text-black hover:bg-emerald-400 active:scale-95'
              }`}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="blink">▋</span>분석 중...
              </span>
            ) : (
              result ? '재분석 실행' : '분석 실행 →'
            )}
          </button>
        </header>

        {/* ── Watchlist ── */}
        <WatchlistManager watchlist={watchlist} onAdd={addTicker} onRemove={removeTicker} />

        {/* ── Status ── */}
        {(status || loading) && (
          <div className={`text-xs mb-4 font-mono ${loading ? 'text-sky-500' : 'text-zinc-500'}`}>
            {loading && <span className="blink mr-1">▋</span>}{status}
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="mb-6 p-4 bg-red-950 border border-red-800 rounded-xl text-sm text-red-300">
            오류: {error}
          </div>
        )}

        {/* ── Results ── */}
        {result && (
          <>
            {/* Market context */}
            {result.market_context && (
              <div className="mb-6 p-4 bg-zinc-900/60 border border-zinc-800 rounded-xl">
                <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2">시장 컨텍스트</div>
                <p className="text-xs text-zinc-400 leading-relaxed" style={{ fontFamily: 'system-ui, sans-serif' }}>
                  {result.market_context}
                </p>
              </div>
            )}

            {/* Summary stats */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              <StatCard label="매수" value={buyCnt} color="text-emerald-400" border="border-emerald-900" />
              <StatCard label="관망" value={holdCnt} color="text-amber-400"   border="border-amber-900" />
              <StatCard label="매도" value={sellCnt} color="text-red-400"     border="border-red-900" />
            </div>

            {/* Top picks */}
            <TopPicks stocks={result.stocks} />

            {/* Filter + Sort */}
            <div className="flex flex-wrap gap-2 items-center justify-between mb-4">
              <div className="flex gap-1">
                {(['ALL', 'BUY', 'SELL', 'HOLD'] as FilterType[]).map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors
                      ${filter === f
                        ? 'bg-zinc-700 border-zinc-600 text-zinc-100'
                        : 'bg-transparent border-zinc-800 text-zinc-500 hover:text-zinc-300'
                      }`}
                  >
                    {f === 'ALL' ? '전체' : f === 'BUY' ? '매수' : f === 'SELL' ? '매도' : '관망'}
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                {(['SCORE', 'SIGNAL', 'TICKER'] as SortType[]).map(s => (
                  <button
                    key={s}
                    onClick={() => setSort(s)}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors
                      ${sort === s
                        ? 'bg-zinc-700 border-zinc-600 text-zinc-100'
                        : 'bg-transparent border-zinc-800 text-zinc-500 hover:text-zinc-300'
                      }`}
                  >
                    {s === 'SCORE' ? '점수순' : s === 'SIGNAL' ? '신호순' : '티커순'}
                  </button>
                ))}
              </div>
            </div>

            {/* Stock cards */}
            <div className="flex flex-col gap-4">
              {displayedStocks.map((s, i) => (
                <StockCard key={s.ticker} stock={s} highlight={i === 0 && filter !== 'SELL'} />
              ))}
              {displayedStocks.length === 0 && (
                <p className="text-sm text-zinc-600 py-6 text-center">해당 조건의 종목이 없습니다.</p>
              )}
            </div>

            {/* Timestamp */}
            <div className="text-[10px] text-zinc-700 text-center mt-8">
              마지막 분석: {new Date(result.analyzed_at).toLocaleString('ko-KR')}
            </div>
          </>
        )}

        {/* ── No result yet ── */}
        {!result && !loading && !error && (
          <div className="text-center py-20">
            <div className="text-5xl mb-4 text-zinc-800">◈</div>
            <p className="text-zinc-600 text-sm mb-1">분석을 시작하려면 위 버튼을 클릭하세요.</p>
            <p className="text-zinc-700 text-xs">AI가 실시간 웹 검색으로 종목을 분석합니다.</p>
          </div>
        )}

        {/* ── Disclaimer ── */}
        <footer className="mt-10 pt-6 border-t border-border">
          <p className="text-[10px] text-zinc-700 leading-relaxed text-center" style={{ fontFamily: 'system-ui, sans-serif' }}>
            ⚠ 이 서비스는 AI가 공개 데이터를 기반으로 생성한 참고 정보이며, 금융 투자 권유가 아닙니다.
            투자 판단 및 손익에 대한 책임은 전적으로 본인에게 있습니다.
          </p>
        </footer>
      </div>
    </div>
  );
}

function StatCard({ label, value, color, border }: { label: string; value: number; color: string; border: string }) {
  return (
    <div className={`bg-bg-card border ${border} rounded-xl p-4 text-center`}>
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
      <div className="text-[10px] text-zinc-600 uppercase tracking-widest mt-0.5">{label}</div>
    </div>
  );
}
