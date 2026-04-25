import { NextRequest, NextResponse } from 'next/server';

interface QuoteData {
  ticker: string;
  price: number;
  change1d: number;
  ytdReturn: number;
  ma50: number;
  ma200: number;
  high52w: number;
  low52w: number;
  aboveMa50: boolean;
  aboveMa200: boolean;
  distFromHigh: number;
  momentum3m: number;
}

async function fetchQuote(ticker: string): Promise<QuoteData | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1y`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 0 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];
    const timestamps: number[] = result.timestamp ?? [];
    const valid = closes.map((c, i) => ({ c, t: timestamps[i] })).filter(x => x.c != null && !isNaN(x.c));
    if (valid.length < 60) return null;

    const price = valid[valid.length - 1].c;
    const prev  = valid[valid.length - 2].c;
    const change1d = ((price - prev) / prev) * 100;

    // YTD
    const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime() / 1000;
    const ytdIdx = valid.findIndex(x => x.t >= yearStart);
    const ytdBase = valid[ytdIdx >= 0 ? ytdIdx : 0].c;
    const ytdReturn = ((price - ytdBase) / ytdBase) * 100;

    // 3-month momentum
    const q3 = valid[Math.max(0, valid.length - 63)].c;
    const momentum3m = ((price - q3) / q3) * 100;

    // MAs
    const cs = valid.map(x => x.c);
    const ma50  = cs.slice(-50).reduce((a, b) => a + b, 0) / 50;
    const ma200 = cs.length >= 200 ? cs.slice(-200).reduce((a, b) => a + b, 0) / 200 : ma50;

    const high52w = Math.max(...cs);
    const low52w  = Math.min(...cs);
    const distFromHigh = ((price - high52w) / high52w) * 100;

    return {
      ticker,
      price:        Math.round(price * 100) / 100,
      change1d:     Math.round(change1d * 10) / 10,
      ytdReturn:    Math.round(ytdReturn * 10) / 10,
      ma50:         Math.round(ma50 * 100) / 100,
      ma200:        Math.round(ma200 * 100) / 100,
      high52w:      Math.round(high52w * 100) / 100,
      low52w:       Math.round(low52w * 100) / 100,
      aboveMa50:    price > ma50,
      aboveMa200:   price > ma200,
      distFromHigh: Math.round(distFromHigh * 10) / 10,
      momentum3m:   Math.round(momentum3m * 10) / 10,
    };
  } catch { return null; }
}

function analyzeStock(q: QuoteData, spyYtd: number, sectorAvgYtd: number) {
  const excessVsSpy    = q.ytdReturn - spyYtd;
  const excessVsSector = q.ytdReturn - sectorAvgYtd;

  // Relative strength
  const rsIndex  = excessVsSpy > 5 ? 'STRONG' : excessVsSpy < -5 ? 'WEAK' : 'NEUTRAL';
  const rsSector = excessVsSector > 3 ? 'STRONG' : excessVsSector < -3 ? 'WEAK' : 'NEUTRAL';

  // MA status
  const ma50Status = q.price > q.ma50 * 1.01 ? 'ABOVE' : q.price < q.ma50 * 0.99 ? 'BELOW' : 'AT';

  // Pattern detection
  let pattern: string;
  if (q.distFromHigh > -5 && q.aboveMa50 && q.aboveMa200) pattern = 'BREAKOUT';
  else if (q.distFromHigh >= -15 && q.distFromHigh < -5 && q.aboveMa50) pattern = 'CUP';
  else if (q.distFromHigh >= -20 && q.aboveMa50 && q.momentum3m > 0) pattern = 'W_BASE';
  else if (!q.aboveMa50 && q.momentum3m < -10) pattern = 'DOWNTREND';
  else pattern = 'NONE';

  // Momentum score (1-10)
  let score = 5;
  if (q.aboveMa50) score += 1;
  if (q.aboveMa200) score += 1;
  if (rsIndex === 'STRONG') score += 1; else if (rsIndex === 'WEAK') score -= 1;
  if (rsSector === 'STRONG') score += 1; else if (rsSector === 'WEAK') score -= 1;
  if (q.momentum3m > 20) score += 1; else if (q.momentum3m < -10) score -= 1;
  if (q.distFromHigh > -10) score += 0.5;
  score = Math.max(1, Math.min(10, Math.round(score)));

  // Signal
  let signal: string, confidence: string;
  if (score >= 7 && q.aboveMa50 && rsIndex !== 'WEAK') {
    signal = 'BUY';
    confidence = score >= 9 ? 'HIGH' : 'MEDIUM';
  } else if (score <= 4 || (!q.aboveMa50 && rsIndex === 'WEAK')) {
    signal = 'SELL';
    confidence = score <= 2 ? 'HIGH' : 'MEDIUM';
  } else {
    signal = 'HOLD';
    confidence = 'MEDIUM';
  }

  // Price levels
  const entryLow  = Math.round(q.price * 0.99 * 100) / 100;
  const entryHigh = Math.round(q.price * 1.02 * 100) / 100;
  const stopLoss  = Math.round(q.ma50 * 0.97 * 100) / 100;
  const support   = Math.round(q.ma50 * 100) / 100;
  const resistance = Math.round(q.high52w * 100) / 100;

  // Korean summary
  const maWord   = q.aboveMa50 ? '50일선 위' : '50일선 아래';
  const rsWord   = rsIndex === 'STRONG' ? 'S&P500 대비 강세' : rsIndex === 'WEAK' ? 'S&P500 대비 약세' : 'S&P500 대비 중립';
  const ytdWord  = `YTD ${q.ytdReturn > 0 ? '+' : ''}${q.ytdReturn}%`;
  const summary  = `${q.ticker}는 ${ytdWord} 수익률로 ${rsWord}이며, 현재 ${maWord} (MA50: $${q.ma50})에서 거래 중입니다. 3개월 모멘텀 ${q.momentum3m > 0 ? '+' : ''}${q.momentum3m}%, 52주 고점 대비 ${q.distFromHigh}% 위치에 있습니다.`;

  let caution: string | null = null;
  if (q.distFromHigh > -3 && signal === 'BUY') caution = '52주 고점 근접 — 추격 매수보다 눌림목 대기 권장';
  if (!q.aboveMa50 && signal === 'HOLD') caution = '50일선 아래 거래 중 — 50일선 회복 확인 후 진입 권장';

  return {
    ticker: q.ticker,
    signal,
    confidence,
    momentum_score: score,
    rs_vs_index:  rsIndex,
    rs_vs_sector: rsSector,
    ma50_status:  ma50Status,
    pattern,
    volume_confirmation: q.aboveMa50 && q.momentum3m > 0,
    entry_zone:   signal === 'BUY' ? `$${entryLow}-$${entryHigh}` : null,
    key_support:  `$${support}`,
    key_resistance: `$${resistance}`,
    stop_loss:    signal === 'BUY' ? `$${stopLoss}` : null,
    summary,
    caution,
  };
}

export async function POST(req: NextRequest) {
  let tickers: string[];
  try {
    const body = await req.json();
    tickers = body.tickers;
    if (!Array.isArray(tickers) || tickers.length === 0) throw new Error('invalid');
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Fetch all quotes in parallel (including SPY for benchmark)
  const [spyQuote, ...stockQuotes] = await Promise.all([
    fetchQuote('SPY'),
    ...tickers.map(fetchQuote),
  ]);

  const validStocks = stockQuotes.filter((q): q is QuoteData => q !== null);
  if (validStocks.length === 0) {
    return NextResponse.json({ error: '주가 데이터를 가져올 수 없습니다. 잠시 후 다시 시도해주세요.' }, { status: 500 });
  }

  const spyYtd = spyQuote?.ytdReturn ?? 0;
  const sectorAvgYtd = validStocks.reduce((a, s) => a + s.ytdReturn, 0) / validStocks.length;

  const stocks = validStocks.map(q => analyzeStock(q, spyYtd, sectorAvgYtd));

  // Top 3 buys for market context
  const buys = stocks.filter(s => s.signal === 'BUY').sort((a, b) => b.momentum_score - a.momentum_score);
  const topTickers = buys.slice(0, 3).map(s => s.ticker).join(', ');
  const sectorAvgStr = `${sectorAvgYtd > 0 ? '+' : ''}${Math.round(sectorAvgYtd * 10) / 10}%`;

  const market_context = `반도체 섹터 평균 YTD 수익률 ${sectorAvgStr} (S&P500 YTD ${spyYtd > 0 ? '+' : ''}${Math.round(spyYtd * 10) / 10}%). ` +
    `${buys.length > 0 ? `모멘텀 상위 종목: ${topTickers}.` : '현재 매수 신호 종목 없음 — 시장 관망 구간.'} ` +
    `분석 기준: Yahoo Finance 실시간 데이터 기반 규칙 알고리즘.`;

  return NextResponse.json({
    stocks,
    market_context,
    analyzed_at: new Date().toISOString(),
  });
}
