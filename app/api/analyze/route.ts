import { NextRequest, NextResponse } from 'next/server';

// ── Math helpers ──────────────────────────────────────────────────────────────
function calcEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  let prev = data[0];
  for (const d of data) { prev = d * k + prev * (1 - k); result.push(prev); }
  return result;
}

function calcMA(closes: number[], period: number): number {
  const sl = closes.slice(-period);
  return sl.length < period ? NaN : sl.reduce((a, b) => a + b, 0) / period;
}

function calcRSI(closes: number[], period = 14): number {
  const changes = closes.slice(1).map((c, i) => c - closes[i]);
  const gains   = changes.map(c => c > 0 ? c : 0);
  const losses  = changes.map(c => c < 0 ? -c : 0);
  let ag = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let al = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < changes.length; i++) {
    ag = (ag * (period - 1) + gains[i]) / period;
    al = (al * (period - 1) + losses[i]) / period;
  }
  return al === 0 ? 100 : Math.round((100 - 100 / (1 + ag / al)) * 10) / 10;
}

function calcMACD(closes: number[]): { histogram: number } {
  const e12  = calcEMA(closes, 12);
  const e26  = calcEMA(closes, 26);
  const line = e12.map((v, i) => v - e26[i]);
  const sig  = calcEMA(line.slice(-60), 9);
  return { histogram: Math.round((line[line.length-1] - sig[sig.length-1]) * 1000) / 1000 };
}

function calcBB(closes: number[], period = 20): { position: number } {
  const sl  = closes.slice(-period);
  const mid = sl.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(sl.reduce((a, b) => a + (b - mid) ** 2, 0) / period);
  const upper = mid + 2 * std, lower = mid - 2 * std;
  const pos = upper !== lower ? ((closes[closes.length-1] - lower) / (upper - lower)) * 100 : 50;
  return { position: Math.round(pos) };
}

function calcATR(highs: number[], lows: number[], closes: number[], period = 14): number {
  const trs: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    trs.push(Math.max(highs[i]-lows[i], Math.abs(highs[i]-closes[i-1]), Math.abs(lows[i]-closes[i-1])));
  }
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calcVolumeRatio(volumes: number[], period = 20): number {
  const recent = volumes[volumes.length-1];
  const avg    = volumes.slice(-period-1, -1).reduce((a, b) => a + b, 0) / period;
  return avg > 0 ? Math.round((recent / avg) * 100) / 100 : 1;
}

// ── MA alignment score ────────────────────────────────────────────────────────
// Returns how many MAs price is above (0~5), and stacked order score
function calcMAAlignment(price: number, mas: Record<string, number>): {
  aboveCount: number; stackedBull: boolean; stackedBear: boolean;
  nearestSupport: number | null; nearest: string | null;
} {
  const periods = [10, 20, 30, 50, 120] as const;
  let aboveCount = 0;
  let nearestSupport: number | null = null;
  let nearest: string | null = null;
  let minDist = Infinity;

  for (const p of periods) {
    const ma = mas[`ma${p}`];
    if (isNaN(ma)) continue;
    if (price > ma) aboveCount++;

    // Find nearest support below price
    if (price > ma) {
      const dist = price - ma;
      if (dist < minDist) { minDist = dist; nearestSupport = ma; nearest = `MA${p}`; }
    }
  }

  // Stacked bullish: MA10 > MA20 > MA30 > MA50 > MA120
  const v = periods.map(p => mas[`ma${p}`]).filter(v => !isNaN(v));
  const stackedBull = v.length >= 3 && v.every((val, i) => i === 0 || val < v[i-1]);
  const stackedBear = v.length >= 3 && v.every((val, i) => i === 0 || val > v[i-1]);

  return { aboveCount, stackedBull, stackedBear, nearestSupport, nearest };
}

