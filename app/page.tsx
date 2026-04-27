'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { AnalysisResult, StockAnalysis } from '@/types/stock';
import StockCard        from '@/components/StockCard';
import TopPicks         from '@/components/TopPicks';
import WatchlistManager from '@/components/WatchlistManager';
import PortfolioTab     from '@/components/PortfolioTab';
import MarketStatus    from '@/components/MarketStatus';
import SectorHeatmap   from '@/components/SectorHeatmap';
import BacktestPanel   from '@/components/BacktestPanel';

const DEFAULT_TICKERS = ['AMD', 'MRVL', 'AVGO', 'MU', 'INTC', 'ARM', 'NVDA', 'TSM'];
const CACHE_KEY        = 'mt_analysis_v4';
const WATCHLIST_KEY    = 'mt_watchlist_v3';
const MAX_TICKERS      = 1000;
const BATCH_SIZE       = 50;

type FilterType = 'ALL' | 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
type SortType   = 'SCORE' | 'TICKER' | 'SIGNAL';
type TabType    = 'scanner' | 'portfolio' | 'sectors' | 'backtest';

function todayKey() { return new Date().toISOString().slice(0, 10); }

function isTicker(val: string): boolean {
  const t = val.trim().toUpperCase();
  return /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/.test(t) && t.length >= 1;
}

