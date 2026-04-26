'use client';
import { useState, useEffect } from 'react';

interface Holding { ticker: string; avgPrice: number; shares: number; }
interface SellSignal { text: string; severity: 'high' | 'medium' | 'low'; }
interface HoldingResult {
  ticker: string; avgPrice: number; shares: number;
  currentPrice: number; pnlPct: number; pnlAbs: number;
  action: string; sellUrgency: string;
  sellSignals: SellSignal[]; holdSignals: string[];
  upside: { score: number; label: string };
  indicators: { rsi: number; macd: number; adx: number; volRatio: number; aboveCount: number; bbPos: number; distFromHigh: number };
  stopLoss: { tight: number; standard: number; ma20: number|null; ma50: number|null; recommended: { price: number|null; label: string } };
  targets: { t1: number; t2: number; t3: number };
  mas: { ma10: number; ma20: number; ma50: number; ma120: number };
  divergences: {
    rsi: { bearish: boolean; bullish: boolean; detail: string };
    volume: { bearish: boolean; detail: string };
    macd: { contracting: boolean; detail: string };
  };
  error?: string;
}

const ACTION_STYLE: Record<string, string> = {
  '즉시매도': 'bg-red-900 text-red-200 border-red-600',
  '매도':     'bg-red-950 text-red-400 border-red-800',
  '부분익절': 'bg-orange-950 text-orange-300 border-orange-800',
  '매도검토': 'bg-amber-950 text-amber-400 border-amber-800',
  '모니터링': 'bg-zinc-900 text-zinc-400 border-zinc-700',
  '홀딩':     'bg-emerald-950 text-emerald-400 border-emerald-800',
};
const SEV_COLOR: Record<string, string> = {
  high: 'text-red-400', medium: 'text-amber-400', low: 'text-zinc-400',
};
const SEV_DOT: Record<string, string> = {
  high: 'bg-red-400', medium: 'bg-amber-400', low: 'bg-zinc-500',
};
const PORTFOLIO_KEY = 'mt_portfolio_v2';