// ── Precise entry zone calculation ───────────────────────────────────────────
function calcEntryZone(
  price: number,
  mas: Record<string, number>,
  atrAbs: number,
  signal: string,
  distFromHigh: number
): { entry: string | null; stopLoss: string } {
  const r = (n: number) => Math.round(n * 100) / 100;

  if (!signal.includes('BUY')) {
    return { entry: null, stopLoss: r(price - 2 * atrAbs).toString() };
  }

  // Strategy 1: Near a clean MA support (within 1 ATR)
  const periods = [10, 20, 30, 50, 120] as const;
  for (const p of periods) {
    const ma = mas[`ma${p}`];
    if (isNaN(ma)) continue;
    if (price > ma && price - ma < atrAbs * 1.2) {
      // Price is sitting just above this MA — ideal entry
      const entryLow  = r(ma * 1.001);         // just above MA
      const entryHigh = r(ma + atrAbs * 0.5);  // up to 0.5 ATR above MA
      const stop      = r(ma - atrAbs * 0.5);  // below MA
      return { entry: `$${entryLow}–$${entryHigh} (MA${p} 지지)`, stopLoss: `$${stop}` };
    }
  }

  // Strategy 2: Breakout — price near 52w high
  if (distFromHigh > -3) {
    const entryLow  = r(price * 0.998);
    const entryHigh = r(price * 1.01);
    const stop      = r(price - 2 * atrAbs);
    return { entry: `$${entryLow}–$${entryHigh} (돌파 추격)`, stopLoss: `$${stop}` };
  }

  // Strategy 3: Pullback to nearest MA
  const nearestMA = periods.map(p => ({ p, ma: mas[`ma${p}`] }))
    .filter(x => !isNaN(x.ma) && price > x.ma)
    .sort((a, b) => (price - a.ma) - (price - b.ma))[0];

  if (nearestMA) {
    const pullbackTarget = r((price + nearestMA.ma) / 2); // midpoint current–MA
    const entryLow  = r(nearestMA.ma * 1.002);
    const entryHigh = r(pullbackTarget);
    const stop      = r(nearestMA.ma - atrAbs * 0.5);
    return { entry: `$${entryLow}–$${entryHigh} (눌림목)`, stopLoss: `$${stop}` };
  }

  // Fallback
  return {
    entry: `$${r(price * 0.99)}–$${r(price * 1.005)}`,
    stopLoss: `$${r(price - 2 * atrAbs)}`,
  };
}

// ── Yahoo Finance fetch ───────────────────────────────────────────────────────
interface QuoteData {
  ticker: string; price: number; change1d: number; ytdReturn: number;
  ma10: number; ma20: number; ma30: number; ma50: number; ma120: number; ma200: number;
  high52w: number; low52w: number; distFromHigh: number; momentum3m: number;
  rsi: number; macdHistogram: number; bbPosition: number; atrPct: number;
  atrAbs: number; volumeRatio: number;
}