async function parseExcelTickers(file: File): Promise<string[]> {
  const XLSX = await import('xlsx');
  const buf  = await file.arrayBuffer();
  const wb   = XLSX.read(buf, { type: 'array' });
  const tickers: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws   = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 }) as string[][];
    for (const row of rows) {
      for (const cell of row) {
        const val = String(cell ?? '').trim();
        if (isTicker(val)) tickers.push(val.toUpperCase());
      }
    }
  }
  return [...new Set(tickers)];
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export default function Home() {
  const [activeTab,  setActiveTab]  = useState<TabType>('scanner');
  const [watchlist,  setWatchlist]  = useState<string[]>([]);
  const [allStocks,  setAllStocks]  = useState<StockAnalysis[]>([]);
  const [marketCtx,  setMarketCtx]  = useState('');
  const [analyzedAt, setAnalyzedAt] = useState('');
  const [loading,    setLoading]    = useState(false);
  const [progress,   setProgress]   = useState({ done: 0, total: 0 });
  const [status,     setStatus]     = useState('');
  const [error,      setError]      = useState('');
  const [filter,     setFilter]     = useState<FilterType>('ALL');
  const [sort,       setSort]       = useState<SortType>('SCORE');
  const [xlsxMsg,    setXlsxMsg]    = useState('');
  const [xlsxOpen,   setXlsxOpen]   = useState(false);
  const [search,     setSearch]     = useState('');
  const [earningsMap, setEarningsMap] = useState<Record<string, { earningsDate: string | null; daysUntil: number | null; epsEstimate: number | null; revenueEstimate: string | null; lastEPS: number | null }>>({});
  const fileRef  = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);

  useEffect(() => {
    // Try loading watchlist from DB first
    fetch('/api/db?type=watchlist').then(r => r.json()).then(d => {
      if (d.tickers?.length > 0) setWatchlist(d.tickers);
      else { try { const wl = localStorage.getItem(WATCHLIST_KEY); if (wl) setWatchlist(JSON.parse(wl)); } catch {} }
    }).catch(() => { try { const wl = localStorage.getItem(WATCHLIST_KEY); if (wl) setWatchlist(JSON.parse(wl)); } catch {} });
    // Try loading today's analysis from DB (cron result)
    fetch(`/api/db?type=analysis&date=${todayKey()}`).then(r => r.json()).then(d => {
      if (d && !d.empty && d.stocks?.length > 0) {
        setAllStocks(d.stocks); setMarketCtx(d.market_context ?? '');
        setAnalyzedAt(d.analyzed_at ?? new Date().toISOString());
        setStatus(`> 크론 분석 결과 로드 완료 — ${d.stocks.length}개 종목`);
        return;
      }
      // Fallback to localStorage
      try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) { const p = JSON.parse(cached); if (p.date === todayKey()) { setAllStocks(p.stocks ?? []); setMarketCtx(p.market_context ?? ''); setAnalyzedAt(p.analyzed_at ?? ''); } }
      } catch {}
    }).catch(() => {
      try { const cached = localStorage.getItem(CACHE_KEY); if (cached) { const p = JSON.parse(cached); if (p.date === todayKey()) { setAllStocks(p.stocks ?? []); setMarketCtx(p.market_context ?? ''); setAnalyzedAt(p.analyzed_at ?? ''); } } } catch {}
    });
    try {
      const ec = localStorage.getItem('mt_earnings_v1');
      if (ec) { const ep = JSON.parse(ec); if (ep.date === todayKey()) setEarningsMap(ep.data ?? {}); }
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist)); } catch {}
    saveWatchlistToDB(watchlist);
  }, [watchlist]);

  function addTicker(t: string)    { if (watchlist.length < MAX_TICKERS) setWatchlist(w => [...w, t]); }
  function removeTicker(t: string) { setWatchlist(w => w.filter(x => x !== t)); }
  function removeFromResults(ticker: string) {
    setAllStocks(s => s.filter(x => x.ticker !== ticker));
    setWatchlist(w => w.filter(x => x !== ticker));
    try {
      const ec = localStorage.getItem('mt_earnings_v1');
      if (ec) { const ep = JSON.parse(ec); if (ep.date === todayKey()) setEarningsMap(ep.data ?? {}); }
    } catch {}
    try {
      const c = localStorage.getItem(CACHE_KEY);
      if (c) {
        const p = JSON.parse(c);
        p.stocks = (p.stocks ?? []).filter((s: { ticker: string }) => s.ticker !== ticker);
        localStorage.setItem(CACHE_KEY, JSON.stringify(p));
      }
    } catch {}
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setXlsxMsg('파일 읽는 중...');
    try {
      const found = await parseExcelTickers(file);
      if (found.length === 0) { setXlsxMsg('티커를 찾지 못했습니다.'); return; }
      const prev   = watchlist.length;
      const merged = [...new Set([...watchlist, ...found])].slice(0, MAX_TICKERS);
      setWatchlist(merged);
      setXlsxMsg(`✓ ${found.length}개 발견 → ${merged.length - prev}개 추가 (총 ${merged.length}개)`);
    } catch (err) { setXlsxMsg(`오류: ${String(err)}`); }
    e.target.value = '';
  }

  const runAnalysis = useCallback(async () => {
    if (watchlist.length === 0 || loading) return;
    abortRef.current = false;
    setLoading(true); setError(''); setAllStocks([]); setMarketCtx(''); setAnalyzedAt(''); setSearch('');
    const batches = chunk(watchlist, BATCH_SIZE);
    setProgress({ done: 0, total: watchlist.length });
    let accumulated: StockAnalysis[] = [];
    let firstCtx = '';
    for (let i = 0; i < batches.length; i++) {
      if (abortRef.current) break;
      setStatus(`> 배치 ${i+1}/${batches.length} 처리 중... (${batches[i].join(', ')})`);
      try {
        const res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tickers: batches[i] }),
        });
        if (res.ok) {
          const data: AnalysisResult = await res.json();
          accumulated = [...accumulated, ...(data.stocks ?? [])];
          if (!firstCtx && data.market_context) firstCtx = data.market_context;
          setAllStocks([...accumulated]);
          setMarketCtx(firstCtx);
        }
      } catch { /* skip failed batch */ }
      setProgress({ done: Math.min(watchlist.length, (i+1) * BATCH_SIZE), total: watchlist.length });
    }
    const ts = new Date().toISOString();
    setAnalyzedAt(ts);
    setStatus(`> 완료 — ${accumulated.length}개 종목 · 실적 발표일 조회 중...`);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ date: todayKey(), stocks: accumulated, market_context: firstCtx, analyzed_at: ts })); } catch {}
    // Save to Supabase DB for cross-device sync
    await saveAnalysisToDB(accumulated, firstCtx, ts);

    // Fetch earnings calendar in background
    try {
      const tBatches = chunk(watchlist, 20);
      const eMap: Record<string, { earningsDate: string | null; daysUntil: number | null; epsEstimate: number | null; revenueEstimate: string | null; lastEPS: number | null }> = {};
      for (const tb of tBatches) {
        const er = await fetch('/api/earnings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tickers: tb }) });
        if (er.ok) {
          const ed = await er.json();
          (ed.earnings ?? []).forEach((e: { ticker: string; earningsDate: string | null; daysUntil: number | null; epsEstimate: number | null; revenueEstimate: string | null; lastEPS: number | null }) => { eMap[e.ticker] = e; });
        }
      }
      setEarningsMap(eMap);
      try { localStorage.setItem('mt_earnings_v1', JSON.stringify({ date: todayKey(), data: eMap })); } catch {}
    } catch {}

    setStatus(`> 완료 — ${accumulated.length}개 종목 | ${new Date().toLocaleTimeString('ko-KR')}`);
    setLoading(false);
  }, [watchlist, loading]);

  function stopAnalysis() { abortRef.current = true; setLoading(false); setStatus('> 분석 중단됨'); }

  function resetAll() {
    abortRef.current = true;
    setLoading(false); setAllStocks([]); setMarketCtx(''); setAnalyzedAt('');
    setStatus(''); setError(''); setSearch(''); setFilter('ALL'); setSort('SCORE');
    setWatchlist([]); setXlsxMsg(''); setEarningsMap({});
    try { localStorage.removeItem(CACHE_KEY); localStorage.removeItem(WATCHLIST_KEY); localStorage.removeItem('mt_earnings_v1'); } catch {}
  }

  // ── Supabase DB sync ──────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function loadFromDB() {
    try {
      // Load analysis cache from DB
      const res = await fetch(`/api/db?type=analysis&date=${todayKey()}`);
      if (res.ok) {
        const data = await res.json();
        if (data && !data.empty && data.stocks?.length > 0) {
          setAllStocks(data.stocks);
          setMarketCtx(data.market_context ?? '');
          setAnalyzedAt(data.analyzed_at ?? new Date().toISOString());
          setStatus(`> DB에서 로드 완료 — ${data.stocks.length}개 종목 | 크론 분석 결과`);
          return true;
        }
      }
    } catch {}
    return false;
  }

  async function saveWatchlistToDB(wl: string[]) {
    try {
      await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'watchlist', tickers: wl }) });
    } catch {}
  }

  async function saveAnalysisToDB(stocks: StockAnalysis[], ctx: string, ts: string) {
    try {
      await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'analysis', stocks, market_context: ctx, date: todayKey(), analyzed_at: ts }) });
    } catch {}
  }

  const displayed = [...allStocks]
    .filter(s => filter === 'ALL' || s.signal === filter)
    .filter(s => search === '' || s.ticker.includes(search.toUpperCase()))
    .sort((a, b) => {
      if (sort === 'SCORE')  return Number(b.momentum_score) - Number(a.momentum_score);
      if (sort === 'TICKER') return a.ticker.localeCompare(b.ticker);
      const o = { STRONG_BUY: 0, BUY: 1, HOLD: 2, SELL: 3, STRONG_SELL: 4 } as Record<string, number>;
      return (o[a.signal] ?? 5) - (o[b.signal] ?? 5);
    });

  const buyCnt      = allStocks.filter(s => s.signal === 'STRONG_BUY' || s.signal === 'BUY').length;
  const holdCnt     = allStocks.filter(s => s.signal === 'HOLD').length;
  const sellCnt     = allStocks.filter(s => s.signal === 'SELL' || s.signal === 'STRONG_SELL').length;
  const pct         = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const today       = new Date().toLocaleDateString('ko-KR', { year:'numeric', month:'long', day:'numeric', weekday:'short' });

  return (
    <div className="min-h-screen bg-bg-base">
      <div className="max-w-4xl mx-auto px-4 py-8">

        {/* ── Header ── */}
        <header className="mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border mb-4">
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-zinc-100">MOMENTUM SIGNAL</h1>
              <p className="text-xs text-zinc-600 mt-0.5">{today}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={resetAll}
                className="px-4 py-2.5 text-sm font-semibold rounded-lg border border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-all">
                초기화 ↺
              </button>
              {loading && (
                <button onClick={stopAnalysis}
                  className="px-4 py-2.5 text-sm font-semibold rounded-lg border border-red-800 text-red-400 hover:bg-red-950 transition-all">
                  중단
                </button>
              )}
              {activeTab === 'scanner' && (
                <button onClick={runAnalysis} disabled={loading || watchlist.length === 0}
                  className={`px-6 py-2.5 text-sm font-semibold rounded-lg border transition-all
                    ${loading ? 'bg-zinc-900 border-zinc-700 text-zinc-500 cursor-not-allowed'
                              : 'bg-emerald-500 border-emerald-400 text-black hover:bg-emerald-400 active:scale-95'}`}>
                  {loading
                    ? <span className="flex items-center gap-2"><span className="blink">▋</span>분석 중...</span>
                    : allStocks.length > 0 ? '재분석 실행' : '분석 실행 →'}
                </button>
              )}
            </div>
          </div>

          {/* Tab buttons */}
          <div className="flex flex-wrap gap-1">
            {([
              ['scanner',   '모멘텀 스캐너'],
              ['portfolio', '내 포트폴리오'],
              ['sectors',   '섹터 히트맵'],
              ['backtest',  '백테스트'],
            ] as [TabType, string][]).map(([tab, label]) => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors
                  ${activeTab === tab
                    ? 'bg-zinc-700 border-zinc-600 text-zinc-100'
                    : 'bg-transparent border-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>
                {label}
              </button>
            ))}
          </div>
        </header>

        {/* ── Portfolio Tab ── */}
        {activeTab === 'portfolio' && <PortfolioTab />}

        {/* ── Sector Heatmap Tab ── */}
        {activeTab === 'sectors' && <SectorHeatmap />}

        {/* ── Backtest Tab ── */}
        {activeTab === 'backtest' && <BacktestPanel />}

        {/* ── Scanner Tab ── */}
        {activeTab === 'scanner' && (
          <>
            <MarketStatus />
            <WatchlistManager watchlist={watchlist} onAdd={addTicker} onRemove={removeTicker} maxTickers={MAX_TICKERS} />

            {/* Excel Upload */}
            <div className="mb-6 p-4 border border-zinc-800 rounded-xl bg-zinc-900/40">
              <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-3">엑셀 일괄 업로드</div>
              <div className="flex flex-wrap items-center gap-3">
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} className="hidden" />
                <button onClick={() => fileRef.current?.click()}
                  className="text-sm px-4 py-2 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg hover:bg-zinc-700 transition-colors">
                  파일 선택 (.xlsx / .xls / .csv)
                </button>
                <button onClick={() => { setWatchlist(DEFAULT_TICKERS); setXlsxMsg(''); }}
                  className="text-xs px-3 py-2 border border-zinc-800 text-zinc-500 rounded-lg hover:text-zinc-300 transition-colors">
                  초기화
                </button>
                {xlsxMsg && (
                  <span className={`text-xs ${xlsxMsg.startsWith('✓') ? 'text-emerald-400' : 'text-zinc-400'}`}>
                    {xlsxMsg}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-zinc-700 mt-2">어느 셀에나 티커가 있으면 자동 추출. 최대 {MAX_TICKERS.toLocaleString()}개.</p>
            </div>

            {/* Progress bar */}
            {loading && progress.total > 0 && (
              <div className="mb-4">
                <div className="flex justify-between text-xs text-zinc-500 mb-1.5 font-mono">
                  <span>{status}</span>
                  <span className="text-emerald-400">{progress.done} / {progress.total} ({pct}%)</span>
                </div>
                <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                </div>
              </div>
            )}

            {!loading && status && (
              <div className="text-xs mb-4 font-mono text-zinc-500">{status}</div>
            )}

            {error && (
              <div className="mb-6 p-4 bg-red-950 border border-red-800 rounded-xl text-sm text-red-300">
                오류: {error}
              </div>
            )}

            {allStocks.length > 0 && (
              <>
                {marketCtx && (
                  <div className="mb-6 p-4 bg-zinc-900/60 border border-zinc-800 rounded-xl">
                    <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2">시장 컨텍스트</div>
                    <p className="text-xs text-zinc-400 leading-relaxed" style={{ fontFamily: 'system-ui, sans-serif' }}>{marketCtx}</p>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-3 mb-6">
                  <StatCard label="매수" value={buyCnt}  color="text-emerald-400" border="border-emerald-900" />
                  <StatCard label="관망" value={holdCnt} color="text-amber-400"   border="border-amber-900" />
                  <StatCard label="매도" value={sellCnt} color="text-red-400"     border="border-red-900" />
                </div>

                <TopPicks stocks={allStocks} />

                {/* Search */}
                <div className="relative mb-3">
                  <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="티커 검색 (예: AMD)"
                    className="w-full bg-zinc-900 border border-zinc-700 text-zinc-100 text-sm px-4 py-2.5 pl-9 rounded-lg placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 font-mono" />
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 text-sm">⌕</span>
                  {search && (
                    <button onClick={() => setSearch('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 text-xs">✕</button>
                  )}
                </div>

                {/* Filter + Sort */}
                <div className="flex flex-wrap gap-2 items-center justify-between mb-4">
                  <div className="flex flex-wrap gap-1">
                    {([
                      ['ALL',         `전체(${allStocks.length})`],
                      ['STRONG_BUY',  `즉시매수(${allStocks.filter(s => s.signal==='STRONG_BUY').length})`],
                      ['BUY',         `매수(${allStocks.filter(s => s.signal==='BUY').length})`],
                      ['HOLD',        `관망(${holdCnt})`],
                      ['SELL',        `매도(${allStocks.filter(s => s.signal==='SELL').length})`],
                      ['STRONG_SELL', `즉시매도(${allStocks.filter(s => s.signal==='STRONG_SELL').length})`],
                    ] as [FilterType, string][]).map(([f, label]) => (
                      <button key={f} onClick={() => setFilter(f)}
                        className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors
                          ${filter===f ? 'bg-zinc-700 border-zinc-600 text-zinc-100' : 'bg-transparent border-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-1">
                    {(['SCORE','SIGNAL','TICKER'] as SortType[]).map(s => (
                      <button key={s} onClick={() => setSort(s)}
                        className={`text-xs px-3 py-1.5 rounded-lg border transition-colors
                          ${sort===s ? 'bg-zinc-700 border-zinc-600 text-zinc-100' : 'bg-transparent border-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>
                        {s==='SCORE'?'점수순':s==='SIGNAL'?'신호순':'티커순'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                  {displayed.map((s, i) => (
                    <StockCard key={s.ticker} stock={s} highlight={i===0 && filter!=='SELL' && filter!=='STRONG_SELL'} onRemove={removeFromResults} earnings={earningsMap[s.ticker]} />
                  ))}
                  {displayed.length === 0 && (
                    <p className="text-sm text-zinc-600 py-6 text-center">해당 조건의 종목이 없습니다.</p>
                  )}
                </div>

                {analyzedAt && (
                  <div className="text-[10px] text-zinc-700 text-center mt-8">
                    마지막 분석: {new Date(analyzedAt).toLocaleString('ko-KR')}
                  </div>
                )}
              </>
            )}

            {allStocks.length === 0 && !loading && !error && (
              <div className="text-center py-20">
                <div className="text-5xl mb-4 text-zinc-800">◈</div>
                <p className="text-zinc-600 text-sm mb-1">분석을 시작하려면 위 버튼을 클릭하세요.</p>
                <p className="text-zinc-700 text-xs">Yahoo Finance 실시간 데이터 · 최대 1,000종목 지원</p>
              </div>
            )}
          </>
        )}

        <footer className="mt-10 pt-6 border-t border-border">
          <p className="text-[10px] text-zinc-700 leading-relaxed text-center" style={{ fontFamily: 'system-ui, sans-serif' }}>
            ⚠ Yahoo Finance 공개 데이터 기반 참고 정보이며, 금융 투자 권유가 아닙니다. 투자 판단 및 손익 책임은 본인에게 있습니다.
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
