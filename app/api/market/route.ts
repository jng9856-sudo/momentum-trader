import { NextResponse } from 'next/server';

async function fetchYahoo(ticker: string, range = '3mo') {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=${range}`,
    { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 3600 } }
  );
  if (!res.ok) return null;
  const d = await res.json();
  const closes: number[] = (d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [])
    .filter((c: number) => c != null && !isNaN(c));
  return closes.length > 0 ? closes : null;
}

function calcMA(arr: number[], n: number) {
  if (arr.length < n) return arr[arr.length - 1] ?? 0;
  return arr.slice(-n).reduce((a, b) => a + b, 0) / n;
}

function calcEMA(arr: number[], n: number) {
  if (!arr || arr.length === 0) return 0;
  const k = 2 / (n + 1);
  let ema = arr[0];
  for (let i = 1; i < arr.length; i++) ema = arr[i] * k + ema * (1 - k);
  return ema;
}

const r = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

// ETF 목록 (ticker, 한글 레이블)
const ETF_LIST = [
  { ticker: 'SPY',  label: 'S&P 500' },
  { ticker: 'QQQ',  label: 'Nasdaq 100' },
  { ticker: 'DIA',  label: 'Dow Jones' },
  { ticker: 'IWM',  label: 'Russell 2000' },
  { ticker: 'GLD',  label: 'Gold' },
  { ticker: 'VIXY', label: 'VIX ETF' },
  { ticker: 'TBF',  label: '장기채 인버스' },
  { ticker: 'RSP',  label: 'S&P 동일가중' },
];

function processEtf(ticker: string, label: string, closes: number[] | null) {
  if (!closes || closes.length < 2) return null;
  const last     = closes[closes.length - 1];
  const prev     = closes[closes.length - 2];
  const todayPct = ((last - prev) / prev) * 100;
  const ema10    = closes.length >= 10 ? calcEMA(closes, 10) : last;
  const ema20    = closes.length >= 20 ? calcEMA(closes, 20) : last;

  let trend: string;
  if      (last > ema10 && ema10 > ema20)  trend = 'strong_up';
  else if (last < ema10 * 0.95)            trend = 'major_down';
  else if (last > ema20)                   trend = 'decent_up';
  else                                     trend = 'down';

  return {
    ticker,
    label,
    closes:   closes.slice(-60),
    last:     r(last),
    todayPct: r(todayPct),
    ema10:    r(ema10),
    ema20:    r(ema20),
    trend,
  };
}

export async function GET() {
  // ── 모든 ETF 병렬 fetch ──────────────────────────────────────────────────
  const [
    vixCloses,
    spyCloses,
    qqqCloses,
    diaCloses,
    iwmCloses,
    gldCloses,
    vixyCloses,
    tbfCloses,
    rspCloses,
  ] = await Promise.all([
    fetchYahoo('^VIX', '1mo'),
    fetchYahoo('SPY',  '3mo'),
    fetchYahoo('QQQ',  '3mo'),
    fetchYahoo('DIA',  '3mo'),
    fetchYahoo('IWM',  '3mo'),
    fetchYahoo('GLD',  '3mo'),
    fetchYahoo('VIXY', '3mo'),
    fetchYahoo('TBF',  '3mo'),
    fetchYahoo('RSP',  '3mo'),
  ]);

  // ── 1. VIX ──────────────────────────────────────────────────────────────
  const vix    = vixCloses ? r(vixCloses[vixCloses.length - 1], 1) : null;
  const vixMA20 = vixCloses && vixCloses.length >= 20 ? r(calcMA(vixCloses, 20), 1) : null;
  const vixTrend = vix && vixMA20
    ? (vix > vixMA20 * 1.05 ? 'RISING' : vix < vixMA20 * 0.95 ? 'FALLING' : 'FLAT')
    : null;

  // ── 2. SPY Momentum ─────────────────────────────────────────────────────
  let spyMomentum = 0, spyAboveMA50 = false, spyRet1m = 0;
  if (spyCloses && spyCloses.length >= 50) {
    const price   = spyCloses[spyCloses.length - 1];
    const ma50    = calcMA(spyCloses, 50);
    const month1  = spyCloses[Math.max(0, spyCloses.length - 21)];
    spyAboveMA50  = price > ma50;
    spyRet1m      = r(((price - month1) / month1) * 100, 1);
    spyMomentum   = spyRet1m;
  }

  // ── 3. QQQ Momentum ─────────────────────────────────────────────────────
  let qqqRet1m = 0;
  if (qqqCloses && qqqCloses.length >= 21) {
    const price  = qqqCloses[qqqCloses.length - 1];
    const month1 = qqqCloses[Math.max(0, qqqCloses.length - 21)];
    qqqRet1m = r(((price - month1) / month1) * 100, 1);
  }

  // ── 4. Put/Call Proxy ────────────────────────────────────────────────────
  const putCallProxy = vix ? r(vix / 20, 2) : null;

  // ── 5. Market Breadth (IWM) ──────────────────────────────────────────────
  let marketBreadth = 0;
  if (iwmCloses && iwmCloses.length >= 50) {
    const price   = iwmCloses[iwmCloses.length - 1];
    const high13w = Math.max(...iwmCloses);
    marketBreadth = r(((price - high13w) / high13w) * 100, 1);
  }

  // ── 6. Fear & Greed Score ────────────────────────────────────────────────
  let fgScore = 50;
  if (vix !== null) {
    if      (vix < 12) fgScore += 20;
    else if (vix < 16) fgScore += 15;
    else if (vix < 20) fgScore += 5;
    else if (vix < 25) fgScore -= 5;
    else if (vix < 30) fgScore -= 15;
    else if (vix < 40) fgScore -= 20;
    else               fgScore -= 25;
  }
  if      (spyMomentum >  5) fgScore += 15;
  else if (spyMomentum >  2) fgScore += 8;
  else if (spyMomentum >  0) fgScore += 3;
  else if (spyMomentum > -2) fgScore -= 3;
  else if (spyMomentum > -5) fgScore -= 8;
  else                       fgScore -= 15;
  if (spyAboveMA50) fgScore += 10; else fgScore -= 10;
  if      (marketBreadth >  -5)  fgScore += 5;
  else if (marketBreadth > -10)  fgScore += 0;
  else if (marketBreadth > -15)  fgScore -= 5;
  else                           fgScore -= 10;
  fgScore = Math.max(0, Math.min(100, Math.round(fgScore)));

  const fgLabel =
    fgScore >= 80 ? '극도의 탐욕' :
    fgScore >= 65 ? '탐욕' :
    fgScore >= 45 ? '중립' :
    fgScore >= 25 ? '공포' : '극도의 공포';

  // ── 7. Market Condition ──────────────────────────────────────────────────
  let marketCondition: 'BULL' | 'NEUTRAL' | 'BEAR';
  let buyCondition:    'GO' | 'CAUTION' | 'STOP';
  let conditionDetail: string;

  if (fgScore >= 55 && spyAboveMA50 && (vix === null || vix < 25)) {
    marketCondition = 'BULL';  buyCondition = 'GO';
    conditionDetail = '상승장 — 개별 종목 매수 신호에 적극 대응';
  } else if (fgScore <= 30 || (vix !== null && vix > 30) || !spyAboveMA50) {
    marketCondition = 'BEAR';  buyCondition = 'STOP';
    conditionDetail = '하락장 — 신규 매수 자제, 기존 포지션 손절 엄수';
  } else {
    marketCondition = 'NEUTRAL'; buyCondition = 'CAUTION';
    conditionDetail = '중립 — 최고 점수 종목만 선별적 매수';
  }

  // ── 8. ETF 헬스 그리드 데이터 ────────────────────────────────────────────
  const etfRaw = [
    { ticker: 'SPY',  label: 'S&P 500',       closes: spyCloses },
    { ticker: 'QQQ',  label: 'Nasdaq 100',     closes: qqqCloses },
    { ticker: 'DIA',  label: 'Dow Jones',      closes: diaCloses },
    { ticker: 'IWM',  label: 'Russell 2000',   closes: iwmCloses },
    { ticker: 'GLD',  label: 'Gold',           closes: gldCloses },
    { ticker: 'VIXY', label: 'VIX ETF',        closes: vixyCloses },
    { ticker: 'TBF',  label: '장기채 인버스',  closes: tbfCloses },
    { ticker: 'RSP',  label: 'S&P 동일가중',   closes: rspCloses },
  ];

  const etfData = etfRaw
    .map(e => processEtf(e.ticker, e.label, e.closes))
    .filter(Boolean);

  return NextResponse.json({
    vix, vixMA20, vixTrend,
    spyRet1m, qqqRet1m,
    spyAboveMA50,
    putCallProxy,
    marketBreadth,
    fearGreed: { score: fgScore, label: fgLabel },
    marketCondition, buyCondition, conditionDetail,
    etfData,
    analyzed_at: new Date().toISOString(),
  });
}
