'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { StockAnalysis } from '@/types/stock';
import TradingViewChart from './TradingViewChart';

const CACHE_KEY       = 'mt_analysis_v4';
const PORTFOLIO_CACHE = 'mt_portfolio_cache_v2';

const SIG_KO: Record<string, string> = {
  STRONG_BUY: '즉시매수', BUY: '매수', HOLD: '관망', SELL: '매도', STRONG_SELL: '즉시매도',
  BREAKOUT: '즉시진입', SETUP: '진입대기', WATCH: '관심등록',
};
const SIG_COLOR: Record<string, string> = {
  STRONG_BUY:  'text-emerald-300 border-emerald-500 bg-emerald-950',
  BUY:         'text-emerald-400 border-emerald-700 bg-emerald-950/60',
  BREAKOUT:    'text-emerald-300 border-emerald-500 bg-emerald-950',
  SETUP:       'text-emerald-400 border-emerald-700 bg-emerald-950/60',
  WATCH:       'text-sky-400     border-sky-700     bg-sky-950/60',
  HOLD:        'text-amber-400   border-amber-700   bg-amber-950/60',
  SELL:        'text-red-400     border-red-700     bg-red-950/60',
  STRONG_SELL: 'text-red-300     border-red-500     bg-red-950',
};

interface BullBear { text: string; type: 'bull' | 'bear' | 'neutral'; }

function generateReasons(s: StockAnalysis): { bulls: BullBear[]; bears: BullBear[] } {
  const bulls: BullBear[] = [];
  const bears: BullBear[] = [];

  if (s.rs_vs_index === 'STRONG')  bulls.push({ text: `S&P500 대비 RS 강세 — 지수 아웃퍼폼 중`, type: 'bull' });
  if (s.rs_vs_index === 'WEAK')    bears.push({ text: `S&P500 대비 RS 약세 — 지수 언더퍼폼 중`, type: 'bear' });
  if (s.rs_vs_sector === 'STRONG') bulls.push({ text: `섹터 내 RS 우위 — 동종 종목 대비 강세`, type: 'bull' });
  if (s.rs_vs_sector === 'WEAK')   bears.push({ text: `섹터 내 RS 열위 — 동종 종목 대비 약세`, type: 'bear' });

  if (s.ma50_status === 'ABOVE') bulls.push({ text: `50일 이동평균선 위에서 거래 중 (지지 확인)`, type: 'bull' });
  if (s.ma50_status === 'BELOW') bears.push({ text: `50일 이동평균선 아래 — 추세 약화 신호`, type: 'bear' });
  if (s.ma50_status === 'AT')    bears.push({ text: `50일 이동평균선 근접 — 지지/저항 테스트 중`, type: 'neutral' as 'bear' });

  if (s.rsi >= 45 && s.rsi <= 70) bulls.push({ text: `RSI ${s.rsi} — 건전한 강세 구간 (45–70)`, type: 'bull' });
  if (s.rsi > 78)  bears.push({ text: `RSI ${s.rsi} 과열 — 단기 조정 가능성`, type: 'bear' });
  if (s.rsi < 35)  bears.push({ text: `RSI ${s.rsi} 침체 — 하락 압력 지속`, type: 'bear' });

  if (s.macd_histogram > 0) bulls.push({ text: `MACD 히스토그램 양수(+${s.macd_histogram}) — 상승 모멘텀`, type: 'bull' });
  else bears.push({ text: `MACD 히스토그램 음수(${s.macd_histogram}) — 하락 모멘텀`, type: 'bear' });

  if (s.volume_ratio > 1.5) bulls.push({ text: `거래량 ${s.volume_ratio}x — 평균 대비 강한 매수세 확인`, type: 'bull' });
  if (s.volume_ratio < 0.7) bears.push({ text: `거래량 ${s.volume_ratio}x — 거래량 부족, 신뢰도 낮음`, type: 'bear' });

  if (s.bb_position >= 40 && s.bb_position <= 80) bulls.push({ text: `볼린저밴드 ${s.bb_position}% — 건전한 중간~상단 구간`, type: 'bull' });
  if (s.bb_position > 90) bears.push({ text: `볼린저밴드 ${s.bb_position}% — 상단 돌파, 과매수 주의`, type: 'bear' });
  if (s.bb_position < 15) bears.push({ text: `볼린저밴드 ${s.bb_position}% — 하단 근접, 약세 압력`, type: 'bear' });

  if (s.pattern === 'BREAKOUT')  bulls.push({ text: `52주 고점 돌파 패턴 — 강한 상승 모멘텀`, type: 'bull' });
  if (s.pattern === 'CUP')       bulls.push({ text: `컵앤핸들 패턴 형성 — 돌파 시 강한 상승 가능`, type: 'bull' });
  if (s.pattern === 'W_BASE')    bulls.push({ text: `W베이스 패턴 — 이중 바닥 후 반등 시도`, type: 'bull' });
  if (s.pattern === 'DOWNTREND') bears.push({ text: `하락 추세 패턴 — 반등 확인 전 진입 위험`, type: 'bear' });

  if (s.atr_pct < 2) bulls.push({ text: `ATR ${s.atr_pct}% — 낮은 변동성, 안정적 진입 환경`, type: 'bull' });
  if (s.atr_pct > 4) bears.push({ text: `ATR ${s.atr_pct}% — 높은 변동성, 손절폭 확대 필요`, type: 'bear' });

  return { bulls, bears };
}

