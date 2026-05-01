'use client';
import { StockAnalysis } from '@/types/stock';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';

function sigScore(s: string) {
  return s === 'STRONG_BUY' ? 5 : s === 'BUY' ? 4 : 3;
}

interface RtPrice { price: number; changePct: number; isRealtime?: boolean; }

export default function TopPicks({ stocks }: { stocks: StockAnalysis[] }) {
  const router = useRouter();
  const [rtPrices, setRtPrices] = useState<Record<string, RtPrice & { isRealtime?: boolean }>>({});

  const picks = [...stocks]
    .filter(s => s.signal === 'STRONG_BUY' || s.signal === 'BUY')
    .sort((a, b) => {
      const sigDiff = sigScore(b.signal) - sigScore(a.signal);
      if (sigDiff !== 0) return sigDiff;
      // 52w 신고가 돌파 우선
      if (a.breakout_52w && !b.breakout_52w) return -1;
      if (!a.breakout_52w && b.breakout_52w) return 1;
      return Number(b.momentum_score) - Number(a.momentum_score);
    })
    .slice(0, 5);

  // 실시간 가격 조회
  useEffect(() => {
    if (picks.length === 0) return;
    const tickers = picks.map(s => s.ticker).join(',');
    fetch(`/api/realtime?tickers=${tickers}`)
      .then(r => r.json())
      .then(d => {
        const map: Record<string, RtPrice> = {};
        const quotes = d.quotes ?? (d.price ? [{ ticker: picks[0].ticker, ...d }] : []);
        for (const q of quotes) if (q?.price > 0) map[q.ticker] = { price: q.price, changePct: q.changePct, isRealtime: q.isRealtime };
        setRtPrices(map);
      }).catch(() => {});
    const iv = setInterval(() => {
      fetch(`/api/realtime?tickers=${tickers}`)
        .then(r => r.json())
        .then(d => {
          const map: Record<string, RtPrice> = {};
          const quotes = d.quotes ?? (d.price ? [{ ticker: picks[0].ticker, ...d }] : []);
          for (const q of quotes) if (q?.price > 0) map[q.ticker] = { price: q.price, changePct: q.changePct, isRealtime: q.isRealtime };
          setRtPrices(map);
        }).catch(() => {});
    }, 30000);
    return () => clearInterval(iv);
  }, [picks.map(p => p.ticker).join(',')]);

  if (picks.length === 0) return (
    <div className="mb-6 p-4 border border-zinc-800 rounded-xl bg-zinc-900/30 text-center">
      <p className="text-sm text-zinc-500">현재 매수 추천 종목 없음 — 시장 관망 구간</p>
    </div>
  );

  return (
    <div className="mb-8">
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-4">
        <div>
          <div className="text-sm font-semibold text-zinc-100">오늘의 매수 추천</div>
          <div className="text-[10px] text-zinc-600">모멘텀 점수 + RS 랭킹 + 신고가 돌파 기준 자동 선정</div>
        </div>
        <span className="text-[10px] text-emerald-700 bg-emerald-950 border border-emerald-800 px-2 py-0.5 rounded-full">
          Top {picks.length}
        </span>
      </div>

      {/* ✅ 수정 3: lg:grid-cols-3 → xl:grid-cols-4 2xl:grid-cols-5 추가 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
        {picks.map((s, i) => {
          const rt = rtPrices[s.ticker];
          const score = Math.min(10, Math.max(1, Number(s.momentum_score)));
          const isStrong = s.signal === 'STRONG_BUY';
          const isBreakout = s.breakout_52w;

          return (
            <button
              key={s.ticker}
              onClick={() => router.push(`/stock/${s.ticker}`)}
              className={`relative rounded-xl border p-4 bg-bg-card text-left transition-all hover:scale-[1.01] hover:border-zinc-600 active:scale-[0.99]
                ${i === 0 && isStrong ? 'border-emerald-500/70 shadow-[0_0_24px_rgba(16,185,129,0.12)]' :
                  isBreakout ? 'border-amber-600/60' : 'border-emerald-800/50'}`}
            >
              {/* 순위 배지 */}
              <div className="absolute top-2 right-2 flex gap-1">
                {isBreakout && (
                  <span className="text-[9px] bg-amber-900 text-amber-300 border border-amber-700 px-1.5 py-0.5 rounded">
                    🚀 신고가
                  </span>
                )}
                {isStrong && (
                  <span className="text-[9px] bg-emerald-900 text-emerald-200 border border-emerald-700 px-1.5 py-0.5 rounded font-semibold">
                    즉시매수
                  </span>
                )}
                {!isStrong && (
                  <span className="text-[9px] bg-zinc-800 text-zinc-400 border border-zinc-700 px-1.5 py-0.5 rounded">
                    매수
                  </span>
                )}
              </div>

              {/* 순위 + 티커 */}
              <div className="flex items-baseline gap-2 mb-1 pr-16">
                <span className="text-[10px] text-zinc-600 font-mono">#{i+1}</span>
                <span className="text-xl font-bold text-zinc-100">{s.ticker}</span>
                {s.rs_rank !== undefined && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold
                    ${s.rs_rank >= 90 ? 'bg-emerald-950 text-emerald-300 border-emerald-800' : 'bg-zinc-900 text-zinc-400 border-zinc-800'}`}>
                    RS {s.rs_rank}%
                  </span>
                )}
              </div>

              {/* 실시간 가격 */}
              <div className="flex items-center gap-2 mb-3">
                {rt ? (
                  <>
                    <span className="text-lg font-semibold text-zinc-100 font-mono">${rt.price.toLocaleString()}</span>
                    <span className={`text-xs font-mono font-semibold ${rt.changePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {rt.changePct >= 0 ? '+' : ''}{rt.changePct?.toFixed(2)}%
                    </span>
                    <span className={`text-[9px] px-1 py-0.5 rounded ${rt.isRealtime !== false ? 'text-emerald-700 bg-emerald-950 border border-emerald-900 animate-pulse' : 'text-zinc-600 bg-zinc-900 border border-zinc-800'}`}>
                      {rt.isRealtime !== false ? '실시간' : '15분지연'}
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-zinc-600">가격 로딩 중...</span>
                )}
              </div>

              {/* 모멘텀 바 */}
              <div className="mb-3">
                <div className="flex justify-between text-[10px] text-zinc-600 mb-1">
                  <span>모멘텀</span>
                  <span className="text-emerald-400 font-semibold">{score}/10</span>
                </div>
                <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${score * 10}%` }} />
                </div>
              </div>

              {/* 핵심 지표 */}
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-zinc-500 mb-3">
                <span>지수 RS <span className={s.rs_vs_index === 'STRONG' ? 'text-emerald-400' : 'text-red-400'}>
                  {s.rs_vs_index === 'STRONG' ? '강세' : s.rs_vs_index === 'WEAK' ? '약세' : '중립'}
                </span></span>
                <span>RSI <span className={s.rsi >= 45 && s.rsi <= 72 ? 'text-emerald-400' : 'text-amber-400'}>{s.rsi}</span></span>
                <span>MACD <span className={s.macd_histogram > 0 ? 'text-emerald-400' : 'text-red-400'}>{s.macd_histogram > 0 ? '▲상승' : '▼하락'}</span></span>
                <span>거래량 <span className={s.volume_ratio > 1.5 ? 'text-emerald-400' : 'text-zinc-400'}>{s.volume_ratio}x</span></span>
                {s.weekly_trend && (
                  <span className="col-span-2">주봉 <span className={s.weekly_trend === 'UPTREND' ? 'text-emerald-400' : 'text-red-400'}>
                    {s.weekly_trend === 'UPTREND' ? '▲ 상승추세' : s.weekly_trend === 'DOWNTREND' ? '▼ 하락추세' : '횡보'}
                    {s.weekly_is_entry ? ' 🎯 최고타점' : ''}
                  </span></span>
                )}
              </div>

              {/* 진입/손절 */}
              <div className="flex flex-wrap gap-1.5">
                {s.entry_zone && (
                  <span className="text-[10px] px-2 py-0.5 rounded border bg-emerald-950/40 text-emerald-300 border-emerald-800">
                    진입 {s.entry_zone}
                  </span>
                )}
                {s.stop_loss && (
                  <span className="text-[10px] px-2 py-0.5 rounded border bg-red-950/40 text-red-300 border-red-800">
                    손절 {s.stop_loss}
                  </span>
                )}
              </div>

              {/* 클릭 힌트 */}
              <div className="text-[9px] text-zinc-700 mt-2 text-right">탭하면 상세 차트 →</div>
            </button>
          );
        })}
      </div>

      {/* 면책 */}
      <p className="text-[10px] text-zinc-700 mt-3 text-center" style={{ fontFamily: 'system-ui' }}>
        ⚠ 자동 선정 참고 정보 — 시장 배너 확인 후 손절선 설정 필수. 투자 판단은 본인 책임.
      </p>
    </div>
  );
}
