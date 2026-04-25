'use client';
import { StockAnalysis } from '@/types/stock';

function sigScore(s: string) {
  return s === 'STRONG_BUY' ? 5 : s === 'BUY' ? 4 : s === 'HOLD' ? 3 : s === 'SELL' ? 2 : 1;
}

export default function TopPicks({ stocks }: { stocks: StockAnalysis[] }) {
  const picks = [...stocks]
    .filter(s => s.signal === 'STRONG_BUY' || s.signal === 'BUY')
    .sort((a, b) => sigScore(b.signal) - sigScore(a.signal) || Number(b.momentum_score) - Number(a.momentum_score))
    .slice(0, 3);

  if (picks.length === 0) {
    return (
      <div className="mb-8 p-5 border border-zinc-800 rounded-xl bg-bg-card">
        <div className="text-xs text-zinc-600 uppercase tracking-widest mb-1">오늘의 추천 매수</div>
        <p className="text-sm text-zinc-500">현재 매수 신호 없음 — 시장 관망 구간입니다.</p>
      </div>
    );
  }

  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[10px] text-zinc-600 uppercase tracking-widest">오늘의 추천 매수</span>
        <span className="text-[10px] text-emerald-700 bg-emerald-950 border border-emerald-800 px-2 py-0.5 rounded-full">
          Top {picks.length}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {picks.map((s, i) => <TopCard key={s.ticker} stock={s} rank={i} />)}
      </div>
    </div>
  );
}

function TopCard({ stock, rank }: { stock: StockAnalysis; rank: number }) {
  const score  = Math.min(10, Math.max(1, Number(stock.momentum_score)));
  const isStrong = stock.signal === 'STRONG_BUY';
  const rankLabel = ['1st', '2nd', '3rd'][rank];

  return (
    <div className={`relative rounded-xl border p-5 bg-bg-card overflow-hidden
      ${isStrong
        ? 'border-emerald-500/60 shadow-[0_0_24px_rgba(16,185,129,0.1)]'
        : 'border-emerald-800/60'}`}>
      {isStrong && (
        <div className="absolute top-0 right-0 text-[9px] font-semibold text-black bg-emerald-400 px-2 py-0.5 rounded-bl-lg">
          즉시매수
        </div>
      )}
      <div className="text-[10px] text-zinc-600 mb-1">{rankLabel}</div>
      <div className="text-2xl font-semibold text-zinc-100 mb-0.5">{stock.ticker}</div>
      {stock.entry_zone && <div className="text-xs text-emerald-400 mb-3">진입 {stock.entry_zone}</div>}

      <div className="mb-3">
        <div className="flex justify-between text-[10px] text-zinc-600 mb-1">
          <span>모멘텀</span>
          <span className="text-emerald-400 font-semibold">{score}/10</span>
        </div>
        <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${score * 10}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-zinc-500">
        <span>RSI <span className={stock.rsi >= 45 && stock.rsi <= 75 ? 'text-emerald-400' : 'text-amber-400'}>{stock.rsi}</span></span>
        <span>MACD <span className={stock.macd_histogram > 0 ? 'text-emerald-400' : 'text-red-400'}>{stock.macd_histogram > 0 ? '▲' : '▼'}</span></span>
        <span>거래량 <span className={stock.volume_ratio > 1.5 ? 'text-emerald-400' : 'text-zinc-400'}>{stock.volume_ratio}x</span></span>
        <span>BB <span className="text-zinc-400">{stock.bb_position}%</span></span>
        {stock.stop_loss && <span className="col-span-2">손절 <span className="text-red-400">{stock.stop_loss}</span></span>}
      </div>
    </div>
  );
}
