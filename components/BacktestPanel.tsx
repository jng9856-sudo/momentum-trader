'use client';
import { useState } from 'react';

interface BacktestSignal {
  date: string; price: number; signalType: string; vcpScore: number;
  ret5d: number | null; ret10d: number | null; ret20d: number | null; ret60d: number | null;
  isWin5d: boolean | null; isWin20d: boolean | null;
}
interface BacktestStats {
  totalSignals: number; winRate5d: number; winRate20d: number;
  avgRet5d: number; avgRet20d: number; maxWin: number; maxLoss: number; profitFactor: number;
}
interface BacktestResult {
  ticker: string; signals: BacktestSignal[]; stats: BacktestStats | null; months: number;
}

export default function BacktestPanel() {
  const [ticker,  setTicker]  = useState('');
  const [months,  setMonths]  = useState(6);
  const [result,  setResult]  = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  async function run() {
    const t = ticker.trim().toUpperCase();
    if (!t || loading) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: t, months }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
      setResult(await res.json());
    } catch (e) { setError(String(e)); }
    setLoading(false);
  }

  return (
    <div>
      {/* Input */}
      <div className="mb-6 p-4 border border-zinc-800 rounded-xl bg-zinc-900/40">
        <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-3">백테스트 설정</div>
        <div className="flex flex-wrap gap-2 items-center">
          <input value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())}
            placeholder="티커 (예: AMD)" maxLength={8}
            onKeyDown={e => e.key === 'Enter' && run()}
            className="bg-zinc-900 border border-zinc-700 text-zinc-100 text-sm px-3 py-2 rounded-lg w-32 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 font-mono" />
          <select value={months} onChange={e => setMonths(Number(e.target.value))}
            className="bg-zinc-900 border border-zinc-700 text-zinc-100 text-sm px-3 py-2 rounded-lg focus:outline-none">
            <option value={3}>최근 3개월</option>
            <option value={6}>최근 6개월</option>
            <option value={9}>최근 9개월</option>
            <option value={12}>최근 12개월</option>
          </select>
          <button onClick={run} disabled={loading || !ticker.trim()}
            className={`px-5 py-2 text-sm font-semibold rounded-lg border transition-all
              ${loading || !ticker.trim()
                ? 'bg-zinc-900 border-zinc-700 text-zinc-500 cursor-not-allowed'
                : 'bg-emerald-500 border-emerald-400 text-black hover:bg-emerald-400'}`}>
            {loading ? '분석 중...' : '백테스트 실행 →'}
          </button>
        </div>
        <p className="text-[10px] text-zinc-700 mt-2">
          과거 {months}개월 동안 VCP 신호가 발생한 시점에 매수했을 때의 수익률을 시뮬레이션합니다.
        </p>
      </div>

      {error && <div className="mb-4 p-4 bg-red-950 border border-red-800 rounded-xl text-sm text-red-300">{error}</div>}

      {result && (
        <>
          {/* Stats summary */}
          {result.stats ? (
            <div className="mb-6">
              <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-3">
                {result.ticker} — {result.months}개월 백테스트 결과 ({result.stats.totalSignals}개 신호)
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <StatBox label="5일 승률" val={`${result.stats.winRate5d}%`}
                  color={result.stats.winRate5d >= 60 ? 'text-emerald-400' : 'text-red-400'} />
                <StatBox label="20일 승률" val={`${result.stats.winRate20d}%`}
                  color={result.stats.winRate20d >= 60 ? 'text-emerald-400' : 'text-red-400'} />
                <StatBox label="평균 수익(5일)" val={`${result.stats.avgRet5d > 0 ? '+' : ''}${result.stats.avgRet5d}%`}
                  color={result.stats.avgRet5d >= 0 ? 'text-emerald-400' : 'text-red-400'} />
                <StatBox label="평균 수익(20일)" val={`${result.stats.avgRet20d > 0 ? '+' : ''}${result.stats.avgRet20d}%`}
                  color={result.stats.avgRet20d >= 0 ? 'text-emerald-400' : 'text-red-400'} />
                <StatBox label="최대 이익" val={`+${result.stats.maxWin}%`} color="text-emerald-400" />
                <StatBox label="최대 손실" val={`${result.stats.maxLoss}%`} color="text-red-400" />
                <StatBox label="Profit Factor" val={`${result.stats.profitFactor}x`}
                  color={result.stats.profitFactor >= 1.5 ? 'text-emerald-400' : 'text-amber-400'} />
                <StatBox label="총 신호 횟수" val={`${result.stats.totalSignals}회`} color="text-zinc-300" />
              </div>

              {/* Win rate bar */}
              <div className="p-3 bg-zinc-900/50 rounded-lg mb-4">
                <div className="flex justify-between text-[10px] text-zinc-500 mb-1.5">
                  <span>20일 승률</span>
                  <span className={result.stats.winRate20d >= 60 ? 'text-emerald-400' : 'text-red-400'}>{result.stats.winRate20d}%</span>
                </div>
                <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all"
                    style={{ width: `${result.stats.winRate20d}%`, background: result.stats.winRate20d >= 60 ? '#10b981' : result.stats.winRate20d >= 50 ? '#f59e0b' : '#ef4444' }} />
                </div>
                <p className="text-[10px] text-zinc-600 mt-1.5" style={{ fontFamily: 'system-ui' }}>
                  {result.stats.winRate20d >= 65
                    ? '✅ 우수한 승률 — 이 전략이 이 종목에 효과적입니다.'
                    : result.stats.winRate20d >= 50
                    ? '⚠ 보통 승률 — 추가 필터링 조건과 함께 사용하세요.'
                    : '❌ 낮은 승률 — 이 종목에서 VCP 전략 단독 사용은 위험합니다.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="mb-4 p-4 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-zinc-400">
              {result.ticker} — {result.months}개월 동안 VCP 신호가 발생하지 않았습니다.
            </div>
          )}

          {/* Signal table */}
          {result.signals.length > 0 && (
            <div>
              <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-3">신호 발생 내역</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-800">
                      {['날짜','매수가','신호 유형','VCP점수','5일','10일','20일','60일'].map(h => (
                        <th key={h} className="text-left text-zinc-600 pb-2 pr-4 font-normal">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.signals.map((s, i) => (
                      <tr key={i} className="border-b border-zinc-900 hover:bg-zinc-900/40">
                        <td className="py-2 pr-4 text-zinc-400 font-mono">{s.date}</td>
                        <td className="py-2 pr-4 text-zinc-300 font-mono">${s.price}</td>
                        <td className="py-2 pr-4">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${s.signalType.includes('돌파') ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-zinc-900 text-zinc-400 border border-zinc-700'}`}>
                            {s.signalType}
                          </span>
                        </td>
                        <td className="py-2 pr-4">
                          <span className={`font-mono ${s.vcpScore >= 70 ? 'text-emerald-400' : s.vcpScore >= 50 ? 'text-amber-400' : 'text-zinc-500'}`}>{s.vcpScore}</span>
                        </td>
                        <RetCell val={s.ret5d} />
                        <RetCell val={s.ret10d} />
                        <RetCell val={s.ret20d} />
                        <RetCell val={s.ret60d} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-zinc-700 mt-3">
                * 실제 매매 시 수수료, 슬리피지가 발생합니다. 백테스트 결과가 미래 수익을 보장하지 않습니다.
              </p>
            </div>
          )}
        </>
      )}

      {!result && !loading && (
        <div className="text-center py-16">
          <div className="text-4xl text-zinc-800 mb-3">📊</div>
          <p className="text-zinc-600 text-sm">티커와 기간을 입력하고 백테스트를 실행하세요.</p>
          <p className="text-zinc-700 text-xs mt-1">VCP 신호 발생 시점에 매수했을 때의 실제 수익률을 계산합니다.</p>
        </div>
      )}
    </div>
  );
}

function StatBox({ label, val, color }: { label: string; val: string; color: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-center">
      <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">{label}</div>
      <div className={`text-lg font-semibold font-mono ${color}`}>{val}</div>
    </div>
  );
}

function RetCell({ val }: { val: number | null }) {
  if (val === null) return <td className="py-2 pr-4 text-zinc-700 font-mono">-</td>;
  const color = val > 0 ? 'text-emerald-400' : val < 0 ? 'text-red-400' : 'text-zinc-400';
  return <td className={`py-2 pr-4 font-mono font-semibold ${color}`}>{val > 0 ? '+' : ''}{val}%</td>;
}

