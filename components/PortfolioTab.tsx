'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import EarningsBadge from '@/components/EarningsBadge';

interface Holding { ticker: string; avgPrice: number; shares: number; }
interface SellSignal { text: string; severity: 'high' | 'medium' | 'low'; }
interface DownsideRisk {
  toStopLoss: number; toMA20: number | null; toMA50: number | null; toMA120: number | null;
  worstCase: number; fromAvg: number; label: string; detail: string;
}
interface HoldingResult {
  ticker: string; avgPrice: number; shares: number;
  currentPrice: number; pnlPct: number; pnlAbs: number;
  action: string; sellUrgency: string;
  sellSignals: SellSignal[]; holdSignals: string[];
  holdRegret: string[];   // 지금 팔면 아쉬운 이유
  sellRegret: string[];   // 지금 안팔면 위험한 이유
  downsideRisk: DownsideRisk;
  upside: { score: number; label: string };
  indicators: { rsi: number; macd: number; adx: number; volRatio: number; aboveCount: number; bbPos: number; distFromHigh: number };
  stopLoss: { tight: number; standard: number; ma20: number|null; ma50: number|null; recommended: { price: number|null; label: string } };
  targets: { t1: number; t2: number; t3: number };
  trailing: {
    trail2xATR: number; trail3xATR: number;
    trailPct8: number; trailPct15: number;
    highWaterMark: number;
    recommended: { price: number; label: string; reasoning: string };
  };
  fibTargets: {
    fib618: number; fib100: number; fib162: number;
    pct10: number; pct20: number; pct30: number;
    nextTarget: number; nextTargetLabel: string; remainingUpside: number;
  };
  mas: { ma10: number; ma20: number; ma50: number; ma120: number };
  divergences: {
    rsi: { bearish: boolean; bullish: boolean; detail: string };
    volume: { bearish: boolean; detail: string };
    macd: { contracting: boolean; detail: string };
  };
  error?: string;
}

// ── Action 6단계 스타일 ──────────────────────────────────────────────────────
const ACTION_STYLE: Record<string, string> = {
  '즉시매도': 'bg-red-900 text-red-200 border-red-600',
  '매도':     'bg-red-950 text-red-400 border-red-800',
  '부분익절': 'bg-orange-950 text-orange-300 border-orange-800',
  '매도검토': 'bg-amber-950 text-amber-400 border-amber-800',
  '모니터링': 'bg-zinc-900 text-zinc-400 border-zinc-700',
  '홀딩':     'bg-emerald-950 text-emerald-400 border-emerald-800',
  '추세홀딩': 'bg-emerald-900 text-emerald-200 border-emerald-500', // 가장 강한 홀딩
};
const SEV_COLOR: Record<string, string> = {
  high: 'text-red-400', medium: 'text-amber-400', low: 'text-zinc-400',
};
const SEV_DOT: Record<string, string> = {
  high: 'bg-red-400', medium: 'bg-amber-400', low: 'bg-zinc-500',
};
const ACTION_ORDER: Record<string, number> = {
  '즉시매도': 0, '매도': 1, '부분익절': 2, '매도검토': 3, '모니터링': 4, '홀딩': 5, '추세홀딩': 6,
};

const PORTFOLIO_KEY   = 'mt_portfolio_v2';
const PORTFOLIO_CACHE = 'mt_portfolio_cache_v2';
const CACHE_TTL_MS    = 6 * 60 * 60 * 1000;

type SortType = 'action' | 'pnl' | 'upside' | 'ticker';
const SORT_OPTIONS: { key: SortType; label: string }[] = [
  { key: 'action',  label: '신호순' },
  { key: 'pnl',     label: '손익순' },
  { key: 'upside',  label: '여력순' },
  { key: 'ticker',  label: '티커순' },
];

