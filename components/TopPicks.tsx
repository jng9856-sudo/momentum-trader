'use client';

import { StockAnalysis } from '@/types/stock';

function confScore(c: string) {
  return c === 'HIGH' ? 3 : c === 'MEDIUM' ? 2 : 1;
}

export default function TopPicks({ stocks }: { stocks: StockAnalysis[] }) {
  const picks = stocks
    .filter(s => s.signal === 'BUY')
    .sort((a, b) => {
      const scoreDiff = Number(b.momentum_score) - Number(a.momentum_score);
      if (scoreDiff !== 0) return scoreDiff;
      return confScore(b.confidence) - confScore(a.confidence);
    })
    .slice(0, 3);

  if (picks.length === 0) {
    return (
      <div className="mb-8 p-5 border border-border rounded-xl bg-bg-card">
        <div className="text-xs text-zinc-600 uppercase tracking-widest mb-1">오늘의 추천 매수</div>
        <p className="text-sm text-zinc-500">현재 매수 신호 종목이 없습니다. 시장 관망 구간입니다.</p>
      </div>
    );
  }

  const rankLabel = ['1st', '2nd', '3rd'];

  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[10px] text-zinc-600 uppercase tracking-widest">오늘의 추천 매수</span>
        <span className="text-[10px] text-emerald-700 bg-emerald-950 border border-emerald-800 px-2 py-0.5 rounded-full">
          {picks.length}종목
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {picks.map((s, i) => (
          <TopPickCard key={s.ticker} stock={s} rank={rankLabel[i]} isTop={i === 0} />
        ))}
      </div>
    </div>
  );
}

function TopPickCard({ stock, rank, isTop }: { stock: StockAnalysis; rank: string; isTop: boolean }) {
  const score = Math.min(10, Math.max(1, Math.round(Number(stock.momentum_score) || 5)));
  const barW  = Math.round((score / 10) * 100);

  return (
    <div className={`relative rounded-xl border p-5 bg-bg-card overflow-hidden
      ${isTop
        ? 'border-emerald-600/60 shadow-[0_0_20px_rgba(16,185,129,0.08)]'
        : 'border-emerald-900/60'
      }`}
    >
      {isTop && (
        <div className="absolute top-0 right-0 text-[9px] font-semibold text-emerald-900 bg-emerald-400 px-2 py-0.5 rounded-bl-lg">
          TOP PICK
        </div>
      )}
      <div className="text-[10px] text-zinc-600 mb-1">{rank}</div>
      <div className="text-2xl font-semibold text-zinc-100 mb-0.5">{stock.ticker}</div>

      {stock.entry_zone && (
        <div className="text-xs text-emerald-400 mb-3">진입 {stock.entry_zone}</div>
      )}

      <div className="mb-3">
        <div className="flex justify-between text-[10px] text-zinc-600 mb-1">
          <span>모멘텀</span>
          <span className="text-emerald-400 font-semibold">{score}/10</span>
        </div>
        <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-emerald-500 momentum-bar-fill"
            style={{ '--target-width': `${barW}%`, width: `${barW}%` } as React.CSSProperties}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[10px] text-zinc-500">
        <div>
          RS지수 <span className={stock.rs_vs_index === 'STRONG' ? 'text-emerald-400' : 'text-red-400'}>
            {stock.rs_vs_index === 'STRONG' ? '강세' : stock.rs_vs_index === 'WEAK' ? '약세' : '중립'}
          </span>
        </div>
        <div>
          RS섹터 <span className={stock.rs_vs_sector === 'STRONG' ? 'text-emerald-400' : 'text-red-400'}>
            {stock.rs_vs_sector === 'STRONG' ? '강세' : stock.rs_vs_sector === 'WEAK' ? '약세' : '중립'}
          </span>
        </div>
        <div>
          {stock.ma50_status === 'ABOVE' ? '50일선 위 ▲' : stock.ma50_status === 'BELOW' ? '50일선 아래 ▼' : '50일선 근접 —'}
        </div>
        <div>
          {stock.stop_loss && <span>손절 <span className="text-red-400">{stock.stop_loss}</span></span>}
        </div>
      </div>
    </div>
  );
}
