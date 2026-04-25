import { NextRequest, NextResponse } from 'next/server';

// ── Math helpers ─────────────────────────────────────────────────────────────
function calcEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  let prev = data[0];
  for (const d of data) { prev = d * k + prev * (1 - k); result.push(prev); }
  return result;
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

function calcMACD(closes: number[]): { macd: number; signal: number; histogram: number } {
  const e12   = calcEMA(closes, 12);
  const e26   = calcEMA(closes, 26);
  const line  = e12.map((v, i) => v - e26[i]);
  const sig   = calcEMA(line.slice(-60), 9);
  const m     = line[line.length - 1];
  const s     = sig[sig.length - 1];
  return { macd: m, signal: s, histogram: Math.round((m - s) * 1000) / 1000 };
}

function calcBB(closes: number[], period = 20): { upper: number; lower: number; position: number } {
  const sl  = closes.slice(-period);
  const mid = sl.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(sl.reduce((a, b) => a + (b - mid) ** 2, 0) / period);
  const upper = mid + 2 * std;
  const lower = mid - 2 * std;
  const pos   = upper !== lower ? ((closes[closes.length - 1] - lower) / (upper - lower)) * 100 : 50;
  return { upper, lower, position: Math.round(pos) };
}

function calcATR(highs: number[], lows: number[], closes: number[], period = 14): number {
  const trs: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1])));
  }
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calcVolumeRatio(volumes: number[], period = 20): number {
  const recent = volumes[volumes.length - 1];
  const avg    = volumes.slice(-period - 1, -1).reduce((a, b) => a + b, 0) / period;
  return avg > 0 ? Math.round((recent / avg) * 100) / 100 : 1;
}

// ── Yahoo Finance fetch ───────────────────────────────────────────────────────
interface QuoteData {
  ticker: string; price: number; change1d: number; ytdReturn: number;
  ma50: number; ma200: number; high52w: number; low52w: number;
  aboveMa50: boolean; aboveMa200: boolean; distFromHigh: number; momentum3m: number;
  rsi: number; macdHistogram: number; bbPosition: number; atrPct: number; volumeRatio: number;
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
    const closes:  number[] = q.close   ?? [];
    const highs:   number[] = q.high    ?? [];
    const lows:    number[] = q.low     ?? [];
    const volumes: number[] = q.volume  ?? [];

    // Filter out nulls (keep index alignment)
    const valid = closes.map((c: number, i: number) => ({
      c, h: highs[i] ?? c, l: lows[i] ?? c, v: volumes[i] ?? 0, t: timestamps[i] ?? 0,
    })).filter(x => x.c != null && !isNaN(x.c));

    if (valid.length < 60) return null;

    const cs = valid.map(x => x.c);
    const hs = valid.map(x => x.h);
    const ls = valid.map(x => x.l);
    const vs = valid.map(x => x.v);

    const price   = cs[cs.length - 1];
    const prev    = cs[cs.length - 2];
    const change1d = ((price - prev) / prev) * 100;

    // YTD
    const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime() / 1000;
    const ytdIdx   = valid.findIndex(x => x.t >= yearStart);
    const ytdBase  = cs[ytdIdx >= 0 ? ytdIdx : 0];
    const ytdReturn = ((price - ytdBase) / ytdBase) * 100;

    // 3M
    const q3 = cs[Math.max(0, cs.length - 63)];
    const momentum3m = ((price - q3) / q3) * 100;

    // MAs
    const ma50  = cs.slice(-50).reduce((a, b) => a + b, 0) / 50;
    const ma200 = cs.length >= 200 ? cs.slice(-200).reduce((a, b) => a + b, 0) / 200 : ma50;

    const high52w = Math.max(...cs);
    const low52w  = Math.min(...cs);
    const distFromHigh = ((price - high52w) / high52w) * 100;

    // Advanced indicators
    const rsi         = calcRSI(cs.slice(-30));
    const { histogram: macdHistogram } = calcMACD(cs);
    const { position: bbPosition }     = calcBB(cs);
    const atrVal   = calcATR(hs.slice(-20), ls.slice(-20), cs.slice(-20));
    const atrPct   = (atrVal / price) * 100;
    const volRatio = calcVolumeRatio(vs);

