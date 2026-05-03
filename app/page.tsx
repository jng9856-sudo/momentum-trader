'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { AnalysisResult, StockAnalysis } from '@/types/stock';
import StockCard from '@/components/StockCard';
import WatchlistManager from '@/components/WatchlistManager';
import PortfolioTab from '@/components/PortfolioTab';
import MarketStatus from '@/components/MarketStatus';
import SectorHeatmap from '@/components/SectorHeatmap';
import BacktestPanel from '@/components/BacktestPanel';

const DEFAULT_TICKERS = ['PLTR'];
const CACHE_KEY = 'mt_analysis_v4';
const WATCHLIST_KEY = 'mt_watchlist_v3';
const MAX_TICKERS = 1000;
const BATCH_SIZE = 50;

type FilterType = 'ALL' | 'BREAKOUT' | 'SETUP' | 'WATCH' | 'HOLD' | 'SELL' | 'STRONG_SELL';
type SortType = 'SCORE' | 'TICKER' | 'SIGNAL';
type TabType = 'scanner' | 'portfolio' | 'sectors' | 'backtest';

const SECTOR_MAP: Record<string, string> = {
  // ── 반도체 ──────────────────────────────────────────────────────────────
  NVDA:'반도체', AMD:'반도체', AVGO:'반도체', MU:'반도체', INTC:'반도체',
  ARM:'반도체', MRVL:'반도체', TSM:'반도체', QCOM:'반도체', AMAT:'반도체',
  LRCX:'반도체', KLAC:'반도체', ASML:'반도체', ON:'반도체', SWKS:'반도체',
  MCHP:'반도체', TXN:'반도체', ADI:'반도체', MPWR:'반도체', SLAB:'반도체',
  AMBA:'반도체', NXPI:'반도체', STM:'반도체', UMC:'반도체', GFS:'반도체',
  WOLF:'반도체', CRUS:'반도체', RMBS:'반도체', ACLS:'반도체', ONTO:'반도체',
  SMCI:'반도체', COHU:'반도체', ICHR:'반도체', FORM:'반도체', MKSI:'반도체',
  SITM:'반도체', ALGM:'반도체', DIOD:'반도체', MTSI:'반도체', POWI:'반도체',
  ATOM:'반도체', AXTI:'반도체', SIMO:'반도체', TSEM:'반도체',
  NVTS:'반도체', CRDO:'반도체', SNDK:'반도체',

  // ── AI·소프트웨어 ────────────────────────────────────────────────────────
  MSFT:'AI·소프트웨어', GOOGL:'AI·소프트웨어', GOOG:'AI·소프트웨어',
  META:'AI·소프트웨어', CRM:'AI·소프트웨어', SNOW:'AI·소프트웨어',
  DDOG:'AI·소프트웨어', ZS:'AI·소프트웨어', CRWD:'AI·소프트웨어',
  PANW:'AI·소프트웨어', FTNT:'AI·소프트웨어', NET:'AI·소프트웨어',
  OKTA:'AI·소프트웨어', HUBS:'AI·소프트웨어', WDAY:'AI·소프트웨어',
  NOW:'AI·소프트웨어', ADBE:'AI·소프트웨어', INTU:'AI·소프트웨어',
  TEAM:'AI·소프트웨어', PATH:'AI·소프트웨어', AI:'AI·소프트웨어',
  PLTR:'AI·소프트웨어', GTLB:'AI·소프트웨어', MDB:'AI·소프트웨어',
  CFLT:'AI·소프트웨어', S:'AI·소프트웨어', BILL:'AI·소프트웨어',
  SHOP:'AI·소프트웨어', TOST:'AI·소프트웨어', APP:'AI·소프트웨어',
  SMAR:'AI·소프트웨어', ASAN:'AI·소프트웨어', ZI:'AI·소프트웨어',
  VEEV:'AI·소프트웨어', CDAY:'AI·소프트웨어', PCTY:'AI·소프트웨어',
  PAYC:'AI·소프트웨어', APPF:'AI·소프트웨어', DOCU:'AI·소프트웨어',
  TWLO:'AI·소프트웨어', ESTC:'AI·소프트웨어', DOMO:'AI·소프트웨어',
  RNG:'AI·소프트웨어', ZM:'AI·소프트웨어', NICE:'AI·소프트웨어',
  CYBR:'AI·소프트웨어', TENB:'AI·소프트웨어', QLYS:'AI·소프트웨어',
  VRNS:'AI·소프트웨어', SAIL:'AI·소프트웨어',
  ARKK:'AI·소프트웨어', ARKW:'AI·소프트웨어', ARKQ:'AI·소프트웨어',
  IONQ:'AI·소프트웨어', RGTI:'AI·소프트웨어', QUBT:'AI·소프트웨어',
  QBTS:'AI·소프트웨어', QTUM:'AI·소프트웨어',
  NBIS:'AI·소프트웨어', ADEA:'AI·소프트웨어', BAND:'AI·소프트웨어',
  CRWV:'AI·소프트웨어', SNPS:'AI·소프트웨어', SOUN:'AI·소프트웨어',
  BBAI:'AI·소프트웨어', RZLV:'AI·소프트웨어', IREN:'AI·소프트웨어',

  // ── 빅테크·하드웨어 ──────────────────────────────────────────────────────
  AAPL:'빅테크·하드웨어', AMZN:'빅테크·하드웨어', ORCL:'빅테크·하드웨어',
  IBM:'빅테크·하드웨어', HPQ:'빅테크·하드웨어', DELL:'빅테크·하드웨어',
  HPE:'빅테크·하드웨어', WDC:'빅테크·하드웨어', STX:'빅테크·하드웨어',
  NTAP:'빅테크·하드웨어', PSTG:'빅테크·하드웨어', ANET:'빅테크·하드웨어',
  CSCO:'빅테크·하드웨어', JNPR:'빅테크·하드웨어', FFIV:'빅테크·하드웨어',
  AKAM:'빅테크·하드웨어', CDW:'빅테크·하드웨어',
  BHE:'빅테크·하드웨어', LWLG:'빅테크·하드웨어', NOK:'빅테크·하드웨어',
  IRM:'빅테크·하드웨어', SILC:'빅테크·하드웨어',

  // ── 방산·항공우주 ────────────────────────────────────────────────────────
  LMT:'방산·항공우주', RTX:'방산·항공우주', NOC:'방산·항공우주',
  GD:'방산·항공우주', BA:'방산·항공우주', HII:'방산·항공우주',
  TDG:'방산·항공우주', LDOS:'방산·항공우주', KTOS:'방산·항공우주',
  CACI:'방산·항공우주', SAIC:'방산·항공우주', AXON:'방산·항공우주',
  DRS:'방산·항공우주', AVAV:'방산·항공우주', RKLB:'방산·항공우주',
  ARKX:'방산·항공우주', ITA:'방산·항공우주', XAR:'방산·항공우주',
  PL:'방산·항공우주', SPCE:'방산·항공우주', ASTS:'방산·항공우주',
  
  // ── 원자력·전력 ──────────────────────────────────────────────────────────
  SMR:'원자력·전력', OKLO:'원자력·전력', LEU:'원자력·전력',
  CCJ:'원자력·전력', UEC:'원자력·전력', NNE:'원자력·전력',
  BWXT:'원자력·전력', TLN:'원자력·전력', VST:'원자력·전력',
  CEG:'원자력·전력', ETR:'원자력·전력', EXC:'원자력·전력',

  // ── 친환경에너지 ─────────────────────────────────────────────────────────
  PLUG:'친환경에너지', BE:'친환경에너지', FCEL:'친환경에너지',
  ENPH:'친환경에너지', SEDG:'친환경에너지', FSLR:'친환경에너지',
  RUN:'친환경에너지', ARRY:'친환경에너지', NEE:'친환경에너지',

  // ── 전기차·배터리 ────────────────────────────────────────────────────────
  TSLA:'전기차·배터리', RIVN:'전기차·배터리', LCID:'전기차·배터리',
  NIO:'전기차·배터리', XPEV:'전기차·배터리', LI:'전기차·배터리',
  CHPT:'전기차·배터리', BLNK:'전기차·배터리', QS:'전기차·배터리',
  ABAT:'전기차·배터리',

  // ── 전통에너지 ───────────────────────────────────────────────────────────
  XOM:'전통에너지', CVX:'전통에너지', SLB:'전통에너지', COP:'전통에너지',
  OXY:'전통에너지', HAL:'전통에너지', BKR:'전통에너지', PSX:'전통에너지',
  MPC:'전통에너지', VLO:'전통에너지', DVN:'전통에너지', EOG:'전통에너지',
  LNG:'전통에너지', MRO:'전통에너지', APA:'전통에너지', HES:'전통에너지',
  FTI:'전통에너지', NGL:'전통에너지', SBR:'전통에너지', DINO:'전통에너지',

  // ── 헬스케어·제약 ────────────────────────────────────────────────────────
  LLY:'헬스케어·제약', JNJ:'헬스케어·제약', UNH:'헬스케어·제약',
  PFE:'헬스케어·제약', MRK:'헬스케어·제약', ABBV:'헬스케어·제약',
  BMY:'헬스케어·제약', AMGN:'헬스케어·제약', GILD:'헬스케어·제약',
  REGN:'헬스케어·제약', VRTX:'헬스케어·제약', NVO:'헬스케어·제약',
  ABT:'헬스케어·제약', MDT:'헬스케어·제약', SYK:'헬스케어·제약',
  BSX:'헬스케어·제약', ISRG:'헬스케어·제약', TMO:'헬스케어·제약',
  BTSG:'헬스케어·제약', DHC:'헬스케어·제약', HIMS:'헬스케어·제약',
  AZN:'헬스케어·제약',

  // ── 바이오테크 ───────────────────────────────────────────────────────────
  MRNA:'바이오테크', BNTX:'바이오테크', BEAM:'바이오테크',
  CRSP:'바이오테크', EDIT:'바이오테크', NTLA:'바이오테크',
  RXRX:'바이오테크', VERA:'바이오테크', ILMN:'바이오테크',
  IONS:'바이오테크', ALNY:'바이오테크', INCY:'바이오테크',
  ARKG:'바이오테크', IBB:'바이오테크', XBI:'바이오테크',
  TEM:'바이오테크',

  // ── 금융·핀테크 ──────────────────────────────────────────────────────────
  JPM:'금융·핀테크', BAC:'금융·핀테크', GS:'금융·핀테크',
  MS:'금융·핀테크', WFC:'금융·핀테크', V:'금융·핀테크',
  MA:'금융·핀테크', PYPL:'금융·핀테크', SQ:'금융·핀테크',
  AFRM:'금융·핀테크', SOFI:'금융·핀테크', NU:'금융·핀테크',
  HOOD:'금융·핀테크', COIN:'금융·핀테크', MARA:'금융·핀테크',
  RIOT:'금융·핀테크', MSTR:'금융·핀테크', BLK:'금융·핀테크',
  C:'금융·핀테크', AXP:'금융·핀테크', COF:'금융·핀테크',
  ARKF:'금융·핀테크', FINX:'금융·핀테크',
  FNRN:'금융·핀테크', RILY:'금융·핀테크', PRAA:'금융·핀테크',
  RMR:'금융·핀테크', CBOE:'금융·핀테크', HUT:'금융·핀테크',
  PGY:'금융·핀테크', CRCL:'금융·핀테크',
  ASST:'금융·핀테크', BLSH:'금융·핀테크',

  // ── 소비재·미디어 ────────────────────────────────────────────────────────
  NFLX:'소비재·미디어', DIS:'소비재·미디어', SPOT:'소비재·미디어',
  TTD:'소비재·미디어', RBLX:'소비재·미디어', EA:'소비재·미디어',
  ROKU:'소비재·미디어', LAMR:'소비재·미디어', CMPR:'소비재·미디어',

  // ── 소비재·유통 ──────────────────────────────────────────────────────────
  HD:'소비재·유통', LOW:'소비재·유통', WMT:'소비재·유통',
  COST:'소비재·유통', NKE:'소비재·유통', SBUX:'소비재·유통',
  MCD:'소비재·유통', UBER:'소비재·유통', ABNB:'소비재·유통',
  ZGN:'소비재·유통',

  // ── 산업재·소재 ──────────────────────────────────────────────────────────
  GE:'산업재·소재', HON:'산업재·소재', CAT:'산업재·소재',
  DE:'산업재·소재', ETN:'산업재·소재', EMR:'산업재·소재',
  FCX:'산업재·소재', NEM:'산업재·소재', AA:'산업재·소재',
  GTX:'산업재·소재', MP:'산업재·소재', NVT:'산업재·소재',
  NWPX:'산업재·소재', MTRN:'산업재·소재', SHIP:'산업재·소재',
  CTRI:'산업재·소재', MTZ:'산업재·소재', TRN:'산업재·소재',
  SNDR:'산업재·소재', HUN:'산업재·소재', CTOS:'산업재·소재',
  MATW:'산업재·소재', RGLD:'산업재·소재',
};

