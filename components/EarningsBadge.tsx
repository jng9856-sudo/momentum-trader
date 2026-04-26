'use client';

interface EarningsInfo {
  earningsDate: string | null;
  daysUntil: number | null;
  epsEstimate: number | null;
  revenueEstimate: string | null;
  lastEPS: number | null;
}

function urgencyStyle(days: number) {
  if (days <= 3)  return { badge: 'bg-red-900 border-red-600 text-red-200',   dot: 'bg-red-400',    label: '⚡ 실적 임박' };
  if (days <= 7)  return { badge: 'bg-orange-950 border-orange-700 text-orange-300', dot: 'bg-orange-400', label: '실적 발표 임박' };
  if (days <= 14) return { badge: 'bg-amber-950 border-amber-800 text-amber-300', dot: 'bg-amber-400', label: '실적 예정' };
  return           { badge: 'bg-zinc-900 border-zinc-700 text-zinc-400',      dot: 'bg-zinc-500',   label: '실적 예정' };
}

export default function EarningsBadge({ info }: { info: EarningsInfo }) {
  if (!info.earningsDate || info.daysUntil === null) return null;

  const { badge, dot, label } = urgencyStyle(info.daysUntil);

  return (
    <div className={`flex flex-col gap-1.5 px-3 py-2 rounded-lg border text-xs ${badge}`}>
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot} animate-pulse`} />
        <span className="font-semibold">{label}</span>
        <span className="font-mono">{info.earningsDate}</span>
        <span className="text-[10px] opacity-70">({info.daysUntil}일 후)</span>
      </div>
      {(info.epsEstimate !== null || info.revenueEstimate) && (
        <div className="flex gap-3 text-[10px] opacity-80 pl-3.5">
          {info.epsEstimate !== null && (
            <span>EPS 예상 <span className="font-mono font-semibold">${info.epsEstimate}</span></span>
          )}
          {info.revenueEstimate && (
            <span>매출 예상 <span className="font-mono font-semibold">{info.revenueEstimate}</span></span>
          )}
          {info.lastEPS !== null && (
            <span>전분기 실적 <span className="font-mono font-semibold">${info.lastEPS}</span></span>
          )}
        </div>
      )}
    </div>
  );
}