    const r = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
    return {
      ticker, price: r(price), change1d: r(change1d, 1),
      ytdReturn: r(ytdReturn, 1), ma50: r(ma50), ma200: r(ma200),
      high52w: r(high52w), low52w: r(low52w),
      aboveMa50: price > ma50, aboveMa200: price > ma200,
      distFromHigh: r(distFromHigh, 1), momentum3m: r(momentum3m, 1),
      rsi: r(rsi, 1), macdHistogram: r(macdHistogram, 4),
      bbPosition: r(bbPosition, 0), atrPct: r(atrPct, 2), volumeRatio: r(volRatio, 2),
    };
  } catch { return null; }
}

// ── 5-level signal analysis ──────────────────────────────────────────────────
function analyzeStock(q: QuoteData, spyYtd: number, sectorAvgYtd: number) {
  const excessIdx    = q.ytdReturn - spyYtd;
  const excessSector = q.ytdReturn - sectorAvgYtd;

  const rsIndex  = excessIdx    >  5 ? 'STRONG' : excessIdx    < -5 ? 'WEAK' : 'NEUTRAL';
  const rsSector = excessSector >  3 ? 'STRONG' : excessSector < -3 ? 'WEAK' : 'NEUTRAL';
  const ma50Status = q.price > q.ma50 * 1.01 ? 'ABOVE' : q.price < q.ma50 * 0.99 ? 'BELOW' : 'AT';

  // Pattern
  let pattern: string;
  if      (q.distFromHigh > -5  && q.aboveMa50 && q.aboveMa200) pattern = 'BREAKOUT';
  else if (q.distFromHigh >= -15 && q.aboveMa50)                 pattern = 'CUP';
  else if (q.distFromHigh >= -20 && q.aboveMa50 && q.momentum3m > 0) pattern = 'W_BASE';
  else if (!q.aboveMa50 && q.momentum3m < -10)                   pattern = 'DOWNTREND';
  else                                                            pattern = 'NONE';

  // ── Scoring (1–10, float) ──────────────────────────────────────────────
  let score = 5;

  // MA signals
  if (q.aboveMa50)  score += 1.0; else score -= 1.0;
  if (q.aboveMa200) score += 0.5; else score -= 0.5;

  // RS signals
  if (rsIndex  === 'STRONG') score += 1.0; else if (rsIndex  === 'WEAK') score -= 1.0;
  if (rsSector === 'STRONG') score += 1.0; else if (rsSector === 'WEAK') score -= 1.0;

  // 3M momentum
  if (q.momentum3m > 25) score += 0.5; else if (q.momentum3m < -15) score -= 0.5;

  // RSI (14) — 45–75 ideal, overbought/oversold penalty
  if (q.rsi >= 45 && q.rsi <= 75) score += 0.5;
  else if (q.rsi > 80) score -= 0.5;          // overbought
  else if (q.rsi < 30) score -= 0.5;          // oversold with downtrend

  // MACD histogram
  if (q.macdHistogram > 0) score += 0.5; else score -= 0.5;

  // Volume ratio
  if (q.volumeRatio > 1.5) score += 0.5;
  else if (q.volumeRatio < 0.7) score -= 0.3;

  // Bollinger Band position (0–100)
  if (q.bbPosition >= 40 && q.bbPosition <= 80) score += 0.3; // healthy range
  else if (q.bbPosition > 95) score -= 0.5;  // upper band breakout (possible exhaustion)
  else if (q.bbPosition < 10) score -= 0.3;  // deep below lower band

  // 52w high proximity
  if (q.distFromHigh > -8) score += 0.5;

  score = Math.max(1, Math.min(10, Math.round(score * 2) / 2)); // round to 0.5

  // ── 5-level signal ────────────────────────────────────────────────────
  let signal: string;
  const macdBullish = q.macdHistogram > 0;
  const macdBearish = q.macdHistogram < 0;
  const rsiHealthy  = q.rsi >= 45 && q.rsi <= 75;
  const rsiOversold = q.rsi < 35;
  const volStrong   = q.volumeRatio > 1.5;

  if (
    score >= 8.5 &&
    q.aboveMa50 && q.aboveMa200 &&
    macdBullish && rsiHealthy && volStrong &&
    rsIndex !== 'WEAK'
  ) {
    signal = 'STRONG_BUY';
  } else if (score >= 7 && q.aboveMa50 && rsIndex !== 'WEAK') {
    signal = 'BUY';
  } else if (
    score <= 2 ||
    (!q.aboveMa50 && !q.aboveMa200 && macdBearish && rsIndex === 'WEAK' && rsiOversold)
  ) {
    signal = 'STRONG_SELL';
  } else if (score <= 4 || (!q.aboveMa50 && rsIndex === 'WEAK')) {
    signal = 'SELL';
  } else {
    signal = 'HOLD';
  }

  const confidence: string =
    score >= 9 || score <= 2 ? 'HIGH' :
    score >= 7 || score <= 4 ? 'MEDIUM' : 'LOW';

  // Price levels (ATR-based stop loss)
  const atrAbs = (q.atrPct / 100) * q.price;
  const entry  = signal.includes('BUY')
    ? `$${Math.round(q.price * 0.99 * 100) / 100}–$${Math.round(q.price * 1.02 * 100) / 100}` : null;
  const stop   = signal.includes('BUY')
    ? `$${Math.round((q.price - 2 * atrAbs) * 100) / 100}` : null;
  const support    = `$${Math.round(q.ma50 * 100) / 100}`;
  const resistance = `$${Math.round(q.high52w * 100) / 100}`;

  // Korean summary
  const signalWord = signal === 'STRONG_BUY' ? '즉시매수' : signal === 'BUY' ? '매수' :
                     signal === 'HOLD' ? '관망' : signal === 'SELL' ? '매도' : '즉시매도';
  const summary = `${q.ticker} [${signalWord}] YTD ${q.ytdReturn > 0 ? '+' : ''}${q.ytdReturn}% ` +
    `(S&P500 대비 ${excessIdx > 0 ? '+' : ''}${Math.round(excessIdx * 10) / 10}%). ` +
    `RSI ${q.rsi} · MACD ${macdBullish ? '상승' : '하락'} · BB ${q.bbPosition}% · 거래량비율 ${q.volumeRatio}x. ` +
    `${q.aboveMa50 ? '50일선 위에서 지지' : '50일선 아래 — 회복 여부 주목'}.`;

  // Cautions
  const cautions: string[] = [];
  if (q.rsi > 78) cautions.push(`RSI ${q.rsi} 과열 — 단기 조정 가능성`);
  if (q.bbPosition > 90) cautions.push('볼린저밴드 상단 근접 — 추격 주의');
  if (q.distFromHigh > -3 && signal.includes('BUY')) cautions.push('52주 고점 근접 — 눌림목 대기 권장');
  if (!q.aboveMa50 && signal === 'HOLD') cautions.push('50일선 아래 — 회복 확인 후 진입 권장');
  if (q.volumeRatio < 0.6) cautions.push('거래량 부족 — 신뢰도 낮음');

  return {
    ticker: q.ticker, signal, confidence,
    momentum_score: score,
    rs_vs_index: rsIndex, rs_vs_sector: rsSector,
    ma50_status: ma50Status, pattern,
    volume_confirmation: volStrong,
    entry_zone: entry, key_support: support,
    key_resistance: resistance, stop_loss: stop,
    summary, caution: cautions.length > 0 ? cautions.join(' / ') : null,
    rsi: q.rsi, macd_histogram: q.macdHistogram,
    bb_position: q.bbPosition, atr_pct: q.atrPct, volume_ratio: q.volumeRatio,
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
    (strongBuys.length > 0 ? `즉시매수 신호: ${strongBuys.slice(0, 5).join(', ')}. ` : '') +
    (buys.length > 0 ? `매수 신호: ${buys.slice(0, 5).join(', ')}.` : '현재 매수 신호 없음 — 관망 구간.');

  return NextResponse.json({ stocks, market_context, analyzed_at: new Date().toISOString() });
}