const YF_SECTOR_MAP: Record<string, string> = {
  'Technology': 'AI·소프트웨어',
  'Healthcare': '헬스케어·제약',
  'Financial Services': '금융·핀테크',
  'Consumer Cyclical': '소비재·유통',
  'Consumer Defensive': '소비재·유통',
  'Communication Services': '소비재·미디어',
  'Energy': '전통에너지',
  'Industrials': '산업재·소재',
  'Basic Materials': '산업재·소재',
  'Utilities': '원자력·전력',
  'Real Estate': '기타',
};

const SECTOR_ORDER = [
  '반도체', 'AI·소프트웨어', '빅테크·하드웨어', '방산·항공우주',
  '원자력·전력', '친환경에너지', '전기차·배터리', '전통에너지',
  '헬스케어·제약', '바이오테크', '금융·핀테크',
  '소비재·미디어', '소비재·유통', '산업재·소재', '기타',
];

function getSector(s: StockAnalysis): string {
  const ticker = s.ticker.toUpperCase();
  if (SECTOR_MAP[ticker]) return SECTOR_MAP[ticker];
  if (s.sector && YF_SECTOR_MAP[s.sector]) return YF_SECTOR_MAP[s.sector];
  if (s.sector) return s.sector;
  return '기타';
}

function todayKey() { return new Date().toISOString().slice(0, 10); }

