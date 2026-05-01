'use client';
import { StockAnalysis } from '@/types/stock';

export default function TopBarChart({ stocks }: { stocks: StockAnalysis[] }) {
  const top = [...stocks]
    .filter(s => s.signal === 'STRONG_BUY' || s.signal === 'BUY')
    .sort((a, b) => Number(b.momentum_score) - Number(a.momentum_score))
    .slice(0, 10);

  if (top.length === 0) return null;

  return (
    <div className="mb-6 p-4 border border-zinc-800 rounded-xl bg-zinc-900/40">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[10px] text-zinc-500 uppercase tracking-widest">매수 신호 Top 10 — 모멘텀 점수순</div>
        </div>
        <span className="text-[10px] text-emerald-700 bg-emerald-950 border border-emerald-800 px-2 py-0.5 rounded-full">
          {top.length}개
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {top.map((s, i) => {
          const score    = Math.min(10, Math.max(0, Number(s.momentum_score)));
          const pct      = (score / 10) * 100;
          const isStrong = s.signal === 'STRONG_BUY';
          const barColor = isStrong ? '#10b981' : '#34d399';
          const rs       = s.rs_rank;

          return (
            <div key={s.ticker} className="flex items-center gap-2 group">
              {/* 순위 */}
              <span className="text-[10px] text-zinc-600 font-mono w-4 shrink-0 text-right">{i + 1}</span>

              {/* 티커 */}
              <span className="text-xs font-bold text-zinc-200 font-mono w-14 shrink-0">{s.ticker}</span>

              {/* 바 */}
              <div className="flex-1 h-5 bg-zinc-800 rounded overflow-hidden relative min-w-0">
                <div className="h-full rounded transition-all duration-700 flex items-center"
                  style={{ width: `${pct}%`, background: barColor, minWidth: '4px' }} />
              </div>

              {/* 점수 */}
              <span className="text-[10px] font-mono w-7 text-right shrink-0 font-semibold"
                style={{ color: barColor }}>
                {score.toFixed(1)}
              </span>

              {/* RS 순위 */}
              {rs !== undefined && (
                <span className={`text-[9px] font-mono w-10 shrink-0 text-right ${rs >= 80 ? 'text-emerald-400' : rs >= 50 ? 'text-zinc-400' : 'text-red-400'}`}>
                  RS{rs}%
                </span>
              )}

              {/* 신호 배지 */}
              <span className={`text-[9px] px-1.5 py-0.5 rounded border shrink-0 w-14 text-center ${isStrong ? 'bg-emerald-900 text-emerald-200 border-emerald-700' : 'bg-emerald-950 text-emerald-400 border-emerald-800'}`}>
                {isStrong ? '즉시매수' : '매수'}
              </span>

              {/* 진입가 (넓은 화면) */}
              {s.entry_zone && (
                <span className="text-[9px] text-zinc-500 font-mono hidden xl:inline shrink-0 w-28 truncate">
                  진입 {s.entry_zone}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

