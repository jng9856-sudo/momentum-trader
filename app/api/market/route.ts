import { NextResponse } from 'next/server';

async function fetchYahoo(ticker: string, range = '5d') {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=${range}`,
    { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 3600 } }
  );
  if (!res.ok) return null;
  const d = await res.json();
  const closes: number[] = (d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [])
    .filter((c: number) => c != null && !isNaN(c));
  return closes;
}

async function fetchQuoteSummary(ticker: string) {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=defaultKeyStatistics`,
    { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 3600 } }
  );
  if (!res.ok) return null;
  return await res.json();
}

function calcMA(arr: number[], n: number) {
  if (arr.length < n) return arr[arr.length - 1] ?? 0;
  return arr.slice(-n).reduce((a, b) => a + b, 0) / n;
}

export async function GET() {
  const r = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

  // ── 1. VIX ──────────────────────────────────────────────────────────────────
  const vixCloses = await fetchYahoo('^VIX', '1mo');
  const vix = vixCloses ? r(vixCloses[vixCloses.length - 1], 1) : null;
  const vixMA20 = vixCloses && vixCloses.length >= 20 ? r(calcMA(vixCloses, 20), 1) : null;
  const vixTrend = vix && vixMA20 ? (vix > vixMA20 * 1.05 ? 'RISING' : vix < vixMA20 * 0.95 ? 'FALLING' : 'FLAT') : null;

  // ── 2. SPY Momentum ─────────────────────────────────────────────────────────
  const spyCloses = await fetchYahoo('SPY', '3mo');
  let spyMomentum = 0, spyAboveMA50 = false, spyRet1m = 0;
  if (spyCloses && spyCloses.length >= 50) {
    const price = spyCloses[spyCloses.length - 1];
    const ma50  = calcMA(spyCloses, 50);
    const month1 = spyCloses[Math.max(0, spyCloses.length - 21)];
    spyAboveMA50 = price > ma50;
    spyRet1m     = r(((price - month1) / month1) * 100, 1);
    spyMomentum  = r(((price - month1) / month1) * 100, 1);
  }

  // ── 3. QQQ Momentum ─────────────────────────────────────────────────────────
  const qqqCloses = await fetchYahoo('QQQ', '3mo');
  let qqqRet1m = 0;
  if (qqqCloses && qqqCloses.length >= 21) {
    const price  = qqqCloses[qqqCloses.length - 1];
    const month1 = qqqCloses[Math.max(0, qqqCloses.length - 21)];
    qqqRet1m = r(((price - month1) / month1) * 100, 1);
  }

  // ── 4. Put/Call Ratio proxy (VIX-based) ─────────────────────────────────────
  // CBOE P/C ratio proxy: when VIX spikes, put buying is high (>1.0 = fear)
  const putCallProxy = vix ? r(vix / 20, 2) : null; // normalized proxy

  // ── 5. New Highs / New Lows proxy ──────────────────────────────────────────
  // Check IWM (Russell 2000) as market breadth proxy
  const iwmCloses = await fetchYahoo('IWM', '3mo');
  let marketBreadth = 0;
  if (iwmCloses && iwmCloses.length >= 50) {
    const price = iwmCloses[iwmCloses.length - 1];
    const high13w = Math.max(...iwmCloses);
    marketBreadth = r(((price - high13w) / high13w) * 100, 1); // distance from 13w high
  }

  // ── 6. Composite Fear & Greed Score (0–100) ─────────────────────────────────
  let fgScore = 50;

  // VIX contribution (inverted — high VIX = fear = low score)
  if (vix !== null) {
    if (vix < 12)       fgScore += 20;
    else if (vix < 16)  fgScore += 15;
    else if (vix < 20)  fgScore += 5;
    else if (vix < 25)  fgScore -= 5;
    else if (vix < 30)  fgScore -= 15;
    else if (vix < 40)  fgScore -= 20;
    else                fgScore -= 25;
  }

  // Market momentum contribution
  if (spyMomentum > 5)       fgScore += 15;
  else if (spyMomentum > 2)  fgScore += 8;
  else if (spyMomentum > 0)  fgScore += 3;
  else if (spyMomentum > -2) fgScore -= 3;
  else if (spyMomentum > -5) fgScore -= 8;
  else                        fgScore -= 15;

  // SPY above MA50
  if (spyAboveMA50) fgScore += 10; else fgScore -= 10;

  // Market breadth (IWM distance from high)
  if (marketBreadth > -5)       fgScore += 5;
  else if (marketBreadth > -10) fgScore += 0;
  else if (marketBreadth > -15) fgScore -= 5;
  else                          fgScore -= 10;

  fgScore = Math.max(0, Math.min(100, Math.round(fgScore)));

  // F&G label
  const fgLabel =
    fgScore >= 80 ? '극도의 탐욕' :
    fgScore >= 65 ? '탐욕' :
    fgScore >= 45 ? '중립' :
    fgScore >= 25 ? '공포' : '극도의 공포';

  // ── 7. Market Condition & Buy Signal ────────────────────────────────────────
  let marketCondition: 'BULL' | 'NEUTRAL' | 'BEAR';
  let buyCondition: 'GO' | 'CAUTION' | 'STOP';
  let conditionDetail: string;

  if (fgScore >= 55 && spyAboveMA50 && (vix === null || vix < 25)) {
    marketCondition = 'BULL';
    buyCondition    = 'GO';
    conditionDetail = '상승장 — 개별 종목 매수 신호에 적극 대응';
  } else if (fgScore <= 30 || (vix !== null && vix > 30) || !spyAboveMA50) {
    marketCondition = 'BEAR';
    buyCondition    = 'STOP';
    conditionDetail = '하락장 — 신규 매수 자제, 기존 포지션 손절 엄수';
  } else {
    marketCondition = 'NEUTRAL';
    buyCondition    = 'CAUTION';
    conditionDetail = '중립 — 최고 점수 종목만 선별적 매수';
  }

  return NextResponse.json({
    vix, vixMA20, vixTrend,
    spyRet1m, qqqRet1m,
    spyAboveMA50,
    putCallProxy,
    marketBreadth,
    fearGreed: { score: fgScore, label: fgLabel },
    marketCondition, buyCondition, conditionDetail,
    analyzed_at: new Date().toISOString(),
  });
}