async function fetchQuote(ticker: string): Promise<QuoteData | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1y`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 0 } }
    );
    if (!res.ok) return null;
    const data   = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const q          = result.indicators?.quote?.[0] ?? {};
    const timestamps = result.timestamp ?? [];
    const closes:  number[] = q.close  ?? [];
    const highs:   number[] = q.high   ?? [];
    const lows:    number[] = q.low    ?? [];
    const volumes: number[] = q.volume ?? [];

    const valid = closes.map((c: number, i: number) => ({
      c, h: highs[i] ?? c, l: lows[i] ?? c, v: volumes[i] ?? 0, t: timestamps[i] ?? 0,
    })).filter(x => x.c != null && !isNaN(x.c));

    if (valid.length < 30) return null;

    const cs = valid.map(x => x.c);
    const hs = valid.map(x => x.h);
    const ls = valid.map(x => x.l);
    const vs = valid.map(x => x.v);

    const price    = cs[cs.length - 1];
    const change1d = ((price - cs[cs.length - 2]) / cs[cs.length - 2]) * 100;

    // YTD
    const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime() / 1000;
    const ytdIdx    = valid.findIndex(x => x.t >= yearStart);
    const ytdBase   = cs[ytdIdx >= 0 ? ytdIdx : 0];
    const ytdReturn = ((price - ytdBase) / ytdBase) * 100;

    // 3M
    const q3 = cs[Math.max(0, cs.length - 63)];
    const momentum3m = ((price - q3) / q3) * 100;

    // All MAs
    const ma10  = calcMA(cs, 10);
    const ma20  = calcMA(cs, 20);
    const ma30  = calcMA(cs, 30);
    const ma50  = calcMA(cs, 50);
    const ma120 = calcMA(cs, 120);
    const ma200 = calcMA(cs, 200);

    const high52w = Math.max(...cs);
    const low52w  = Math.min(...cs);
    const distFromHigh = ((price - high52w) / high52w) * 100;

    const rsi         = calcRSI(cs.slice(-30));
    const { histogram } = calcMACD(cs);
    const { position }  = calcBB(cs);
    const atrVal      = calcATR(hs.slice(-20), ls.slice(-20), cs.slice(-20));
    const volRatio    = calcVolumeRatio(vs);

    const r = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

    return {
      ticker, price: r(price), change1d: r(change1d, 1),
      ytdReturn: r(ytdReturn, 1), momentum3m: r(momentum3m, 1),
      ma10: r(ma10), ma20: r(ma20), ma30: r(ma30),
      ma50: r(ma50), ma120: r(ma120), ma200: r(ma200),
      high52w: r(high52w), low52w: r(low52w),
      distFromHigh: r(distFromHigh, 1),
      rsi: r(rsi, 1), macdHistogram: r(histogram, 4),
      bbPosition: Math.round(position),
      atrPct: r((atrVal / price) * 100, 2),
      atrAbs: r(atrVal, 2),
      volumeRatio: r(volRatio, 2),
    };
  } catch { return null; }
}

// ── 5-level analysis ──────────────────────────────────────────────────────────
function analyzeStock(q: QuoteData, spyYtd: number, sectorAvgYtd: number) {
  const excessIdx    = q.ytdReturn - spyYtd;
  const excessSector = q.ytdReturn - sectorAvgYtd;

  const rsIndex  = excessIdx    >  5 ? 'STRONG' : excessIdx    < -5 ? 'WEAK' : 'NEUTRAL';
  const rsSector = excessSector >  3 ? 'STRONG' : excessSector < -3 ? 'WEAK' : 'NEUTRAL';

  const mas = { ma10: q.ma10, ma20: q.ma20, ma30: q.ma30, ma50: q.ma50, ma120: q.ma120 };
  const { aboveCount, stackedBull, stackedBear, nearestSupport, nearest } = calcMAAlignment(q.price, mas);

  // MA50 status (kept for display)
  const ma50Status = q.price > q.ma50 * 1.01 ? 'ABOVE' : q.price < q.ma50 * 0.99 ? 'BELOW' : 'AT';

  // Pattern
  let pattern: string;
  if      (q.distFromHigh > -5  && aboveCount >= 4 && stackedBull) pattern = 'BREAKOUT';
  else if (q.distFromHigh >= -15 && aboveCount >= 3)               pattern = 'CUP';
  else if (q.distFromHigh >= -20 && aboveCount >= 2 && q.momentum3m > 0) pattern = 'W_BASE';
  else if (aboveCount <= 1 && q.momentum3m < -10)                  pattern = 'DOWNTREND';
  else                                                              pattern = 'NONE';

  // ── Score (1–10) ──────────────────────────────────────────────────────────
  let score = 5;

  // MA alignment (0~5 MAs above) — strongest factor
  score += (aboveCount - 2.5) * 0.5;           // -1.25 ~ +1.25
  if (stackedBull) score += 0.5;
  if (stackedBear) score -= 0.5;

  // RS signals
  if (rsIndex  === 'STRONG') score += 1.0; else if (rsIndex  === 'WEAK') score -= 1.0;
  if (rsSector === 'STRONG') score += 1.0; else if (rsSector === 'WEAK') score -= 1.0;

  // RSI
  if (q.rsi >= 45 && q.rsi <= 70) score += 0.5;
  else if (q.rsi > 80) score -= 0.5;
  else if (q.rsi < 30) score -= 0.5;

  // MACD
  if (q.macdHistogram > 0) score += 0.5; else score -= 0.5;

  // Volume
  if (q.volumeRatio > 1.5) score += 0.5;
  else if (q.volumeRatio < 0.7) score -= 0.3;

  // Bollinger Band
  if (q.bbPosition >= 40 && q.bbPosition <= 80) score += 0.3;
  else if (q.bbPosition > 95) score -= 0.5;
  else if (q.bbPosition < 10) score -= 0.3;

  // 52w high proximity
  if (q.distFromHigh > -8) score += 0.5;

  score = Math.max(1, Math.min(10, Math.round(score * 2) / 2));

  // ── 5-level signal ────────────────────────────────────────────────────────
  let signal: string;
  const macdBull = q.macdHistogram > 0;
  const macdBear = q.macdHistogram < 0;
  const rsiOk    = q.rsi >= 45 && q.rsi <= 75;
  const volStrong = q.volumeRatio > 1.5;

  if (score >= 8.5 && aboveCount >= 4 && stackedBull && macdBull && rsiOk && volStrong) {
    signal = 'STRONG_BUY';
  } else if (score >= 7 && aboveCount >= 3 && rsIndex !== 'WEAK') {
    signal = 'BUY';
  } else if (score <= 2 || (aboveCount === 0 && macdBear && rsIndex === 'WEAK')) {
    signal = 'STRONG_SELL';
  } else if (score <= 4 || (aboveCount <= 1 && rsIndex === 'WEAK')) {
    signal = 'SELL';
  } else {
    signal = 'HOLD';
  }

  const confidence = score >= 9 || score <= 2 ? 'HIGH' : score >= 7 || score <= 4 ? 'MEDIUM' : 'LOW';

  // ── Precise entry / stop ──────────────────────────────────────────────────
  const { entry, stopLoss } = calcEntryZone(q.price, mas, q.atrAbs, signal, q.distFromHigh);

  // Support = nearest MA below price, Resistance = 52w high
  const support    = nearestSupport ? `$${Math.round(nearestSupport * 100) / 100} (${nearest})` : `$${q.ma50}`;
  const resistance = `$${q.high52w}`;

  // ── Summary ───────────────────────────────────────────────────────────────
  const maStatus = `MA10/20/30/50/120 중 ${aboveCount}개 위`
    + (stackedBull ? ' (정배열)' : stackedBear ? ' (역배열)' : '');
  const signalWord = { STRONG_BUY: '즉시매수', BUY: '매수', HOLD: '관망', SELL: '매도', STRONG_SELL: '즉시매도' }[signal] ?? signal;

  const summary = `${q.ticker} [${signalWord}] YTD ${q.ytdReturn > 0 ? '+' : ''}${q.ytdReturn}% (S&P500 대비 ${excessIdx > 0 ? '+' : ''}${Math.round(excessIdx * 10) / 10}%). `
    + `${maStatus}. RSI ${q.rsi} · MACD ${macdBull ? '상승' : '하락'} · BB ${q.bbPosition}% · 거래량 ${q.volumeRatio}x.`;

  const cautions: string[] = [];
  if (q.rsi > 78) cautions.push(`RSI ${q.rsi} 과열`);
  if (q.bbPosition > 90) cautions.push('BB 상단 근접');
  if (q.distFromHigh > -3 && signal.includes('BUY')) cautions.push('52주 고점 근접 — 눌림목 대기 권장');
  if (aboveCount <= 1 && signal === 'HOLD') cautions.push('MA 다수 아래 — 추세 약화');
  if (q.volumeRatio < 0.6) cautions.push('거래량 부족');

  return {
    ticker: q.ticker, signal, confidence,
    momentum_score: score,
    rs_vs_index: rsIndex, rs_vs_sector: rsSector,
    ma50_status: ma50Status, pattern,
    volume_confirmation: volStrong,
    entry_zone: entry,
    key_support: support,
    key_resistance: resistance,
    stop_loss: stopLoss,
    summary,
    caution: cautions.length > 0 ? cautions.join(' / ') : null,
    rsi: q.rsi, macd_histogram: q.macdHistogram,
    bb_position: q.bbPosition, atr_pct: q.atrPct, volume_ratio: q.volumeRatio,
    // Extended MA data for detail page
    ma10: q.ma10, ma20: q.ma20, ma30: q.ma30, ma50: q.ma50, ma120: q.ma120,
    above_ma_count: aboveCount, stacked_bull: stackedBull, stacked_bear: stackedBear,
  };
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let tickers: string[];
  try {
    const body = await req.json();
    tickers = body.tickers;
    if (!Array.isArray(tickers) || tickers.length === 0) throw new Error('invalid');
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const [spyQuote, ...stockQuotes] = await Promise.all([
    fetchQuote('SPY'),
    ...tickers.map(fetchQuote),
  ]);

  const validStocks = stockQuotes.filter((q): q is QuoteData => q !== null);
  if (validStocks.length === 0) {
    return NextResponse.json({ error: '주가 데이터를 가져올 수 없습니다.' }, { status: 500 });
  }

  const spyYtd       = spyQuote?.ytdReturn ?? 0;
  const sectorAvgYtd = validStocks.reduce((a, s) => a + s.ytdReturn, 0) / validStocks.length;
  const stocks       = validStocks.map(q => analyzeStock(q, spyYtd, sectorAvgYtd));

  const strongBuys = stocks.filter(s => s.signal === 'STRONG_BUY').map(s => s.ticker);
  const buys       = stocks.filter(s => s.signal === 'BUY').map(s => s.ticker);
  const sAvg       = `${sectorAvgYtd > 0 ? '+' : ''}${Math.round(sectorAvgYtd * 10) / 10}%`;
  const spyStr     = `${spyYtd > 0 ? '+' : ''}${Math.round(spyYtd * 10) / 10}%`;

  const market_context =
    `섹터 YTD 평균 ${sAvg} vs S&P500 ${spyStr}. ` +
    (strongBuys.length > 0 ? `즉시매수: ${strongBuys.slice(0,5).join(', ')}. ` : '') +
    (buys.length > 0 ? `매수: ${buys.slice(0,5).join(', ')}.` : '현재 매수 신호 없음.');

  return NextResponse.json({ stocks, market_context, analyzed_at: new Date().toISOString() });
}