function UpsideBar({ score, label }: { score: number; label: string }) {
  const color = score >= 70 ? '#10b981' : score >= 50 ? '#f59e0b' : score >= 30 ? '#f97316' : '#ef4444';
  return (
    <div className="mb-4 p-3 bg-zinc-900/50 rounded-lg">
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
    { label: 'RSI 다이버전스', active: divs.rsi.bearish, detail: divs.rsi.detail, bull: divs.rsi.bullish },
    { label: '거래량 다이버전스', active: divs.volume.bearish, detail: divs.volume.detail, bull: false },
    { label: 'MACD 수축', active: divs.macd.contracting, detail: divs.macd.detail, bull: false },
  ];
  return (
    <div className="mb-4 p-3 bg-zinc-900/50 rounded-lg">
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

function HoldingCard({ result: r, onRemove }: { result: HoldingResult; onRemove?: () => void }) {
  const pnlPos = r.pnlPct >= 0;
  const borderColor = r.action === '즉시매도' ? 'border-l-red-400' :
    r.action === '매도' ? 'border-l-red-700' :
    r.action === '부분익절' ? 'border-l-orange-500' :
    r.action === '홀딩' ? 'border-l-emerald-600' : 'border-l-zinc-600';

  return (
    <div className={`border border-zinc-800 border-l-4 ${borderColor} rounded-xl p-5 bg-bg-card`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <span className="text-xl font-semibold text-zinc-100">{r.ticker}</span>
            <span className={`text-xs font-semibold px-3 py-1 rounded-md border ${ACTION_STYLE[r.action] ?? 'bg-zinc-900 text-zinc-400 border-zinc-700'}`}>{r.action}</span>
            {onRemove && (
              <button onClick={onRemove}
                className="w-5 h-5 flex items-center justify-center rounded-full bg-zinc-800 hover:bg-red-900 text-zinc-500 hover:text-red-400 transition-colors text-xs">✕</button>
            )}
          </div>
          <div className="text-xs text-zinc-600">평균매수 ${r.avgPrice} {r.shares > 0 && `· ${r.shares}주`}</div>
        </div>
        <div className="text-right">
          <div className="text-xl font-semibold text-zinc-100 font-mono">${r.currentPrice}</div>
          <div className={`text-sm font-semibold ${pnlPos ? 'text-emerald-400' : 'text-red-400'}`}>
            {pnlPos ? '+' : ''}{r.pnlPct}%
            {r.shares > 0 && <span className="text-xs ml-1">({pnlPos ? '+' : ''}${r.pnlAbs.toLocaleString()})</span>}
          </div>
        </div>
      </div>

      {/* Upside potential bar */}
      <UpsideBar score={r.upside.score} label={r.upside.label} />

      {/* 7 Indicators grid */}
      <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 mb-4 p-3 bg-zinc-900/50 rounded-lg">
        {[
          { label: 'RSI', val: r.indicators.rsi, color: r.indicators.rsi > 78 ? 'text-red-400' : r.indicators.rsi < 35 ? 'text-sky-400' : 'text-emerald-400' },
          { label: 'MACD', val: r.indicators.macd, color: r.indicators.macd > 0 ? 'text-emerald-400' : 'text-red-400' },
          { label: 'ADX', val: r.indicators.adx, color: r.indicators.adx > 50 ? 'text-red-400' : r.indicators.adx >= 25 ? 'text-emerald-400' : 'text-amber-400' },
          { label: '거래량', val: `${r.indicators.volRatio}x`, color: r.indicators.volRatio > 1.3 ? 'text-emerald-400' : r.indicators.volRatio < 0.7 ? 'text-red-400' : 'text-zinc-400' },
          { label: 'MA위', val: `${r.indicators.aboveCount}/4`, color: r.indicators.aboveCount >= 3 ? 'text-emerald-400' : r.indicators.aboveCount <= 1 ? 'text-red-400' : 'text-amber-400' },
          { label: 'BB%', val: `${r.indicators.bbPos}%`, color: r.indicators.bbPos > 85 ? 'text-amber-400' : r.indicators.bbPos < 20 ? 'text-sky-400' : 'text-zinc-400' },
          { label: '고점%', val: `${r.indicators.distFromHigh}%`, color: r.indicators.distFromHigh > -5 ? 'text-emerald-400' : r.indicators.distFromHigh < -25 ? 'text-red-400' : 'text-zinc-400' },
        ].map(({ label, val, color }) => (
          <div key={label} className="text-center">
            <div className="text-[9px] text-zinc-600 uppercase tracking-widest mb-0.5">{label}</div>
            <div className={`text-xs font-semibold font-mono ${color}`}>{val}</div>
          </div>
        ))}
      </div>

      {/* Divergence detection */}
      <DivergenceRow divs={r.divergences} />

      {/* Sell signals */}
      {r.sellSignals.length > 0 && (
        <div className="mb-4 bg-red-950/20 border border-red-900/40 rounded-lg p-3">
          <div className="text-[10px] text-red-500 uppercase tracking-widest mb-2">
            매도 신호 ({r.sellSignals.length}개)
          </div>
          <ul className="space-y-2">
            {r.sellSignals.map((s, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${SEV_DOT[s.severity]}`} />
                <span className={`text-xs ${SEV_COLOR[s.severity]}`} style={{ fontFamily: 'system-ui' }}>{s.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Hold signals */}
      {r.holdSignals.length > 0 && (
        <div className="mb-4 bg-emerald-950/20 border border-emerald-900/40 rounded-lg p-3">
          <div className="text-[10px] text-emerald-600 uppercase tracking-widest mb-2">
            홀딩 근거 ({r.holdSignals.length}개)
          </div>
          <ul className="space-y-1.5">
            {r.holdSignals.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-emerald-300" style={{ fontFamily: 'system-ui' }}>
                <span className="text-emerald-500 shrink-0 mt-0.5">✓</span>{s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Stop loss */}
      <div className="mb-4 p-3 bg-zinc-900/50 rounded-lg">
        <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2">손절 구간</div>
        <div className="flex flex-wrap gap-2">
          {r.stopLoss.ma20 && <StopPill label="MA20" val={`$${r.stopLoss.ma20}`} highlight={r.stopLoss.recommended.label.includes('MA20')} />}
          {r.stopLoss.ma50 && <StopPill label="MA50" val={`$${r.stopLoss.ma50}`} highlight={r.stopLoss.recommended.label.includes('MA50')} />}
          <StopPill label="ATR 2x" val={`$${r.stopLoss.standard}`} highlight={r.stopLoss.recommended.label.includes('ATR')} />
        </div>
        <p className="text-[10px] text-zinc-600 mt-2">
          ★ 추천: <span className="text-amber-400">${r.stopLoss.recommended.price} ({r.stopLoss.recommended.label})</span>
        </p>
      </div>

      {/* Targets */}
      <div className="p-3 bg-zinc-900/50 rounded-lg">
        <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2">매도 목표가 (단계적 익절)</div>
        <div className="flex flex-wrap gap-2">
          <TargetPill label="+10% 1차" val={`$${r.targets.t1}`} color="text-emerald-300 border-emerald-800" />
          <TargetPill label="+20% 2차" val={`$${r.targets.t2}`} color="text-sky-300 border-sky-800" />
          <TargetPill label="최대 목표" val={`$${r.targets.t3}`} color="text-purple-300 border-purple-800" />
        </div>
      </div>
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

export default function PortfolioTab() {
  const [holdings,  setHoldings]  = useState<Holding[]>([]);
  const [results,   setResults]   = useState<HoldingResult[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [status,    setStatus]    = useState('');
  const [error,     setError]     = useState('');
  const [analyzedAt,setAnalyzedAt]= useState('');
  const [form,      setForm]      = useState({ ticker: '', avgPrice: '', shares: '' });
  const [editIdx,   setEditIdx]   = useState<number | null>(null);

  useEffect(() => {
    try { const s = localStorage.getItem(PORTFOLIO_KEY); if (s) setHoldings(JSON.parse(s)); } catch {}
  }, []);

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
    } else { saveHoldings([...holdings, { ticker: t, avgPrice: p, shares: s }]); }
    setForm({ ticker: '', avgPrice: '', shares: '' });
  }

  function removeHolding(i: number) {
    saveHoldings(holdings.filter((_, idx) => idx !== i));
    setResults(r => r.filter(x => x.ticker !== holdings[i].ticker));
  }

  function startEdit(i: number) {
    setEditIdx(i);
    setForm({ ticker: holdings[i].ticker, avgPrice: String(holdings[i].avgPrice), shares: String(holdings[i].shares) });
  }

  async function analyze() {
    if (holdings.length === 0 || loading) return;
    setLoading(true); setError(''); setResults([]);
    setStatus('> 7가지 매도 지표 계산 중...');
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
    } catch (e) { setError(String(e)); setStatus(''); }
    setLoading(false);
  }

  const totalCost    = results.reduce((a, r) => a + ((r.avgPrice ?? 0) * (r.shares ?? 0)), 0);
  const totalCurrent = results.reduce((a, r) => a + ((r.currentPrice ?? 0) * (r.shares ?? 0)), 0);
  const totalPnl     = totalCurrent - totalCost;
  const totalPnlPct  = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  return (
    <div>
      {/* Add/Edit form */}
      <div className="mb-6 p-4 border border-zinc-800 rounded-xl bg-zinc-900/40">
        <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-3">
          {editIdx !== null ? '종목 수정' : '보유 종목 추가'}
        </div>
        <div className="flex flex-wrap gap-2 mb-2">
          <input value={form.ticker} onChange={e => setForm(f => ({ ...f, ticker: e.target.value.toUpperCase() }))}
            placeholder="티커 (예: NVDA)" maxLength={8}
            className="bg-zinc-900 border border-zinc-700 text-zinc-100 text-sm px-3 py-2 rounded-lg w-28 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 font-mono" />
          <input value={form.avgPrice} onChange={e => setForm(f => ({ ...f, avgPrice: e.target.value }))}
            placeholder="평균 매수가 ($)" type="number" min="0" step="0.01"
            className="bg-zinc-900 border border-zinc-700 text-zinc-100 text-sm px-3 py-2 rounded-lg w-40 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 font-mono" />
          <input value={form.shares} onChange={e => setForm(f => ({ ...f, shares: e.target.value }))}
            placeholder="보유 수량 (주)" type="number" min="0"
            className="bg-zinc-900 border border-zinc-700 text-zinc-100 text-sm px-3 py-2 rounded-lg w-36 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 font-mono" />
          <button onClick={addHolding}
            className="px-4 py-2 bg-emerald-700 border border-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-600 transition-colors">
            {editIdx !== null ? '수정 완료' : '+ 추가'}
          </button>
          {editIdx !== null && (
            <button onClick={() => { setEditIdx(null); setForm({ ticker:'', avgPrice:'', shares:'' }); }}
              className="px-4 py-2 border border-zinc-700 text-zinc-400 text-sm rounded-lg hover:text-zinc-200">취소</button>
          )}
        </div>
      </div>

      {/* Holdings chips */}
      {holdings.length > 0 && (
        <div className="mb-6">
          <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-3">보유 종목 ({holdings.length}개)</div>
          <div className="flex flex-wrap gap-2 mb-4">
            {holdings.map((h, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-sm">
                <span className="font-semibold text-zinc-100">{h.ticker}</span>
                <span className="text-zinc-500 text-xs">${h.avgPrice}</span>
                {h.shares > 0 && <span className="text-zinc-600 text-xs">{h.shares}주</span>}
                <button onClick={() => startEdit(i)} className="text-zinc-600 hover:text-zinc-300 text-xs">✎</button>
                <button onClick={() => removeHolding(i)} className="text-zinc-600 hover:text-red-400 text-xs">✕</button>
              </div>
            ))}
          </div>
          <button onClick={analyze} disabled={loading}
            className={`w-full py-3 text-sm font-semibold rounded-lg border transition-all
              ${loading ? 'bg-zinc-900 border-zinc-700 text-zinc-500 cursor-not-allowed'
                        : 'bg-emerald-500 border-emerald-400 text-black hover:bg-emerald-400'}`}>
            {loading ? '분석 중...' : '포트폴리오 분석 실행 →'}
          </button>
        </div>
      )}

      {status && <div className={`text-xs mb-4 font-mono ${loading ? 'text-sky-500' : 'text-zinc-500'}`}>{status}</div>}
      {error  && <div className="mb-4 p-4 bg-red-950 border border-red-800 rounded-xl text-sm text-red-300">오류: {error}</div>}

      {/* Summary */}
      {results.length > 0 && totalCost > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-center">
            <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">총 투자금</div>
            <div className="text-lg font-semibold text-zinc-200 font-mono">${Math.round(totalCost).toLocaleString()}</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-center">
            <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">평가액</div>
            <div className="text-lg font-semibold text-zinc-200 font-mono">${Math.round(totalCurrent).toLocaleString()}</div>
          </div>
          <div className={`bg-zinc-900 border rounded-xl p-4 text-center ${totalPnl >= 0 ? 'border-emerald-900' : 'border-red-900'}`}>
            <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">총 손익</div>
            <div className={`text-lg font-semibold font-mono ${totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {totalPnl >= 0 ? '+' : ''}${Math.round(totalPnl).toLocaleString()}
            </div>
            <div className={`text-xs ${totalPnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {totalPnlPct >= 0 ? '+' : ''}{totalPnlPct.toFixed(2)}%
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {results.map((r, i) => r.error ? (
          <div key={r.ticker} className="p-4 border border-zinc-800 rounded-xl bg-zinc-900/40 flex items-center justify-between">
            <div><span className="text-zinc-300 font-semibold">{r.ticker}</span><span className="text-zinc-600 text-xs ml-2">{r.error}</span></div>
            <button onClick={() => removeHolding(i)} className="text-zinc-600 hover:text-red-400 text-xs">✕ 삭제</button>
          </div>
        ) : (
          <HoldingCard key={r.ticker} result={r}
            onRemove={() => removeHolding(holdings.findIndex(h => h.ticker === r.ticker))} />
        ))}
      </div>

      {results.length > 0 && analyzedAt && (
        <div className="text-[10px] text-zinc-700 text-center mt-6">
          마지막 분석: {new Date(analyzedAt).toLocaleString('ko-KR')}
        </div>
      )}
    </div>
  );
}