// ── 실시간 가격 기반 action 재판단 (6단계) ──────────────────────────────────
function deriveRealtimeAction(r: HoldingResult, livePrice: number): string {
  if (!r.mas) return '모니터링';
  const { ma10, ma20, ma50, ma120 } = r.mas;
  const { rsi, macd } = r.indicators;
  const macdContracting = r.divergences.macd.contracting;
  const pnlPct = ((livePrice - r.avgPrice) / r.avgPrice) * 100;
  const liveAbove = [ma10, ma20, ma50, ma120].filter(m => m > 0 && livePrice > m).length;

  if (r.stopLoss.recommended.price && livePrice <= r.stopLoss.recommended.price) return '즉시매도';
  if (ma50 > 0 && livePrice < ma50 && macd < 0 && liveAbove <= 1) return '즉시매도';

  const highSigs     = r.sellSignals.filter(s => s.severity === 'high').length;
  const medSigs      = r.sellSignals.filter(s => s.severity === 'medium').length;
  const totalSigs    = r.sellSignals.length;
  const macdPositive = macd > 0 && !macdContracting;
  const allMAsAligned = ma10 > 0 && ma20 > 0 && ma50 > 0 && ma120 > 0
    ? livePrice > ma10 && livePrice > ma20 && livePrice > ma50 && livePrice > ma120
    : liveAbove === 4;
  const strongUptrend = macdPositive && allMAsAligned;

  if (highSigs >= 2 && totalSigs >= 3) return '매도';
  if (ma50 > 0 && livePrice < ma50) return '매도검토';
  if (pnlPct > 20 && rsi > 78 && !macdPositive) return '부분익절';

  // 추세홀딩: MACD 양수 + 정배열 + high 신호 없음
  if (strongUptrend && highSigs === 0 && medSigs === 0) return '추세홀딩';
  if (strongUptrend && highSigs === 0 && medSigs <= 1) return '홀딩';
  if (highSigs >= 1 || (medSigs >= 2 && !strongUptrend)) return '매도검토';
  if (r.holdSignals.length >= 2 && r.upside.score >= 50) return '홀딩';
  return '모니터링';
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function UpsideBar({ score, label }: { score: number; label: string }) {
  const color = score >= 70 ? '#10b981' : score >= 50 ? '#f59e0b' : score >= 30 ? '#f97316' : '#ef4444';
  return (
    <div className="mb-3 p-3 bg-zinc-900/50 rounded-lg">
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-[10px] text-zinc-600 uppercase tracking-widest">상승 여력 점수</span>
        <span className="text-sm font-semibold font-mono" style={{ color }}>{score}점 — {label}</span>
      </div>
      <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${score}%`, background: color }} />
      </div>
      <div className="flex justify-between text-[9px] text-zinc-700 mt-1">
        <span>소진</span><span>보통</span><span>충분</span>
      </div>
    </div>
  );
}

function DivergenceRow({ divs }: { divs: HoldingResult['divergences'] }) {
  const items = [
    { label: 'RSI 다이버전스',   active: divs.rsi.bearish,     detail: divs.rsi.detail,    bull: divs.rsi.bullish },
    { label: '거래량 다이버전스', active: divs.volume.bearish,  detail: divs.volume.detail, bull: false },
    { label: 'MACD 수축',        active: divs.macd.contracting, detail: divs.macd.detail,  bull: false },
  ];
  return (
    <div className="mb-3 p-3 bg-zinc-900/50 rounded-lg">
      <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2">다이버전스 감지</div>
      <div className="flex flex-col gap-1.5">
        {items.map(({ label, active, detail, bull }) => (
          <div key={label} className="flex items-start gap-2">
            <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${active ? 'bg-red-400' : bull ? 'bg-emerald-400' : 'bg-zinc-700'}`} />
            <div>
              <span className={`text-xs font-medium ${active ? 'text-red-400' : bull ? 'text-emerald-400' : 'text-zinc-600'}`}>{label}</span>
              {(active || bull) && <p className="text-[10px] text-zinc-500 mt-0.5" style={{ fontFamily: 'system-ui' }}>{detail}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 핵심 추가: RegretPanel ────────────────────────────────────────────────────
function RegretPanel({ r, action }: { r: HoldingResult; action: string }) {
  const isSellSide = ['즉시매도', '매도', '부분익절', '매도검토'].includes(action);
  const isHoldSide = ['추세홀딩', '홀딩', '모니터링'].includes(action);

  return (
    <div className="mb-3 space-y-2">
      {/* 지금 팔면 아쉬운 이유 — 홀딩 쪽일 때 강조, 매도 쪽에서도 보조 표시 */}
      {r.holdRegret && r.holdRegret.length > 0 && (
        <div className={`rounded-lg p-3 border ${isHoldSide
          ? 'bg-emerald-950/30 border-emerald-800/60'
          : 'bg-zinc-900/40 border-zinc-800/40'}`}>
          <div className="text-[10px] font-semibold mb-2 flex items-center gap-1.5">
            <span className={isHoldSide ? 'text-emerald-400' : 'text-zinc-500'}>
              {isHoldSide ? '✦ 지금 팔면 아쉬운 이유' : '▸ 홀딩 근거 (참고)'}
            </span>
          </div>
          <ul className="space-y-1.5">
            {r.holdRegret.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-xs" style={{ fontFamily: 'system-ui' }}>
                <span className={`mt-0.5 shrink-0 ${isHoldSide ? 'text-emerald-400' : 'text-zinc-600'}`}>✓</span>
                <span className={isHoldSide ? 'text-emerald-200' : 'text-zinc-500'}>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 지금 안팔면 위험한 이유 — 매도 쪽일 때 강조 */}
      {r.sellRegret && r.sellRegret.length > 0 && (
        <div className={`rounded-lg p-3 border ${isSellSide
          ? 'bg-red-950/30 border-red-800/60'
          : 'bg-zinc-900/40 border-zinc-800/40'}`}>
          <div className="text-[10px] font-semibold mb-2 flex items-center gap-1.5">
            <span className={isSellSide ? 'text-red-400' : 'text-zinc-500'}>
              {isSellSide ? '⚠ 지금 안팔면 위험한 이유' : '▸ 위험 요인 (참고)'}
            </span>
          </div>
          <ul className="space-y-1.5">
            {r.sellRegret.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-xs" style={{ fontFamily: 'system-ui' }}>
                <span className={`mt-0.5 shrink-0 ${isSellSide ? 'text-red-400' : 'text-zinc-600'}`}>!</span>
                <span className={isSellSide ? 'text-red-200' : 'text-zinc-500'}>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 하락 위험 계량 */}
      {r.downsideRisk && (
        <div className="rounded-lg p-3 border border-zinc-800/60 bg-zinc-900/40">
          <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2">예상 하락폭 (버티면 얼마나 잃을까)</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
            <RiskPill label="ATR 손절" val={`${r.downsideRisk.toStopLoss}%`}
              color={r.downsideRisk.toStopLoss < -10 ? 'text-red-400' : 'text-amber-400'} />
            {r.downsideRisk.toMA20 !== null && (
              <RiskPill label="MA20까지" val={`${r.downsideRisk.toMA20}%`} color="text-amber-400" />
            )}
            {r.downsideRisk.toMA50 !== null && (
              <RiskPill label="MA50까지" val={`${r.downsideRisk.toMA50}%`} color="text-orange-400" />
            )}
            <RiskPill label="52주 저점" val={`${r.downsideRisk.worstCase}%`} color="text-red-600" />
          </div>
          <p className="text-[10px] text-zinc-600">{r.downsideRisk.label}</p>
        </div>
      )}
    </div>
  );
}

function RiskPill({ label, val, color }: { label: string; val: string; color: string }) {
  return (
    <div className="text-center bg-zinc-900 border border-zinc-800 rounded-md px-2 py-1.5">
      <div className="text-[9px] text-zinc-600 mb-0.5">{label}</div>
      <div className={`text-xs font-semibold font-mono ${color}`}>{val}</div>
    </div>
  );
}

interface EarningsInfo { earningsDate: string|null; daysUntil: number|null; epsEstimate: number|null; revenueEstimate: string|null; lastEPS: number|null; }

// ── HoldingCard ───────────────────────────────────────────────────────────────
function HoldingCard({ result: r, onRemove, earnings }: {
  result: HoldingResult; onRemove?: () => void; earnings?: EarningsInfo;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [holdingTab, setHoldingTab] = useState<'signal' | 'strategy'>('signal');

  const [rtPrice, setRtPrice] = useState<{
    price: number; changePct: number; isRealtime?: boolean;
    marketSession?: 'REGULAR' | 'PRE' | 'AFTER' | 'CLOSED';
    extPrice?: number | null; extChangePct?: number | null;
  } | null>(null);

  useEffect(() => {
    const fetchPrice = () =>
      fetch(`/api/realtime?tickers=${r.ticker}`)
        .then(res => res.json())
        .then(d => {
          if (d.price && d.price > 0) setRtPrice({
            price: d.price, changePct: d.changePct ?? 0,
            isRealtime: d.isRealtime, marketSession: d.marketSession,
            extPrice: d.extPrice ?? null, extChangePct: d.extChangePct ?? null,
          });
        }).catch(() => {});
    fetchPrice();
    const iv = setInterval(fetchPrice, 30000);
    return () => clearInterval(iv);
  }, [r.ticker]);

  const displayPrice  = rtPrice ? rtPrice.price : r.currentPrice;
  const liveAction    = deriveRealtimeAction(r, displayPrice);
  const actionChanged = liveAction !== r.action;
  const rtPnlPct = rtPrice
    ? Math.round(((rtPrice.price - r.avgPrice) / r.avgPrice) * 10000) / 100
    : r.pnlPct;
  const rtPnlAbs = rtPrice && r.shares > 0
    ? Math.round((rtPrice.price - r.avgPrice) * r.shares * 100) / 100
    : r.pnlAbs;
  const pnlPos = rtPnlPct >= 0;

  const borderColor =
    liveAction === '즉시매도' ? 'border-l-red-400' :
    liveAction === '매도'     ? 'border-l-red-700' :
    liveAction === '부분익절' ? 'border-l-orange-500' :
    liveAction === '추세홀딩' ? 'border-l-emerald-400' :
    liveAction === '홀딩'     ? 'border-l-emerald-600' : 'border-l-zinc-600';

  const upsideColor = r.upside.score >= 70 ? 'text-emerald-400' : r.upside.score >= 50 ? 'text-amber-400' : r.upside.score >= 30 ? 'text-orange-400' : 'text-red-400';

  const ExtPriceBadge = () => {
    if (!rtPrice?.extPrice) return null;
    const isPre = rtPrice.marketSession === 'PRE', isAfter = rtPrice.marketSession === 'AFTER';
    if (!isPre && !isAfter) return null;
    return (
      <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded border ${isPre ? 'bg-sky-950 border-sky-800' : 'bg-violet-950 border-violet-800'}`}>
        <span className={`text-[9px] font-semibold ${isPre ? 'text-sky-400' : 'text-violet-400'}`}>{isPre ? '프리' : '애프터'}</span>
        <span className={`text-[9px] font-mono ${isPre ? 'text-sky-300' : 'text-violet-300'}`}>${rtPrice.extPrice.toLocaleString()}</span>
        {rtPrice.extChangePct != null && (
          <span className={`text-[9px] font-mono ${rtPrice.extChangePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {rtPrice.extChangePct >= 0 ? '+' : ''}{rtPrice.extChangePct.toFixed(2)}%
          </span>
        )}
      </span>
    );
  };

  // 액션 설명 한 줄
  const actionDesc: Record<string, string> = {
    '추세홀딩': '강한 추세 유지 중 — 매도 시 후회 가능성 높음',
    '홀딩':     '현 추세 유지 — 신호 변화 대기',
    '모니터링': '방향 불명확 — 관망',
    '매도검토': '위험 신호 감지 — 일부 익절 고려',
    '부분익절': '고수익 + 과열 — 30~50% 익절 권장',
    '매도':     '복수 고위험 신호 — 전량 매도 검토',
    '즉시매도': '추세 붕괴 — 즉시 손절',
  };

  return (
    <div className={`border border-zinc-800 border-l-4 ${borderColor} rounded-xl bg-bg-card`}>

      {/* ── 헤더 ── */}
      <div className="flex items-center justify-between px-4 py-3 cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}>
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <button onClick={e => { e.stopPropagation(); router.push(`/stock/${r.ticker}`); }}
            className="text-base font-bold text-zinc-100 hover:text-emerald-300 transition-colors shrink-0">
            {r.ticker} ↗
          </button>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-md border ${ACTION_STYLE[liveAction] ?? 'bg-zinc-900 text-zinc-400 border-zinc-700'}`}>
            {liveAction}
          </span>
          {actionChanged && <span className="text-[9px] text-zinc-600">(분석시: {r.action})</span>}
          {onRemove && (
            <button onClick={e => { e.stopPropagation(); onRemove(); }}
              className="w-5 h-5 flex items-center justify-center rounded-full bg-zinc-800 hover:bg-red-900 text-zinc-500 hover:text-red-400 transition-colors text-xs shrink-0">✕</button>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0 ml-2">
          <div className="text-right">
            <div className="flex items-center gap-1.5 justify-end flex-wrap">
              <span className="text-sm font-semibold text-zinc-100 font-mono">${displayPrice.toLocaleString()}</span>
              {rtPrice && (
                <>
                  <span className={`text-[10px] font-mono ${rtPrice.changePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {rtPrice.changePct >= 0 ? '+' : ''}{rtPrice.changePct.toFixed(2)}%
                  </span>
                  <span className={`text-[9px] px-1 py-0.5 rounded ${rtPrice.isRealtime !== false ? 'text-emerald-700 bg-emerald-950 border border-emerald-900 animate-pulse' : 'text-zinc-600 bg-zinc-900 border border-zinc-800'}`}>
                    {rtPrice.isRealtime !== false ? '실시간' : '15분'}
                  </span>
                  <ExtPriceBadge />
                </>
              )}
            </div>
            <div className={`text-xs font-semibold ${pnlPos ? 'text-emerald-400' : 'text-red-400'}`}>
              {pnlPos ? '+' : ''}{rtPnlPct}%
              {r.shares > 0 && <span className="text-[10px] ml-1">({pnlPos ? '+' : ''}${rtPnlAbs.toLocaleString()})</span>}
            </div>
          </div>
          <div className="text-center hidden sm:block">
            <div className="text-[9px] text-zinc-600 mb-0.5">여력</div>
            <div className={`text-xs font-semibold font-mono ${upsideColor}`}>{r.upside.score}점</div>
          </div>
          <span className="text-zinc-600 text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* ── 접힌 요약 — 액션 설명 한 줄 추가 ── */}
      {!open && (
        <div className="px-4 pb-3 border-t border-zinc-900 pt-2">
          {actionDesc[liveAction] && (
            <p className={`text-[10px] mb-1.5 ${
              liveAction === '추세홀딩' ? 'text-emerald-400' :
              liveAction === '홀딩' ? 'text-emerald-600' :
              ['즉시매도','매도'].includes(liveAction) ? 'text-red-400' :
              liveAction === '매도검토' ? 'text-amber-400' : 'text-zinc-500'
            }`}>{actionDesc[liveAction]}</p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-zinc-500">
            <span>평균매수 <span className="text-zinc-400 font-mono">${r.avgPrice}</span></span>
            {r.shares > 0 && <span>{r.shares}주</span>}
            <span>RSI <span className={r.indicators.rsi > 78 ? 'text-red-400' : r.indicators.rsi < 35 ? 'text-sky-400' : 'text-emerald-400'}>{r.indicators.rsi}</span></span>
            <span>MA위 <span className={r.indicators.aboveCount >= 3 ? 'text-emerald-400' : r.indicators.aboveCount <= 1 ? 'text-red-400' : 'text-amber-400'}>{r.indicators.aboveCount}/4</span></span>
            <span>거래량 <span className={r.indicators.volRatio > 1.3 ? 'text-emerald-400' : 'text-zinc-400'}>{r.indicators.volRatio}x</span></span>
            <span className={upsideColor}>{r.upside.label}</span>
            {r.sellSignals.length > 0 && <span className="text-red-400">매도신호 {r.sellSignals.length}개</span>}
            {r.downsideRisk && (
              <span className="text-amber-600">손절 {r.downsideRisk.toStopLoss}%</span>
            )}
          </div>
        </div>
      )}

      {/* ── 펼친 상세 ── */}
      {open && (
        <div className="border-t border-zinc-900">
          <div className="flex border-b border-zinc-800">
            {([['signal', '신호'], ['strategy', '매매전략']] as const).map(([key, label]) => (
              <button key={key}
                onClick={e => { e.stopPropagation(); setHoldingTab(key); }}
                className={`flex-1 py-2 text-xs font-semibold transition-colors
                  ${holdingTab === key
                    ? 'text-zinc-100 border-b-2 border-emerald-500 bg-zinc-900/40'
                    : 'text-zinc-500 hover:text-zinc-300'}`}>
                {label}
                {key === 'signal' && r.sellSignals.length > 0 &&
                  <span className="ml-1 text-[9px] text-red-400">({r.sellSignals.length})</span>}
              </button>
            ))}
          </div>

          <div className="px-4 pb-4 pt-3">

            {holdingTab === 'signal' && (
              <div>
                {earnings && <div className="mb-3"><EarningsBadge info={earnings} /></div>}
                <UpsideBar score={r.upside.score} label={r.upside.label} />

                {/* ── 핵심: 판단 도우미 패널 ── */}
                <RegretPanel r={r} action={liveAction} />

                <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 mb-3 p-3 bg-zinc-900/50 rounded-lg">
                  {[
                    { label: 'RSI',   val: r.indicators.rsi,   color: r.indicators.rsi > 78 ? 'text-red-400' : r.indicators.rsi < 35 ? 'text-sky-400' : 'text-emerald-400' },
                    { label: 'MACD',  val: r.indicators.macd,  color: r.indicators.macd > 0 ? 'text-emerald-400' : 'text-red-400' },
                    { label: 'ADX',   val: r.indicators.adx,   color: r.indicators.adx > 60 ? 'text-red-400' : r.indicators.adx >= 25 ? 'text-emerald-400' : 'text-amber-400' },
                    { label: '거래량', val: `${r.indicators.volRatio}x`, color: r.indicators.volRatio > 1.3 ? 'text-emerald-400' : r.indicators.volRatio < 0.7 ? 'text-red-400' : 'text-zinc-400' },
                    { label: 'MA위',  val: `${r.indicators.aboveCount}/4`, color: r.indicators.aboveCount >= 3 ? 'text-emerald-400' : r.indicators.aboveCount <= 1 ? 'text-red-400' : 'text-amber-400' },
                    { label: 'BB%',   val: `${r.indicators.bbPos}%`, color: r.indicators.bbPos > 85 ? 'text-amber-400' : r.indicators.bbPos < 20 ? 'text-sky-400' : 'text-zinc-400' },
                    { label: '고점%', val: `${r.indicators.distFromHigh}%`, color: r.indicators.distFromHigh > -5 ? 'text-emerald-400' : r.indicators.distFromHigh < -25 ? 'text-red-400' : 'text-zinc-400' },
                  ].map(({ label, val, color }) => (
                    <div key={label} className="text-center">
                      <div className="text-[9px] text-zinc-600 uppercase tracking-widest mb-0.5">{label}</div>
                      <div className={`text-xs font-semibold font-mono ${color}`}>{val}</div>
                    </div>
                  ))}
                </div>

                <DivergenceRow divs={r.divergences} />

                {r.sellSignals.length > 0 && (
                  <div className="mb-3 bg-red-950/20 border border-red-900/40 rounded-lg p-3">
                    <div className="text-[10px] text-red-500 uppercase tracking-widest mb-2">매도 신호 ({r.sellSignals.length}개)</div>
                    <ul className="space-y-1.5">
                      {r.sellSignals.map((s, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${SEV_DOT[s.severity]}`} />
                          <span className={`text-xs ${SEV_COLOR[s.severity]}`} style={{ fontFamily: 'system-ui' }}>{s.text}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {r.holdSignals.length > 0 && (
                  <div className="bg-emerald-950/20 border border-emerald-900/40 rounded-lg p-3">
                    <div className="text-[10px] text-emerald-600 uppercase tracking-widest mb-2">홀딩 근거 ({r.holdSignals.length}개)</div>
                    <ul className="space-y-1.5">
                      {r.holdSignals.map((s, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-emerald-300" style={{ fontFamily: 'system-ui' }}>
                          <span className="text-emerald-500 shrink-0 mt-0.5">✓</span>{s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {holdingTab === 'strategy' && (
              <div>
                <div className="mb-3 p-3 bg-zinc-900/50 rounded-lg">
                  <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2">손절 구간</div>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {r.stopLoss.ma20 && <StopPill label="MA20" val={`$${r.stopLoss.ma20}`} highlight={r.stopLoss.recommended.label.includes('MA20')} />}
                    {r.stopLoss.ma50 && <StopPill label="MA50" val={`$${r.stopLoss.ma50}`} highlight={r.stopLoss.recommended.label.includes('MA50')} />}
                    <StopPill label="ATR 2x" val={`$${r.stopLoss.standard}`} highlight={r.stopLoss.recommended.label.includes('ATR')} />
                  </div>
                  <p className="text-[10px] text-zinc-600">
                    ★ 추천: <span className="text-amber-400">${r.stopLoss.recommended.price} ({r.stopLoss.recommended.label})</span>
                  </p>
                </div>

                {r.trailing && (
                  <div className="mb-3 p-3 bg-zinc-900/50 rounded-lg border border-amber-900/40">
                    <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2">트레일링 스탑</div>
                    <div className="flex flex-wrap gap-2 mb-2">
                      <StopPill label="ATR 2x" val={`$${r.trailing.trail2xATR}`} highlight={false} />
                      <StopPill label="ATR 3x" val={`$${r.trailing.trail3xATR}`} highlight={false} />
                      <StopPill label="-8%"    val={`$${r.trailing.trailPct8}`}  highlight={false} />
                      <StopPill label="-15%"   val={`$${r.trailing.trailPct15}`} highlight={false} />
                    </div>
                    <div className="text-[10px] text-amber-400 font-semibold mb-0.5">
                      ★ 추천: ${r.trailing.recommended.price} ({r.trailing.recommended.label})
                    </div>
                    <p className="text-[10px] text-zinc-600" style={{ fontFamily: 'system-ui' }}>{r.trailing.recommended.reasoning}</p>
                  </div>
                )}

                {r.fibTargets && (
                  <div className="p-3 bg-zinc-900/50 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[10px] text-zinc-600 uppercase tracking-widest">목표가</div>
                      <span className="text-[10px] text-emerald-400">
                        다음: {r.fibTargets.nextTargetLabel} ${r.fibTargets.nextTarget}
                        <span className="text-zinc-600 ml-1">(+{r.fibTargets.remainingUpside}%)</span>
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2 mb-2">
                      <TargetPill label="+10%" val={`$${r.fibTargets.pct10}`} color={displayPrice >= r.fibTargets.pct10 ? 'text-zinc-600 border-zinc-800 line-through' : 'text-emerald-300 border-emerald-800'} />
                      <TargetPill label="+20%" val={`$${r.fibTargets.pct20}`} color={displayPrice >= r.fibTargets.pct20 ? 'text-zinc-600 border-zinc-800 line-through' : 'text-sky-300 border-sky-800'} />
                      <TargetPill label="+30%" val={`$${r.fibTargets.pct30}`} color={displayPrice >= r.fibTargets.pct30 ? 'text-zinc-600 border-zinc-800 line-through' : 'text-blue-300 border-blue-800'} />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <TargetPill label="Fib 61.8%"  val={`$${r.fibTargets.fib618}`} color="text-purple-300 border-purple-800" />
                      <TargetPill label="Fib 100%"   val={`$${r.fibTargets.fib100}`} color="text-purple-400 border-purple-700" />
                      <TargetPill label="Fib 161.8%" val={`$${r.fibTargets.fib162}`} color="text-purple-500 border-purple-600" />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StopPill({ label, val, highlight }: { label: string; val: string; highlight: boolean }) {
  return (
    <span className={`text-xs px-2.5 py-1 rounded-md border font-mono ${highlight ? 'bg-amber-950/60 text-amber-300 border-amber-700' : 'bg-zinc-900 text-zinc-400 border-zinc-700'}`}>
      {label}: {val}
    </span>
  );
}
function TargetPill({ label, val, color }: { label: string; val: string; color: string }) {
  return (
    <span className={`text-xs px-2.5 py-1 rounded-md border bg-zinc-900/60 font-mono ${color}`}>{label}: {val}</span>
  );
}

function usePortfolioRtPrices(results: HoldingResult[]) {
  const [rtMap, setRtMap] = useState<Record<string, number>>({});
  const tickerKey = results.map(r => r.ticker).join(',');
  useEffect(() => {
    if (results.length === 0) return;
    const fetchAll = () =>
      fetch(`/api/realtime?tickers=${tickerKey}`)
        .then(res => res.json())
        .then(d => {
          const map: Record<string, number> = {};
          const quotes = d.quotes ?? (d.price ? [{ ticker: results[0].ticker, price: d.price }] : []);
          for (const q of quotes) if (q?.price > 0) map[q.ticker] = q.price;
          setRtMap(map);
        }).catch(() => {});
    fetchAll();
    const iv = setInterval(fetchAll, 30000);
    return () => clearInterval(iv);
  }, [tickerKey]);
  return rtMap;
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function PortfolioTab() {
  const [holdings,    setHoldings]    = useState<Holding[]>([]);
  const [results,     setResults]     = useState<HoldingResult[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [status,      setStatus]      = useState('');
  const [error,       setError]       = useState('');
  const [analyzedAt,  setAnalyzedAt]  = useState('');
  const [earningsMap, setEarningsMap] = useState<Record<string, EarningsInfo>>({});
  const [form,        setForm]        = useState({ ticker: '', avgPrice: '', shares: '' });
  const [editIdx,     setEditIdx]     = useState<number | null>(null);
  const [sort,        setSort]        = useState<SortType>('action');
  const [showHoldings, setShowHoldings] = useState(false);
  const [showForm,     setShowForm]     = useState(false);

  const rtMap      = usePortfolioRtPrices(results);
  const analyzeRef = useRef<(() => Promise<void>) | undefined>(undefined);

  async function analyze() {
    if (holdings.length === 0 || loading) return;
    setLoading(true); setError(''); setResults([]);
    setStatus('> 지표 계산 중...');
    try { localStorage.removeItem(PORTFOLIO_CACHE); } catch {}
    try {
      const res = await fetch('/api/portfolio', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ holdings }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResults(data.holdings);
      setAnalyzedAt(data.analyzed_at);
      setStatus(`> 분석 완료 — ${data.holdings.length}개 종목 | ${new Date().toLocaleTimeString('ko-KR')}`);
      try { localStorage.setItem(PORTFOLIO_CACHE, JSON.stringify({ results: data.holdings, analyzed_at: data.analyzed_at })); } catch {}
      try {
        await fetch('/api/db', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'portfolio', holdings, results: data.holdings, analyzed_at: data.analyzed_at }),
        });
      } catch {}
      try {
        const er = await fetch('/api/earnings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tickers: holdings.map(h => h.ticker) }) });
        if (er.ok) {
          const ed = await er.json();
          const eMap: Record<string, EarningsInfo> = {};
          (ed.earnings ?? []).forEach((e: EarningsInfo & { ticker: string }) => { eMap[e.ticker] = e; });
          setEarningsMap(eMap);
        }
      } catch {}
    } catch (e) { setError(String(e)); setStatus(''); }
    setLoading(false);
  }

  analyzeRef.current = analyze;

  useEffect(() => {
    let loadedHoldings: Holding[] = [];
    try {
      const s = localStorage.getItem(PORTFOLIO_KEY);
      if (s) loadedHoldings = JSON.parse(s);
      setHoldings(loadedHoldings);
    } catch {}
    try {
      const cached = localStorage.getItem(PORTFOLIO_CACHE);
      if (cached) {
        const p = JSON.parse(cached);
        const age = Date.now() - new Date(p.analyzed_at ?? 0).getTime();
        if (age < CACHE_TTL_MS) {
          setResults(p.results ?? []);
          setAnalyzedAt(p.analyzed_at ?? '');
          setStatus(`> 캐시 결과 | ${new Date(p.analyzed_at).toLocaleString('ko-KR')}`);
          return;
        }
      }
    } catch {}
    if (loadedHoldings.length > 0) setTimeout(() => analyzeRef.current?.(), 300);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (holdings.length === 0) return;
    const iv = setInterval(() => { analyzeRef.current?.(); }, CACHE_TTL_MS);
    return () => clearInterval(iv);
  }, [holdings.length]);

  function saveHoldings(h: Holding[]) {
    setHoldings(h);
    try { localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(h)); } catch {}
  }

  function addHolding() {
    const t = form.ticker.trim().toUpperCase();
    const p = parseFloat(form.avgPrice);
    const s = parseFloat(form.shares) || 0;
    if (!t || isNaN(p) || p <= 0) return;
    if (editIdx !== null) {
      const updated = [...holdings]; updated[editIdx] = { ticker: t, avgPrice: p, shares: s };
      saveHoldings(updated); setEditIdx(null);
    } else {
      saveHoldings([...holdings, { ticker: t, avgPrice: p, shares: s }]);
    }
    setForm({ ticker: '', avgPrice: '', shares: '' });
  }

  function removeHolding(i: number) {
    const removed = holdings[i].ticker;
    const newHoldings = holdings.filter((_, idx) => idx !== i);
    saveHoldings(newHoldings);
    const newResults = results.filter(x => x.ticker !== removed);
    setResults(newResults);
    try { localStorage.setItem(PORTFOLIO_CACHE, JSON.stringify({ results: newResults, analyzed_at: analyzedAt })); } catch {}
  }

  function startEdit(i: number) {
    setEditIdx(i);
    setForm({ ticker: holdings[i].ticker, avgPrice: String(holdings[i].avgPrice), shares: String(holdings[i].shares) });
    setShowForm(true);
  }

  const totalCost    = results.reduce((a, r) => a + (r.avgPrice * (r.shares ?? 0)), 0);
  const totalCurrent = results.reduce((a, r) => a + ((rtMap[r.ticker] ?? r.currentPrice) * (r.shares ?? 0)), 0);
  const totalPnl     = totalCurrent - totalCost;
  const totalPnlPct  = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  const sortedResults = [...results].sort((a, b) => {
    if (sort === 'action') {
      const aLive = deriveRealtimeAction(a, rtMap[a.ticker] ?? a.currentPrice);
      const bLive = deriveRealtimeAction(b, rtMap[b.ticker] ?? b.currentPrice);
      return (ACTION_ORDER[aLive] ?? 9) - (ACTION_ORDER[bLive] ?? 9);
    }
    if (sort === 'pnl')    return (b.pnlPct ?? 0) - (a.pnlPct ?? 0);
    if (sort === 'upside') return (b.upside?.score ?? 0) - (a.upside?.score ?? 0);
    if (sort === 'ticker') return a.ticker.localeCompare(b.ticker);
    return 0;
  });

  return (
    <div>
      {/* 종목 추가/수정 폼 */}
      <div className="mb-3 border border-zinc-800 rounded-xl bg-zinc-900/40 overflow-hidden">
        <button
          onClick={() => { setShowForm(o => !o); if (editIdx !== null) { setEditIdx(null); setForm({ ticker: '', avgPrice: '', shares: '' }); } }}
          className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-zinc-800/40 transition-colors">
          <span className="text-[10px] text-zinc-500 uppercase tracking-widest">
            {editIdx !== null ? '종목 수정' : '+ 종목 추가'}
          </span>
          <span className="text-zinc-600 text-xs">{showForm ? '▲' : '▼'}</span>
        </button>
        {(showForm || editIdx !== null) && (
          <div className="px-3 pb-3 border-t border-zinc-800/60 pt-3">
            <div className="flex gap-2 mb-2">
              <input value={form.ticker}
                onChange={e => setForm(f => ({ ...f, ticker: e.target.value.toUpperCase() }))}
                placeholder="티커" maxLength={8}
                className="bg-zinc-900 border border-zinc-700 text-zinc-100 text-xs px-2.5 py-2 rounded-lg w-20 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 font-mono" />
              <input value={form.avgPrice}
                onChange={e => setForm(f => ({ ...f, avgPrice: e.target.value }))}
                placeholder="매수가 ($)" type="number" min="0" step="0.01"
                className="bg-zinc-900 border border-zinc-700 text-zinc-100 text-xs px-2.5 py-2 rounded-lg flex-1 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 font-mono" />
              <input value={form.shares}
                onChange={e => setForm(f => ({ ...f, shares: e.target.value }))}
                placeholder="수량" type="number" min="0"
                className="bg-zinc-900 border border-zinc-700 text-zinc-100 text-xs px-2.5 py-2 rounded-lg w-20 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 font-mono" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => { addHolding(); setShowForm(false); }}
                className="flex-1 py-2 bg-emerald-700 border border-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-600 transition-colors">
                {editIdx !== null ? '수정 완료' : '+ 추가'}
              </button>
              {editIdx !== null && (
                <button onClick={() => { setEditIdx(null); setForm({ ticker: '', avgPrice: '', shares: '' }); setShowForm(false); }}
                  className="px-4 py-2 border border-zinc-700 text-zinc-400 text-xs rounded-lg hover:text-zinc-200">취소</button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 보유 종목 칩 */}
      {holdings.length > 0 && (
        <div className="mb-4">
          <button
            onClick={() => setShowHoldings(o => !o)}
            className="w-full flex items-center justify-between px-3 py-2 mb-2 rounded-lg border border-zinc-800 bg-zinc-900/40 hover:bg-zinc-800/40 transition-colors">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] text-zinc-500 uppercase tracking-widest shrink-0">보유 종목</span>
              <span className="text-[10px] font-semibold text-zinc-300 shrink-0">{holdings.length}개</span>
              {!showHoldings && (
                <span className="text-[10px] text-zinc-600 font-mono truncate">
                  {holdings.map(h => h.ticker).join(' · ')}
                </span>
              )}
            </div>
            <span className="text-zinc-600 text-xs shrink-0">{showHoldings ? '▲ 접기' : '▼ 펼치기'}</span>
          </button>
          {showHoldings && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {holdings.map((h, i) => (
                <div key={i} className="flex items-center gap-1.5 px-2 py-1 bg-zinc-900 border border-zinc-800 rounded-md">
                  <span className="text-xs font-semibold text-zinc-100 font-mono">{h.ticker}</span>
                  <span className="text-[10px] text-zinc-600 font-mono">${h.avgPrice}</span>
                  {h.shares > 0 && <span className="text-[10px] text-zinc-700">{h.shares}주</span>}
                  <button onClick={() => startEdit(i)} className="text-zinc-700 hover:text-zinc-400 text-[10px] leading-none">✎</button>
                  <button onClick={() => removeHolding(i)} className="text-zinc-700 hover:text-red-400 text-[10px] leading-none">✕</button>
                </div>
              ))}
            </div>
          )}
          <button onClick={analyze} disabled={loading}
            className={`w-full py-2.5 text-sm font-semibold rounded-lg border transition-all
              ${loading
                ? 'bg-zinc-900 border-zinc-700 text-zinc-500 cursor-not-allowed'
                : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700'}`}>
            {loading ? '분석 중...' : '↺ 재분석'}
          </button>
        </div>
      )}

      {status && <div className={`text-xs mb-4 font-mono ${loading ? 'text-sky-500' : 'text-zinc-600'}`}>{status}</div>}
      {error  && <div className="mb-4 p-4 bg-red-950 border border-red-800 rounded-xl text-sm text-red-300">오류: {error}</div>}

      {/* 총 손익 */}
      {results.length > 0 && totalCost > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-center">
            <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">총 투자금</div>
            <div className="text-lg font-semibold text-zinc-200 font-mono">${Math.round(totalCost).toLocaleString()}</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-center">
            <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">평가액 <span className="text-emerald-700 text-[9px]">실시간</span></div>
            <div className="text-lg font-semibold text-zinc-200 font-mono">${Math.round(totalCurrent).toLocaleString()}</div>
          </div>
          <div className={`bg-zinc-900 border rounded-xl p-4 text-center ${totalPnl >= 0 ? 'border-emerald-900' : 'border-red-900'}`}>
            <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">총 손익 <span className="text-emerald-700 text-[9px]">실시간</span></div>
            <div className={`text-lg font-semibold font-mono ${totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {totalPnl >= 0 ? '+' : ''}${Math.round(totalPnl).toLocaleString()}
            </div>
            <div className={`text-xs ${totalPnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {totalPnlPct >= 0 ? '+' : ''}{totalPnlPct.toFixed(2)}%
            </div>
          </div>
        </div>
      )}

      {/* 정렬 + action 카운트 */}
      {results.length > 0 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-[10px] text-zinc-600 uppercase tracking-widest shrink-0">정렬</span>
          <div className="flex gap-1">
            {SORT_OPTIONS.map(o => (
              <button key={o.key} onClick={() => setSort(o.key)}
                className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors
                  ${sort === o.key ? 'bg-zinc-700 border-zinc-600 text-zinc-100' : 'bg-transparent border-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>
                {o.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5 ml-1 flex-wrap">
            {['즉시매도', '매도', '부분익절', '매도검토', '홀딩', '추세홀딩', '모니터링'].map(a => {
              const cnt = results.filter(r => deriveRealtimeAction(r, rtMap[r.ticker] ?? r.currentPrice) === a).length;
              if (cnt === 0) return null;
              return (
                <span key={a} className={`text-[9px] px-1.5 py-0.5 rounded border ${ACTION_STYLE[a]}`}>
                  {a} {cnt}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* 카드 그리드 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {sortedResults.map((r, i) => r.error ? (
          <div key={r.ticker} className="p-4 border border-zinc-800 rounded-xl bg-zinc-900/40 flex items-center justify-between">
            <div>
              <span className="text-zinc-300 font-semibold">{r.ticker}</span>
              <span className="text-zinc-600 text-xs ml-2">{r.error}</span>
            </div>
            <button onClick={() => removeHolding(i)} className="text-zinc-600 hover:text-red-400 text-xs">✕ 삭제</button>
          </div>
        ) : (
          <HoldingCard key={r.ticker} result={r}
            onRemove={() => removeHolding(holdings.findIndex(h => h.ticker === r.ticker))}
            earnings={earningsMap[r.ticker]} />
        ))}
      </div>

      {results.length > 0 && analyzedAt && (
        <div className="text-[10px] text-zinc-700 text-center mt-6">
          지표 분석: {new Date(analyzedAt).toLocaleString('ko-KR')} · action은 실시간 가격 기준
        </div>
      )}
    </div>
  );
}
