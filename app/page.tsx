'use client';

import { useState, useEffect, useRef } from 'react';
import type { AnalysisResult } from '@/types/stock';
import StockCard        from '@/components/StockCard';
import TopPicks         from '@/components/TopPicks';
import WatchlistManager from '@/components/WatchlistManager';

const DEFAULT_TICKERS = ['AMD', 'MRVL', 'AVGO', 'MU', 'INTC', 'ARM', 'NVDA', 'TSM'];
const CACHE_KEY     = 'mt_analysis_v3';
const WATCHLIST_KEY = 'mt_watchlist_v2';
const MAX_TICKERS   = 50;

const STATUS_STEPS = [
  '> Yahoo Finance 실시간 데이터 수집 중...',
  '> RS 지표 계산 중 (S&P500 대비)...',
  '> 50일/200일 이동평균 분석 중...',
  '> 모멘텀 패턴 감지 중...',
  '> 매수/매도 신호 생성 중...',
];

type FilterType = 'ALL' | 'BUY' | 'SELL' | 'HOLD';
type SortType   = 'SCORE' | 'TICKER' | 'SIGNAL';

function todayKey() { return new Date().toISOString().slice(0, 10); }

function isTicker(val: string): boolean {
  const t = val.trim().toUpperCase();
  return /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/.test(t);
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

export default function Home() {
  const [watchlist,  setWatchlist]  = useState<string[]>(DEFAULT_TICKERS);
  const [result,     setResult]     = useState<AnalysisResult | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [status,     setStatus]     = useState('');
  const [error,      setError]      = useState('');
  const [filter,     setFilter]     = useState<FilterType>('ALL');
  const [sort,       setSort]       = useState<SortType>('SCORE');
  const [stepIdx,    setStepIdx]    = useState(0);
  const [xlsxMsg,    setXlsxMsg]    = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try { const wl = localStorage.getItem(WATCHLIST_KEY); if (wl) setWatchlist(JSON.parse(wl)); } catch {}
    try {
      const c = localStorage.getItem(CACHE_KEY);
      if (c) { const p = JSON.parse(c); if (p.date === todayKey()) setResult(p.result); }
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist)); } catch {}
  }, [watchlist]);

  function addTicker(t: string)    { if (watchlist.length < MAX_TICKERS) setWatchlist(w => [...w, t]); }
  function removeTicker(t: string) { setWatchlist(w => w.filter(x => x !== t)); }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setXlsxMsg('파일 읽는 중...');
    try {
      const found = await parseExcelTickers(file);
      if (found.length === 0) { setXlsxMsg('티커를 찾지 못했습니다.'); return; }
      const prev = watchlist.length;
      const merged = [...new Set([...watchlist, ...found])].slice(0, MAX_TICKERS);
      setWatchlist(merged);
      setXlsxMsg(`✓ ${found.length}개 발견 → ${merged.length - prev}개 추가 (총 ${merged.length}개)`);
    } catch (err) { setXlsxMsg(`오류: ${String(err)}`); }
    e.target.value = '';
  }

  async function runAnalysis() {
    if (watchlist.length === 0 || loading) return;
    setLoading(true); setError(''); setStepIdx(0);
    const iv = setInterval(() => setStepIdx(i => (i + 1) % STATUS_STEPS.length), 2500);
    setStatus(STATUS_STEPS[0]);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: watchlist }),
      });
      clearInterval(iv);
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || `HTTP ${res.status}`); }
      const data: AnalysisResult = await res.json();
      setResult(data);
      setStatus(`> 완료 — ${data.stocks.length}개 종목 | ${new Date().toLocaleTimeString('ko-KR')}`);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ date: todayKey(), result: data })); } catch {}
    } catch (err) { clearInterval(iv); setError(String(err)); setStatus(''); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (loading) setStatus(STATUS_STEPS[stepIdx]); }, [stepIdx, loading]);

  const displayed = result
    ? [...result.stocks]
        .filter(s => filter === 'ALL' || s.signal === filter)
        .sort((a, b) => {
          if (sort === 'SCORE')  return Number(b.momentum_score) - Number(a.momentum_score);
          if (sort === 'TICKER') return a.ticker.localeCompare(b.ticker);
          const o = { BUY: 0, HOLD: 1, SELL: 2 } as Record<string, number>;
          return (o[a.signal] ?? 3) - (o[b.signal] ?? 3);
        })
    : [];

  const buyCnt  = result?.stocks.filter(s => s.signal === 'BUY').length  ?? 0;
  const sellCnt = result?.stocks.filter(s => s.signal === 'SELL').length ?? 0;
  const holdCnt = result?.stocks.filter(s => s.signal === 'HOLD').length ?? 0;

  const today = new Date().toLocaleDateString('ko-KR', { year:'numeric', month:'long', day:'numeric', weekday:'short' });

  return (
    <div className="min-h-screen bg-bg-base">
      <div className="max-w-4xl mx-auto px-4 py-8">

        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 pb-6 border-b border-border">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-zinc-100">MOMENTUM SIGNAL</h1>
            <p className="text-xs text-zinc-600 mt-0.5">{today}</p>
          </div>
          <button onClick={runAnalysis} disabled={loading || watchlist.length === 0}
            className={`px-6 py-2.5 text-sm font-semibold rounded-lg border transition-all
              ${loading ? 'bg-zinc-900 border-zinc-700 text-zinc-500 cursor-not-allowed'
                        : 'bg-emerald-500 border-emerald-400 text-black hover:bg-emerald-400 active:scale-95'}`}>
            {loading ? <span className="flex items-center gap-2"><span className="blink">▋</span>분석 중...</span>
                     : result ? '재분석 실행' : '분석 실행 →'}
          </button>
        </header>

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
            {xlsxMsg && <span className={`text-xs ${xlsxMsg.startsWith('✓') ? 'text-emerald-400' : 'text-zinc-400'}`}>{xlsxMsg}</span>}
          </div>
          <p className="text-[10px] text-zinc-700 mt-2">엑셀 어느 셀에나 티커가 있으면 자동 추출. 최대 {MAX_TICKERS}개.</p>
        </div>

        {(status || loading) && (
          <div className={`text-xs mb-4 font-mono ${loading ? 'text-sky-500' : 'text-zinc-500'}`}>
            {loading && <span className="blink mr-1">▋</span>}{status}
          </div>
        )}

        {error && <div className="mb-6 p-4 bg-red-950 border border-red-800 rounded-xl text-sm text-red-300">오류: {error}</div>}

        {result && (
          <>
            {result.market_context && (
              <div className="mb-6 p-4 bg-zinc-900/60 border border-zinc-800 rounded-xl">
                <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2">시장 컨텍스트</div>
                <p className="text-xs text-zinc-400 leading-relaxed" style={{ fontFamily: 'system-ui, sans-serif' }}>{result.market_context}</p>
              </div>
            )}
            <div className="grid grid-cols-3 gap-3 mb-6">
              <StatCard label="매수" value={buyCnt}  color="text-emerald-400" border="border-emerald-900" />
              <StatCard label="관망" value={holdCnt} color="text-amber-400"   border="border-amber-900" />
              <StatCard label="매도" value={sellCnt} color="text-red-400"     border="border-red-900" />
            </div>
            <TopPicks stocks={result.stocks} />
            <div className="flex flex-wrap gap-2 items-center justify-between mb-4">
              <div className="flex gap-1">
                {(['ALL','BUY','SELL','HOLD'] as FilterType[]).map(f => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${filter===f ? 'bg-zinc-700 border-zinc-600 text-zinc-100' : 'bg-transparent border-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>
                    {f==='ALL'?'전체':f==='BUY'?'매수':f==='SELL'?'매도':'관망'}
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                {(['SCORE','SIGNAL','TICKER'] as SortType[]).map(s => (
                  <button key={s} onClick={() => setSort(s)}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${sort===s ? 'bg-zinc-700 border-zinc-600 text-zinc-100' : 'bg-transparent border-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>
                    {s==='SCORE'?'점수순':s==='SIGNAL'?'신호순':'티커순'}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-4">
              {displayed.map((s, i) => <StockCard key={s.ticker} stock={s} highlight={i===0 && filter!=='SELL'} />)}
              {displayed.length === 0 && <p className="text-sm text-zinc-600 py-6 text-center">해당 조건의 종목이 없습니다.</p>}
            </div>
            <div className="text-[10px] text-zinc-700 text-center mt-8">마지막 분석: {new Date(result.analyzed_at).toLocaleString('ko-KR')}</div>
          </>
        )}

        {!result && !loading && !error && (
          <div className="text-center py-20">
            <div className="text-5xl mb-4 text-zinc-800">◈</div>
            <p className="text-zinc-600 text-sm mb-1">분석을 시작하려면 위 버튼을 클릭하세요.</p>
            <p className="text-zinc-700 text-xs">Yahoo Finance 실시간 데이터 기반으로 분석합니다.</p>
          </div>
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
