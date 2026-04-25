import { NextRequest, NextResponse } from 'next/server';

function calcMA(closes: number[], period: number): number {
  const sl = closes.slice(-period);
  return sl.length < period ? NaN : sl.reduce((a, b) => a + b, 0) / period;
}
function calcEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1); let prev = data[0];
  return data.map(d => { prev = d * k + prev * (1 - k); return prev; });
}
function calcRSI(closes: number[], period = 14): number {
  const ch = closes.slice(1).map((c, i) => c - closes[i]);
  const gains = ch.map(c => c > 0 ? c : 0), losses = ch.map(c => c < 0 ? -c : 0);
  let ag = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let al = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < ch.length; i++) {
    ag = (ag * (period-1) + gains[i]) / period;
    al = (al * (period-1) + losses[i]) / period;
  }
  return al === 0 ? 100 : Math.round((100 - 100 / (1 + ag/al)) * 10) / 10;
}
function calcMACDHist(closes: number[]): number {
  const e12 = calcEMA(closes, 12), e26 = calcEMA(closes, 26);
  const line = e12.map((v, i) => v - e26[i]);
  const sig  = calcEMA(line.slice(-60), 9);
  return Math.round((line[line.length-1] - sig[sig.length-1]) * 1000) / 1000;
}
function calcATR(hs: number[], ls: number[], cs: number[], period = 14): number {
  const trs: number[] = [];
  for (let i = 1; i < hs.length; i++)
    trs.push(Math.max(hs[i]-ls[i], Math.abs(hs[i]-cs[i-1]), Math.abs(ls[i]-cs[i-1])));
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

async function fetchData(ticker: string) {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1y`,
    { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 0 } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) return null;
  const q = result.indicators?.quote?.[0] ?? {};
  const cs: number[] = (q.close  ?? []).filter((c: number) => c != null && !isNaN(c));
  const hs: number[] = (q.high   ?? []).filter((h: number) => h != null && !isNaN(h));
  const ls: number[] = (q.low    ?? []).filter((l: number) => l != null && !isNaN(l));
  const vs: number[] = (q.volume ?? []).filter((v: number) => v != null && !isNaN(v));
  if (cs.length < 30) return null;
  const price = cs[cs.length-1];
  const ma10 = calcMA(cs,10), ma20 = calcMA(cs,20), ma50 = calcMA(cs,50), ma120 = calcMA(cs,120);
  const rsi = calcRSI(cs.slice(-30)), macd = calcMACDHist(cs);
  const atr = calcATR(hs.slice(-20), ls.slice(-20), cs.slice(-20));
  const high52w = Math.max(...cs);
  const volAvg = vs.slice(-21,-1).reduce((a,b)=>a+b,0)/20;
  const volRatio = volAvg > 0 ? Math.round((vs[vs.length-1]/volAvg)*100)/100 : 1;
  return { price, ma10, ma20, ma50, ma120, rsi, macd, atr, high52w, volRatio };
}

export async function POST(req: NextRequest) {
  let holdings: { ticker: string; avgPrice: number; shares: number }[];
  try {
    const body = await req.json();
    holdings = body.holdings;
    if (!Array.isArray(holdings) || holdings.length === 0) throw new Error('invalid');
  } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }

  const results = await Promise.all(holdings.map(async (h) => {
    const d = await fetchData(h.ticker);
    if (!d) return { ticker: h.ticker, error: '데이터 없음' };
    const r = (n: number, dec = 2) => Math.round(n * 10**dec) / 10**dec;
    const { price, ma10, ma20, ma50, ma120, rsi, macd, atr, high52w, volRatio } = d;
    const avgPrice = h.avgPrice, shares = h.shares ?? 0;
    const pnlPct = r(((price - avgPrice) / avgPrice) * 100, 2);
    const pnlAbs = r((price - avgPrice) * shares, 2);
    const mas = [ma10, ma20, ma50, ma120].filter(m => !isNaN(m));
    const aboveCount = mas.filter(m => price > m).length;

    const stopMA20 = !isNaN(ma20) ? r(ma20 * 0.99) : null;
    const stopMA50 = !isNaN(ma50) ? r(ma50 * 0.98) : null;
    const stopATR  = r(price - 2.0 * atr);

    const target1 = r(avgPrice * 1.10);
    const target2 = r(avgPrice * 1.20);
    const target3 = r(Math.min(high52w * 1.05, avgPrice * 1.35));

    const sellSignals: string[] = [];
    const holdSignals: string[] = [];

    if (rsi > 78) sellSignals.push(`RSI ${rsi} 과열 — 단기 조정 경계`);
    if (macd < 0) sellSignals.push('MACD 하락 전환 — 모멘텀 약화');
    if (price < ma20) sellSignals.push('MA20 이탈 — 단기 추세 붕괴');
    if (price < ma50) sellSignals.push('MA50 이탈 — 중기 추세 붕괴');
    if (price < ma120) sellSignals.push('MA120 이탈 — 장기 추세 붕괴');
    if (aboveCount <= 1) sellSignals.push(`MA ${aboveCount}/4개만 위 — 추세 급격히 약화`);
    if (pnlPct > 30 && rsi > 72) sellSignals.push('수익률 30%↑ + 과열 — 부분 익절 고려');

    if (rsi >= 45 && rsi <= 70) holdSignals.push(`RSI ${rsi} 건전한 강세 구간`);
    if (macd > 0) holdSignals.push('MACD 상승 — 모멘텀 유지');
    if (aboveCount >= 3) holdSignals.push(`MA ${aboveCount}/4개 위 — 추세 양호`);

    let sellUrgency = sellSignals.length >= 3 || price < ma50 ? 'HIGH' : sellSignals.length >= 2 ? 'MEDIUM' : 'LOW';
    let action = price < ma50 && macd < 0 && aboveCount <= 1 ? '즉시매도'
      : sellSignals.length >= 3 ? '매도'
      : pnlPct > 20 && rsi > 72 ? '부분익절'
      : sellSignals.length >= 1 && holdSignals.length <= 1 ? '매도검토'
      : holdSignals.length >= 2 ? '홀딩' : '모니터링';

    const recommendedStop = !isNaN(ma20) && price > ma20
      ? { price: stopMA20, label: 'MA20 기준 손절' }
      : !isNaN(ma50) && price > ma50
        ? { price: stopMA50, label: 'MA50 기준 손절' }
        : { price: stopATR, label: 'ATR 2x 손절' };

    return {
      ticker: h.ticker, avgPrice, shares, currentPrice: r(price),
      pnlPct, pnlAbs, action, sellUrgency, sellSignals, holdSignals,
      stopLoss: { tight: r(price - 1.5*atr), standard: stopATR, ma20: stopMA20, ma50: stopMA50, recommended: recommendedStop },
      targets: { t1: target1, t2: target2, t3: target3 },
      indicators: { rsi, macd, volRatio, aboveCount },
      mas: { ma10: r(ma10), ma20: r(ma20), ma50: r(ma50), ma120: r(ma120) },
    };
  }));

  return NextResponse.json({ holdings: results, analyzed_at: new Date().toISOString() });
}