export default function StockDetailPage() {
  const { ticker } = useParams<{ ticker: string }>();
  const router     = useRouter();
  const [stock,     setStock]     = useState<StockAnalysis | null>(null);
  const [notFound,  setNotFound]  = useState(false);
  const [fetching,  setFetching]  = useState(false); // 라이브 API 호출 중
  const [insider,   setInsider]   = useState<{
    transactions: { filingDate: string; insiderName: string; title: string; transactionType: string; shares: number; price: number | null; totalValue: number | null; isBuy: boolean }[];
    recentBuys: number; recentSells: number; netShares: number;
    signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; detail: string;
  } | null>(null);

  useEffect(() => {
    if (!ticker) return;
    const upper = ticker.toUpperCase();

    // ── 1) 메인 분석 캐시 (mt_analysis_v4) ───────────────────────────────────
    try {
      const cache = localStorage.getItem(CACHE_KEY);
      if (cache) {
        const { stocks } = JSON.parse(cache);
        const found = (stocks as StockAnalysis[]).find(s => s.ticker === upper);
        if (found) {
          setStock(found);
          fetch(`/api/insider?ticker=${found.ticker}`)
            .then(r => r.json()).then(d => setInsider(d)).catch(() => {});
          return;
        }
      }
    } catch {}

    // ── 2) 포트폴리오 캐시 (mt_portfolio_cache_v2) ───────────────────────────
    // portfolio 분석 결과에는 StockAnalysis와 호환되는 필드가 있음
    try {
      const pcache = localStorage.getItem(PORTFOLIO_CACHE);
      if (pcache) {
        const { results } = JSON.parse(pcache);
        // portfolio API가 반환하는 HoldingResult에서 StockAnalysis에 필요한 필드 매핑
        const found = (results as StockAnalysis[]).find(s => s.ticker === upper);
        if (found) {
          setStock(found);
          fetch(`/api/insider?ticker=${found.ticker}`)
            .then(r => r.json()).then(d => setInsider(d)).catch(() => {});
          return;
        }
      }
    } catch {}

    // ── 3) 캐시 미스 → /api/analyze 직접 호출 ───────────────────────────────
    setFetching(true);
    fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers: [upper] }),
    })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        const found = (data.stocks as StockAnalysis[])?.find(s => s.ticker === upper);
        if (found) {
          setStock(found);
          fetch(`/api/insider?ticker=${found.ticker}`)
            .then(r => r.json()).then(d => setInsider(d)).catch(() => {});
        } else {
          setNotFound(true);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setFetching(false));
  }, [ticker]);

  // ── 로딩 상태 (라이브 API 호출 중) ──────────────────────────────────────────
  if (fetching) return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center">
      <div className="text-center">
        <div className="text-zinc-500 text-sm font-mono mb-2">
          {ticker?.toUpperCase()} 실시간 분석 중...
        </div>
        <div className="text-xs text-zinc-600">Yahoo Finance 데이터 수집 중 (약 10–30초)</div>
      </div>
    </div>
  );

  if (notFound) return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center">
      <div className="text-center">
        <div className="text-5xl text-zinc-700 mb-4">◈</div>
        <p className="text-zinc-500 mb-4">{ticker} 분석 데이터가 없습니다.</p>
        <button onClick={() => router.push('/')} className="text-sm text-emerald-400 hover:text-emerald-300">
          ← 메인으로 돌아가기
        </button>
      </div>
    </div>
  );

  if (!stock) return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center">
      <div className="text-zinc-500 text-sm font-mono">불러오는 중...</div>
    </div>
  );

  const { bulls, bears } = generateReasons(stock);
  const score = Math.min(10, Math.max(1, Number(stock.momentum_score)));

  return (
    <div className="min-h-screen bg-bg-base">
      <div className="max-w-4xl mx-auto px-4 py-8">

        {/* Back */}
        <button onClick={() => router.push('/')}
          className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors mb-6">
          ← 목록으로
        </button>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6 pb-6 border-b border-zinc-800">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-3xl font-semibold text-zinc-100">{stock.ticker}</h1>
              <span className={`text-sm font-semibold px-3 py-1 rounded-md border ${SIG_COLOR[stock.signal] ?? ''}`}>
                {SIG_KO[stock.signal] ?? stock.signal}
              </span>
            </div>
            <p className="text-xs text-zinc-600">Yahoo Finance 실시간 데이터 기반 모멘텀 분석</p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-semibold text-zinc-100 font-mono">{score}<span className="text-lg text-zinc-600">/10</span></div>
            <div className="text-xs text-zinc-600">모멘텀 점수</div>
          </div>
        </div>

        {/* TradingView Chart */}
        <div className="mb-8">
          <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-3">실시간 차트 (TradingView)</div>
          <TradingViewChart ticker={stock.ticker} />
          <p className="text-[10px] text-zinc-700 mt-2">RSI · MACD · 볼린저밴드 보조지표 포함. 차트 우측 상단에서 기간/지표 변경 가능.</p>
        </div>

        {/* Indicators row */}
        <div className="grid grid-cols-5 gap-3 mb-8">
          {[
            { label: 'RSI(14)', val: stock.rsi, color: stock.rsi > 78 ? 'text-red-400' : stock.rsi < 35 ? 'text-sky-400' : 'text-emerald-400', sub: stock.rsi > 78 ? '과열' : stock.rsi < 35 ? '침체' : '정상' },
            { label: 'MACD', val: stock.macd_histogram, color: stock.macd_histogram > 0 ? 'text-emerald-400' : 'text-red-400', sub: stock.macd_histogram > 0 ? '상승' : '하락' },
            { label: '거래량', val: `${stock.volume_ratio}x`, color: stock.volume_ratio > 1.5 ? 'text-emerald-400' : stock.volume_ratio < 0.7 ? 'text-red-400' : 'text-zinc-400', sub: '평균 대비' },
            { label: 'BB위치', val: `${stock.bb_position}%`, color: stock.bb_position > 85 ? 'text-amber-400' : stock.bb_position < 15 ? 'text-sky-400' : 'text-zinc-400', sub: '밴드 내 위치' },
            { label: 'ATR변동성', val: `${stock.atr_pct}%`, color: stock.atr_pct > 4 ? 'text-amber-400' : 'text-zinc-400', sub: '일평균 변동폭' },
          ].map(({ label, val, color, sub }) => (
            <div key={label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-center">
              <div className="text-[9px] text-zinc-600 uppercase tracking-widest mb-1">{label}</div>
              <div className={`text-lg font-semibold font-mono ${color}`}>{val}</div>
              <div className="text-[9px] text-zinc-600 mt-0.5">{sub}</div>
            </div>
          ))}
        </div>

        {/* Buy / Risk reasons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          <div className="bg-zinc-900/40 border border-emerald-900/60 rounded-xl p-4">
            <div className="text-xs font-semibold text-emerald-400 mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
              매수 근거 ({bulls.length}개)
            </div>
            {bulls.length === 0 && <p className="text-xs text-zinc-600">매수 근거가 없습니다.</p>}
            <ul className="space-y-2">
              {bulls.map((b, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-zinc-300" style={{ fontFamily: 'system-ui, sans-serif' }}>
                  <span className="text-emerald-400 mt-0.5 shrink-0">✓</span>
                  {b.text}
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-zinc-900/40 border border-red-900/60 rounded-xl p-4">
            <div className="text-xs font-semibold text-red-400 mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />
              위험 요인 ({bears.length}개)
            </div>
            {bears.length === 0 && <p className="text-xs text-zinc-600">특별한 위험 요인이 없습니다.</p>}
            <ul className="space-y-2">
              {bears.map((b, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-zinc-300" style={{ fontFamily: 'system-ui, sans-serif' }}>
                  <span className="text-red-400 mt-0.5 shrink-0">✕</span>
                  {b.text}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Price levels */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          {[
            { label: '진입 구간',  val: stock.entry_zone,     color: 'text-emerald-400', border: 'border-emerald-900' },
            { label: '손절선',     val: stock.stop_loss,      color: 'text-red-400',     border: 'border-red-900' },
            { label: '지지선',     val: stock.key_support,    color: 'text-sky-400',     border: 'border-sky-900' },
            { label: '저항선',     val: stock.key_resistance, color: 'text-purple-400',  border: 'border-purple-900' },
          ].filter(x => x.val).map(({ label, val, color, border }) => (
            <div key={label} className={`bg-zinc-900/40 border ${border} rounded-xl p-4 text-center`}>
              <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">{label}</div>
              <div className={`text-lg font-semibold font-mono ${color}`}>{val}</div>
            </div>
          ))}
        </div>

        {/* RS summary */}
        <div className="grid grid-cols-2 gap-3 mb-8">
          {[
            { label: '지수(S&P500) 대비 RS', val: stock.rs_vs_index,  map: { STRONG: '강세 — 지수 아웃퍼폼', NEUTRAL: '중립', WEAK: '약세 — 지수 언더퍼폼' } },
            { label: '섹터 내 RS',           val: stock.rs_vs_sector, map: { STRONG: '강세 — 섹터 리더',    NEUTRAL: '중립', WEAK: '약세 — 섹터 뒤처짐' } },
          ].map(({ label, val, map }) => {
            const color = val === 'STRONG' ? 'text-emerald-400' : val === 'WEAK' ? 'text-red-400' : 'text-zinc-400';
            return (
              <div key={label} className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4">
                <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2">{label}</div>
                <div className={`text-sm font-semibold ${color}`}>{map[val as keyof typeof map]}</div>
              </div>
            );
          })}
        </div>

        {/* Insider Trading */}
        {insider && (
          <div className="mb-8">
            <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-3">
              SEC Form 4 내부자 거래 (최근 90일)
            </div>
            <div className={`p-4 rounded-xl border mb-4 ${
              insider.signal === 'BULLISH' ? 'border-emerald-800 bg-emerald-950/20' :
              insider.signal === 'BEARISH' ? 'border-red-800 bg-red-950/20' : 'border-zinc-800 bg-zinc-900/40'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <span className={`text-sm font-semibold ${
                  insider.signal === 'BULLISH' ? 'text-emerald-400' :
                  insider.signal === 'BEARISH' ? 'text-red-400' : 'text-zinc-400'
                }`}>
                  {insider.signal === 'BULLISH' ? '🟢 내부자 매집 신호' :
                   insider.signal === 'BEARISH' ? '🔴 내부자 분산 신호' : '⚪ 중립'}
                </span>
                <div className="flex gap-3 text-xs text-zinc-500">
                  <span>매수 <span className="text-emerald-400 font-semibold">{insider.recentBuys}건</span></span>
                  <span>매도 <span className="text-red-400 font-semibold">{insider.recentSells}건</span></span>
                </div>
              </div>
              <p className="text-xs text-zinc-400" style={{ fontFamily: 'system-ui' }}>{insider.detail}</p>
            </div>
            {insider.transactions.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-800">
                      {['날짜','내부자','직책','거래','수량','단가','총액'].map(h => (
                        <th key={h} className="text-left text-zinc-600 pb-2 pr-3 font-normal">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {insider.transactions.map((t, i) => (
                      <tr key={i} className="border-b border-zinc-900 hover:bg-zinc-900/40">
                        <td className="py-2 pr-3 text-zinc-500 font-mono text-[10px]">{t.filingDate}</td>
                        <td className="py-2 pr-3 text-zinc-300 text-[10px]">{t.insiderName}</td>
                        <td className="py-2 pr-3 text-zinc-500 text-[10px]">{t.title}</td>
                        <td className="py-2 pr-3">
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${t.isBuy ? 'bg-emerald-950 text-emerald-400' : 'bg-red-950 text-red-400'}`}>
                            {t.transactionType}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-zinc-300 font-mono text-[10px]">{t.shares.toLocaleString()}</td>
                        <td className="py-2 pr-3 text-zinc-400 font-mono text-[10px]">{t.price ? `$${t.price}` : '-'}</td>
                        <td className="py-2 pr-3 text-zinc-400 font-mono text-[10px]">{t.totalValue ? `$${t.totalValue.toLocaleString()}` : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[10px] text-zinc-700 mt-2">출처: SEC EDGAR Form 4 공시 데이터</p>
              </div>
            )}
          </div>
        )}

        <p className="text-[10px] text-zinc-700 text-center" style={{ fontFamily: 'system-ui, sans-serif' }}>
          ⚠ Yahoo Finance 공개 데이터 기반 참고 정보. 투자 판단 및 손익 책임은 본인에게 있습니다.
        </p>
      </div>
    </div>
  );
}