function isTicker(val: string): boolean {
  const t = val.trim().toUpperCase();
  return /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/.test(t) && t.length >= 1;
}

async function parseExcelTickers(file: File): Promise<string[]> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const tickers: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
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
  const [activeTab, setActiveTab] = useState<TabType>('scanner');
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [allStocks, setAllStocks] = useState<StockAnalysis[]>([]);
  const [marketCtx, setMarketCtx] = useState('');
  const [analyzedAt, setAnalyzedAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<FilterType>('ALL');
  const [sort, setSort] = useState<SortType>('SCORE');
  const [xlsxOpen, setXlsxOpen] = useState(false);
  const [xlsxMsg, setXlsxMsg] = useState('');
  const [search, setSearch] = useState('');
  const [ctxOpen, setCtxOpen] = useState(false);
  const [isCompact, setIsCompact] = useState(false);
  const [drawerTicker, setDrawerTicker] = useState<string | null>(null);
  const [earningsMap, setEarningsMap] = useState<Record<string, { earningsDate: string | null; daysUntil: number | null; epsEstimate: number | null; revenueEstimate: string | null; lastEPS: number | null }>>({});
  const [collapsedSectors, setCollapsedSectors] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);

  function toggleSector(name: string) {
    setCollapsedSectors(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerTicker(null); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    fetch('/api/db?type=watchlist').then(r => r.json()).then(d => {
      if (d.tickers?.length > 0) setWatchlist(d.tickers);
      else { try { const wl = localStorage.getItem(WATCHLIST_KEY); if (wl) setWatchlist(JSON.parse(wl)); } catch {} }
    }).catch(() => { try { const wl = localStorage.getItem(WATCHLIST_KEY); if (wl) setWatchlist(JSON.parse(wl)); } catch {} });

    fetch(`/api/db?type=analysis&date=${todayKey()}`).then(r => r.json()).then(d => {
      if (d && !d.empty && d.stocks?.length > 0) {
        setAllStocks(d.stocks); setMarketCtx(d.market_context ?? '');
        setAnalyzedAt(d.analyzed_at ?? new Date().toISOString());
        setStatus(`> 크론 분석 결과 로드 완료 — ${d.stocks.length}개 종목`);
        return;
      }
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

  function addTicker(t: string) { if (watchlist.length < MAX_TICKERS) setWatchlist(w => [...w, t]); }
  function removeTicker(t: string) { setWatchlist(w => w.filter(x => x !== t)); }

  function removeFromResults(ticker: string) {
    setAllStocks(s => s.filter(x => x.ticker !== ticker));
    setWatchlist(w => w.filter(x => x !== ticker));
    if (drawerTicker === ticker) setDrawerTicker(null);
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
      const prev = watchlist.length;
      const merged = [...new Set([...watchlist, ...found])].slice(0, MAX_TICKERS);
      setWatchlist(merged);
      setXlsxMsg(`✓ ${found.length}개 → ${merged.length - prev}개 추가`);
    } catch (err) { setXlsxMsg(`오류: ${String(err)}`); }
    e.target.value = '';
  }

  const runAnalysis = useCallback(async () => {
    if (watchlist.length === 0 || loading) return;
    abortRef.current = false;

    const analyzedSet = new Set(allStocks.map(s => s.ticker));
    const tickersToAnalyze = watchlist.filter(t => !analyzedSet.has(t));

    if (tickersToAnalyze.length === 0) {
      setStatus('> 추가된 새 종목이 없습니다. 초기화(↺) 후 재분석하세요.');
      return;
    }

    setLoading(true); setError(''); setSearch('');
    const batches = chunk(tickersToAnalyze, BATCH_SIZE);
    setProgress({ done: 0, total: tickersToAnalyze.length });

    let accumulated: StockAnalysis[] = [...allStocks];
    let firstCtx = marketCtx || '';

    for (let i = 0; i < batches.length; i++) {
      if (abortRef.current) break;
      setStatus(`> 배치 ${i+1}/${batches.length} 처리 중...`);
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
      setProgress({ done: Math.min(tickersToAnalyze.length, (i+1) * BATCH_SIZE), total: tickersToAnalyze.length });
    }

    const ts = new Date().toISOString();
    setAnalyzedAt(ts);
    setStatus(`> 완료 — ${accumulated.length}개 종목 · 실적 조회 중...`);

    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ date: todayKey(), stocks: accumulated, market_context: firstCtx, analyzed_at: ts })); } catch {}
    await saveAnalysisToDB(accumulated, firstCtx, ts);

    try {
      const tBatches = chunk(tickersToAnalyze, 20);
      const eMap: Record<string, { earningsDate: string | null; daysUntil: number | null; epsEstimate: number | null; revenueEstimate: string | null; lastEPS: number | null }> = { ...earningsMap };
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

    setStatus(`> 완료 — ${accumulated.length}개 | ${new Date().toLocaleTimeString('ko-KR')}`);
    setLoading(false);
  }, [watchlist, loading, allStocks, marketCtx, earningsMap]);

  function stopAnalysis() { abortRef.current = true; setLoading(false); setStatus('> 분석 중단됨'); }

  function resetAll() {
    abortRef.current = true;
    setLoading(false); setAllStocks([]); setMarketCtx(''); setAnalyzedAt('');
    setStatus(''); setError(''); setSearch(''); setFilter('ALL'); setSort('SCORE');
    setWatchlist([]); setXlsxMsg(''); setXlsxOpen(false); setCtxOpen(false);
    setIsCompact(false); setDrawerTicker(null); setEarningsMap({});
    setCollapsedSectors(new Set());
    try { localStorage.removeItem(CACHE_KEY); localStorage.removeItem(WATCHLIST_KEY); localStorage.removeItem('mt_earnings_v1'); } catch {}
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
      if (sort === 'SCORE') return Number(b.momentum_score) - Number(a.momentum_score);
      if (sort === 'TICKER') return a.ticker.localeCompare(b.ticker);
      const o = { BREAKOUT: 0, SETUP: 1, WATCH: 2, HOLD: 3, SELL: 4, STRONG_SELL: 5 } as Record<string, number>;
      return (o[a.signal] ?? 9) - (o[b.signal] ?? 9);
    });

  const holdCnt = allStocks.filter(s => s.signal === 'HOLD').length;
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });

  const analyzedSet = new Set(allStocks.map(s => s.ticker));
  const newTickerCount = watchlist.filter(t => !analyzedSet.has(t)).length;

  const analyzeButtonLabel = loading
    ? <span className="flex items-center gap-1"><span className="blink">▋</span>분석 중...</span>
    : newTickerCount > 0
      ? `+${newTickerCount}개 분석 →`
      : allStocks.length > 0
        ? '✓ 완료'
        : '분석 →';

  const drawerStock = drawerTicker ? allStocks.find(s => s.ticker === drawerTicker) ?? null : null;

  return (
    <div className="min-h-screen bg-bg-base">
      <div className="max-w-[1400px] mx-auto px-3 sm:px-6 py-4 sm:py-8">
        <header className="mb-3 sticky top-0 z-20 bg-bg-base pt-1 pb-2">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-border mb-3">
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-semibold tracking-tight text-zinc-100 whitespace-nowrap">MOMENTUM SIGNAL</h1>
              <p className="text-xs text-zinc-600 mt-0.5">{today}</p>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <button onClick={resetAll}
                className="px-3 py-2 text-xs font-semibold rounded-lg border border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-all whitespace-nowrap">↺</button>
              {loading && (
                <button onClick={stopAnalysis}
                  className="px-3 py-2 text-xs font-semibold rounded-lg border border-red-800 text-red-400 hover:bg-red-950 transition-all whitespace-nowrap">중단</button>
              )}
              {activeTab === 'scanner' && (
                <button onClick={runAnalysis} disabled={loading || watchlist.length === 0}
                  className={`px-3 sm:px-5 py-2 text-xs sm:text-sm font-semibold rounded-lg border transition-all whitespace-nowrap
                    ${loading ? 'bg-zinc-900 border-zinc-700 text-zinc-500 cursor-not-allowed'
                      : newTickerCount > 0 ? 'bg-emerald-500 border-emerald-400 text-black hover:bg-emerald-400 active:scale-95'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-400 cursor-not-allowed'}`}>
                  {analyzeButtonLabel}
                </button>
              )}
            </div>
          </div>
          <div className="flex gap-1 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {([
              ['scanner',   '모멘텀 스캐너'],
              ['portfolio', '내 포트폴리오'],
              ['sectors',   '섹터 히트맵'],
              ['backtest',  '백테스트'],
            ] as [TabType, string][]).map(([tab, label]) => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`px-3 py-2 text-xs sm:text-sm font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0
                  ${activeTab === tab ? 'bg-zinc-700 border-zinc-600 text-zinc-100' : 'bg-transparent border-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>
                {label}
              </button>
            ))}
          </div>
        </header>

        {activeTab === 'portfolio' && <PortfolioTab />}
        {activeTab === 'sectors'   && <SectorHeatmap />}
        {activeTab === 'backtest'  && <BacktestPanel />}

        {activeTab === 'scanner' && (
          <>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mb-3">
              <MarketStatus />
              <WatchlistManager watchlist={watchlist} onAdd={addTicker} onRemove={removeTicker} maxTickers={MAX_TICKERS} />
              {marketCtx ? (
                <div className="border border-zinc-800 rounded-xl bg-zinc-900/60 overflow-hidden">
                  <button onClick={() => setCtxOpen(o => !o)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-zinc-800/30 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-[10px] text-zinc-600 uppercase tracking-widest shrink-0">시장 컨텍스트</span>
                      {!ctxOpen && <p className="text-xs text-zinc-500 truncate" style={{ fontFamily: 'system-ui, sans-serif' }}>{marketCtx.slice(0, 60)}...</p>}
                    </div>
                    <span className="text-zinc-600 text-xs shrink-0 ml-2">{ctxOpen ? '▲' : '▼'}</span>
                  </button>
                  {ctxOpen && (
                    <div className="px-4 pb-4 border-t border-zinc-800/50 pt-3">
                      <p className="text-xs text-zinc-400 leading-relaxed" style={{ fontFamily: 'system-ui, sans-serif' }}>{marketCtx}</p>
                    </div>
                  )}
                </div>
              ) : <div />}
              <div className="border border-zinc-800 rounded-xl bg-zinc-900/40 overflow-hidden">
                <button onClick={() => setXlsxOpen(o => !o)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-zinc-800/40 transition-colors">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-widest">엑셀 일괄 업로드</span>
                  <span className="text-zinc-600 text-xs">{xlsxOpen ? '▲' : '▼'}</span>
                </button>
                {xlsxOpen && (
                  <div className="px-4 pb-4 border-t border-zinc-800/50 pt-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} className="hidden" />
                      <button onClick={() => fileRef.current?.click()}
                        className="text-sm px-4 py-2 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg hover:bg-zinc-700 transition-colors">파일 선택</button>
                      <button onClick={() => { setWatchlist(DEFAULT_TICKERS); setXlsxMsg(''); }}
                        className="text-xs px-3 py-2 border border-zinc-800 text-zinc-500 rounded-lg hover:text-zinc-300 transition-colors">초기화</button>
                      {xlsxMsg && (
                        <span className={`text-xs ${xlsxMsg.startsWith('✓') ? 'text-emerald-400' : 'text-zinc-400'}`}>{xlsxMsg}</span>
                      )}
                    </div>
                    <p className="text-[10px] text-zinc-700 mt-2">어느 셀에나 티커가 있으면 자동 추출. 최대 {MAX_TICKERS.toLocaleString()}개.</p>
                  </div>
                )}
              </div>
            </div>

            {loading && progress.total > 0 && (
              <div className="fixed bottom-6 right-4 z-50 w-64 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-zinc-300">분석 중...</span>
                  <span className="text-xs font-mono text-emerald-400">{pct}%</span>
                </div>
                <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden mb-2">
                  <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                </div>
                <button onClick={stopAnalysis}
                  className="w-full text-xs py-1.5 rounded-lg border border-red-800 text-red-400 hover:bg-red-950 transition-colors">중단</button>
              </div>
            )}

            {error && <div className="mb-3 p-3 bg-red-950 border border-red-800 rounded-xl text-sm text-red-300">오류: {error}</div>}

            {allStocks.length > 0 && (
              <>
                <div className="relative mb-3">
                  <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="티커 검색 (예: AMD)"
                    className="w-full bg-zinc-900 border border-zinc-700 text-zinc-100 text-sm px-4 py-2.5 pl-9 rounded-lg placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 font-mono" />
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 text-sm">⌕</span>
                  {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 text-xs">✕</button>}
                </div>

                <div className="mb-3 sticky top-[100px] z-10 bg-bg-base py-2">
                  <div className="flex gap-1 overflow-x-auto mb-2" style={{ scrollbarWidth: 'none' }}>
                    {([
                      ['ALL',         `전체(${allStocks.length})`],
                      ['BREAKOUT',    `즉시진입(${allStocks.filter(s => s.signal==='BREAKOUT').length})`],
                      ['SETUP',       `진입대기(${allStocks.filter(s => s.signal==='SETUP').length})`],
                      ['WATCH',       `관심등록(${allStocks.filter(s => s.signal==='WATCH').length})`],
                      ['HOLD',        `관망(${holdCnt})`],
                      ['SELL',        `매도(${allStocks.filter(s => s.signal==='SELL').length})`],
                      ['STRONG_SELL', `즉시매도(${allStocks.filter(s => s.signal==='STRONG_SELL').length})`],
                    ] as [FilterType, string][]).map(([f, label]) => (
                      <button key={f} onClick={() => setFilter(f)}
                        className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors whitespace-nowrap shrink-0
                          ${filter===f ? 'bg-zinc-700 border-zinc-600 text-zinc-100' : 'bg-transparent border-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                    {(['SCORE','SIGNAL','TICKER'] as SortType[]).map(s => (
                      <button key={s} onClick={() => setSort(s)}
                        className={`text-xs px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap shrink-0
                          ${sort===s ? 'bg-zinc-700 border-zinc-600 text-zinc-100' : 'bg-transparent border-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>
                        {s==='SCORE'?'점수순':s==='SIGNAL'?'신호순':'티커순'}
                      </button>
                    ))}
                    <button onClick={() => setIsCompact(c => !c)}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap shrink-0
                        ${isCompact ? 'bg-zinc-700 border-zinc-600 text-zinc-100' : 'bg-transparent border-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>
                      {isCompact ? '■ 컴팩트' : '☰ 컴팩트'}
                    </button>
                    <button
                      onClick={() => {
                        const sectorNames = [...new Set(displayed.map(s => getSector(s)))];
                        if (collapsedSectors.size < sectorNames.length) {
                          setCollapsedSectors(new Set(sectorNames));
                        } else {
                          setCollapsedSectors(new Set());
                        }
                      }}
                      className="text-xs px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap shrink-0 bg-transparent border-zinc-800 text-zinc-500 hover:text-zinc-300">
                      {collapsedSectors.size > 0 ? '▶ 전체 펼치기' : '▼ 전체 접기'}
                    </button>
                  </div>
                </div>

                {(() => {
                  const grouped = new Map<string, StockAnalysis[]>();
                  for (const s of displayed) {
                    const sec = getSector(s);
                    if (!grouped.has(sec)) grouped.set(sec, []);
                    grouped.get(sec)!.push(s);
                  }
                  const orderedSectors = [...grouped.keys()].sort((a, b) => {
                    const ai = SECTOR_ORDER.indexOf(a);
                    const bi = SECTOR_ORDER.indexOf(b);
                    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
                  });

                  if (orderedSectors.length === 0) {
                    return <p className="text-sm text-zinc-600 py-6 text-center">해당 조건의 종목이 없습니다.</p>;
                  }

                  return (
                    <div className="flex flex-col gap-6">
                      {orderedSectors.map(sector => {
                        const stocks = grouped.get(sector)!;
                        const collapsed = collapsedSectors.has(sector);
                        const breakoutCnt = stocks.filter(s => s.signal === 'BREAKOUT').length;
                        const setupCnt    = stocks.filter(s => s.signal === 'SETUP').length;
                        const watchCnt    = stocks.filter(s => s.signal === 'WATCH').length;
                        const avgScore    = Math.round(stocks.reduce((acc, s) => acc + Number(s.momentum_score), 0) / stocks.length);

                        return (
                          <div key={sector}>
                            <button onClick={() => toggleSector(sector)}
                              className="w-full flex items-center gap-2 mb-2 group text-left">
                              <span className="text-[11px] font-bold text-zinc-200 tracking-widest uppercase shrink-0">{sector}</span>
                              <span className="text-[10px] text-zinc-600 font-mono shrink-0">{stocks.length}종목</span>
                              {breakoutCnt > 0 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-700 text-emerald-400 font-mono shrink-0">
                                  즉시진입 {breakoutCnt}
                                </span>
                              )}
                              {setupCnt > 0 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-950 border border-blue-800 text-blue-400 font-mono shrink-0">
                                  진입대기 {setupCnt}
                                </span>
                              )}
                              {watchCnt > 0 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-950 border border-yellow-800 text-yellow-500 font-mono shrink-0">
                                  관심 {watchCnt}
                                </span>
                              )}
                              <span className="text-[10px] text-zinc-700 font-mono shrink-0">avg {avgScore}점</span>
                              <div className="flex-1 h-px bg-zinc-800 group-hover:bg-zinc-700 transition-colors" />
                              <span className="text-zinc-600 text-xs group-hover:text-zinc-400 transition-colors shrink-0">
                                {collapsed ? '▶' : '▼'}
                              </span>
                            </button>

                            {!collapsed && (
                              <div className={isCompact ? 'flex flex-col gap-1.5' : 'grid grid-cols-1 xl:grid-cols-2 gap-4'}>
                                {stocks.map((s, i) => (
                                  <StockCard
                                    key={s.ticker}
                                    stock={s}
                                    highlight={i === 0 && filter !== 'SELL' && filter !== 'STRONG_SELL'}
                                    onRemove={removeFromResults}
                                    earnings={earningsMap[s.ticker]}
                                    compact={isCompact}
                                    onOpenDrawer={setDrawerTicker}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

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

        <footer className="mt-8 pt-4 border-t border-border">
          <p className="text-[10px] text-zinc-700 leading-relaxed text-center" style={{ fontFamily: 'system-ui, sans-serif' }}>
            ⚠ Yahoo Finance 공개 데이터 기반 참고 정보이며, 금융 투자 권유가 아닙니다.
          </p>
        </footer>
      </div>

      {drawerStock && (
        <>
          <div className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm" onClick={() => setDrawerTicker(null)} />
          <div className="fixed top-0 right-0 h-full w-full sm:w-[520px] z-40 bg-zinc-950 border-l border-zinc-800 overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-zinc-950 border-b border-zinc-800 px-4 py-3 flex items-center justify-between z-10">
              <div className="flex items-center gap-3">
                <span className="text-base font-bold text-zinc-100">{drawerStock.ticker}</span>
                <span className="text-xs text-zinc-500">상세 분석</span>
              </div>
              <div className="flex items-center gap-2">
                <a href={`/stock/${drawerStock.ticker}`}
                  className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-400 hover:bg-zinc-800 transition-colors">전체 →</a>
                <button onClick={() => setDrawerTicker(null)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors text-sm">✕</button>
              </div>
            </div>
            <div className="p-4">
              <StockCard
                stock={drawerStock}
                highlight={false}
                onRemove={removeFromResults}
                earnings={earningsMap[drawerStock.ticker]}
                forceOpen={true}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
