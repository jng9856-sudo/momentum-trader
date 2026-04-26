import { NextRequest, NextResponse } from 'next/server';

// ── Math helpers ──────────────────────────────────────────────────────────────
function calcEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1); let prev = data[0];
  return data.map(d => { prev = d * k + prev * (1 - k); return prev; });
}
function calcMA(closes: number[], period: number): number {
  const sl = closes.slice(-period);
  return sl.length < period ? NaN : sl.reduce((a, b) => a + b, 0) / period;
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
function calcMACD(closes: number[]): { histogram: number } {
  const e12 = calcEMA(closes, 12), e26 = calcEMA(closes, 26);
  const line = e12.map((v, i) => v - e26[i]);
  const sig  = calcEMA(line.slice(-60), 9);
  return { histogram: Math.round((line[line.length-1] - sig[sig.length-1]) * 1000) / 1000 };
}
function calcBB(closes: number[], period = 20): { position: number } {
  const sl = closes.slice(-period), mid = sl.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(sl.reduce((a, b) => a + (b-mid)**2, 0) / period);
  const upper = mid + 2*std, lower = mid - 2*std;
  return { position: upper !== lower ? Math.round(((closes[closes.length-1] - lower) / (upper - lower)) * 100) : 50 };
}
function calcATR(hs: number[], ls: number[], cs: number[], period = 14): number {
  const trs: number[] = [];
  for (let i = 1; i < hs.length; i++)
    trs.push(Math.max(hs[i]-ls[i], Math.abs(hs[i]-cs[i-1]), Math.abs(ls[i]-cs[i-1])));
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}
function calcVolumeRatio(vs: number[], period = 20): number {
  const avg = vs.slice(-period-1, -1).reduce((a, b) => a + b, 0) / period;
  return avg > 0 ? Math.round((vs[vs.length-1] / avg) * 100) / 100 : 1;
}

// ── VCP Detection ─────────────────────────────────────────────────────────────
// Splits price history into weekly chunks, finds successive pullback contractions
interface VCPResult {
  score: number;          // 0–100
  isVCP: boolean;
  contractionCount: number;
  lastPullbackPct: number;
  baseWeeks: number;
  lowestVolWeekInBase: boolean;
  pivotPrice: number | null;
  detail: string;
}

function detectVCP(
  closes: number[],
  volumes: number[],
  high52w: number
): VCPResult {
  const WEEK = 5;
  // Need at least 15 weeks of data
  if (closes.length < WEEK * 15) {
    return { score: 0, isVCP: false, contractionCount: 0, lastPullbackPct: 0, baseWeeks: 0, lowestVolWeekInBase: false, pivotPrice: null, detail: '데이터 부족' };
  }

  // Build weekly OHLCV
  const weeks: { high: number; low: number; close: number; avgVol: number }[] = [];
  for (let i = closes.length - WEEK * 20; i < closes.length; i += WEEK) {
    const slice = closes.slice(i, i + WEEK);
    const vSlice = volumes.slice(i, i + WEEK).filter(v => v > 0);
    if (slice.length < 3) continue;
    weeks.push({
      high:   Math.max(...slice),
      low:    Math.min(...slice),
      close:  slice[slice.length - 1],
      avgVol: vSlice.length > 0 ? vSlice.reduce((a, b) => a + b, 0) / vSlice.length : 0,
    });
  }
  if (weeks.length < 6) return { score: 0, isVCP: false, contractionCount: 0, lastPullbackPct: 0, baseWeeks: 0, lowestVolWeekInBase: false, pivotPrice: null, detail: '데이터 부족' };

  // Find the most recent consolidation base
  // Base = period where price stays within 20% of a high
  const recentWeeks = weeks.slice(-20);
  const baseHigh = Math.max(...recentWeeks.map(w => w.high));
  const baseLow  = Math.min(...recentWeeks.map(w => w.low));
  const baseDepth = ((baseHigh - baseLow) / baseHigh) * 100;

  // Find base start (where price peaked before consolidation)
  let baseStartIdx = recentWeeks.length - 1;
  for (let i = recentWeeks.length - 2; i >= 0; i--) {
    if (recentWeeks[i].high >= baseHigh * 0.98) { baseStartIdx = i; break; }
  }
  const baseWeeks = recentWeeks.length - baseStartIdx;
  const baseSlice = recentWeeks.slice(baseStartIdx);

  // Find pullback swings within base
  const pullbacks: number[] = [];
  for (let i = 1; i < baseSlice.length; i++) {
    const localHigh = baseSlice[i-1].high;
    const localLow  = baseSlice[i].low;
    if (localLow < localHigh) {
      pullbacks.push(((localHigh - localLow) / localHigh) * 100);
    }
  }

  // VCP: pullbacks should be contracting (each smaller than previous)
  let contractionCount = 0;
  for (let i = 1; i < pullbacks.length; i++) {
    if (pullbacks[i] < pullbacks[i-1] * 0.85) contractionCount++;
  }

  const lastPullback = pullbacks[pullbacks.length - 1] ?? 0;

  // Check for lowest volume week in base (institutions not selling)
  const baseVols = baseSlice.map(w => w.avgVol).filter(v => v > 0);
  const overallAvgVol = recentWeeks.map(w => w.avgVol).filter(v => v > 0)
    .reduce((a, b) => a + b, 0) / recentWeeks.length;
  const minBaseVol = Math.min(...baseVols);
  const lowestVolWeekInBase = minBaseVol < overallAvgVol * 0.7;

  // Pivot = top of latest base (breakout point)
  const pivotPrice = baseHigh;

  // ── VCP Score (0–100) ──────────────────────────────────────────────────
  let vcpScore = 0;

  // Condition 1: 52w 고점 5% 이내 (0~25점)
  const price = closes[closes.length - 1];
  const distFrom52wHigh = ((price - high52w) / high52w) * 100;
  if (distFrom52wHigh > -2)  vcpScore += 25;
  else if (distFrom52wHigh > -5)  vcpScore += 20;
  else if (distFrom52wHigh > -10) vcpScore += 10;
  else if (distFrom52wHigh > -15) vcpScore += 5;

  // Condition 2: 베이스 기간 3주 이상 (0~20점)
  if (baseWeeks >= 8)      vcpScore += 20;
  else if (baseWeeks >= 5) vcpScore += 15;
  else if (baseWeeks >= 3) vcpScore += 10;

  // Condition 3: 베이스 내 저거래량 주 존재 (0~20점)
  if (lowestVolWeekInBase) vcpScore += 20;

  // Condition 4: 돌파 당일 거래량 (passed separately via volumeRatio)
  // handled in main score

  // Condition 5: 수렴 횟수 (0~20점)
  vcpScore += Math.min(20, contractionCount * 7);

  // Condition 6: 마지막 풀백 3% 이하 (0~15점) — tight consolidation
  if (lastPullback <= 2)      vcpScore += 15;
  else if (lastPullback <= 4) vcpScore += 10;
  else if (lastPullback <= 6) vcpScore += 5;

  const isVCP = vcpScore >= 50 && contractionCount >= 2 && baseWeeks >= 3;

  const detail = isVCP
    ? `VCP 확인: ${contractionCount}회 수렴 · 베이스 ${baseWeeks}주 · 마지막 조정 ${lastPullback.toFixed(1)}%${lowestVolWeekInBase ? ' · 저거래량 확인' : ''}`
    : `VCP 미충족: 수렴${contractionCount}회 · 베이스${baseWeeks}주 · 조정${lastPullback.toFixed(1)}%`;

  return { score: vcpScore, isVCP, contractionCount, lastPullbackPct: Math.round(lastPullback * 10) / 10, baseWeeks, lowestVolWeekInBase, pivotPrice: Math.round(pivotPrice * 100) / 100, detail };
}

// ── Pivot breakout check ──────────────────────────────────────────────────────
function checkPivotBreakout(closes: number[], volumes: number[], pivotPrice: number | null): {
  isBroken: boolean; distFromPivot: number; withinChaseLimit: boolean;
} {
  if (!pivotPrice) return { isBroken: false, distFromPivot: 0, withinChaseLimit: false };
  const price = closes[closes.length - 1];
  const distFromPivot = ((price - pivotPrice) / pivotPrice) * 100;
  const isBroken = price > pivotPrice;
  const withinChaseLimit = distFromPivot <= 3; // within 3% of pivot (chase limit)
  void volumes;
  return { isBroken, distFromPivot: Math.round(distFromPivot * 10) / 10, withinChaseLimit };
}


// ── OBV (On-Balance Volume) ───────────────────────────────────────────────────
function calcOBV(closes: number[], volumes: number[]): {
  trend: 'UP' | 'DOWN' | 'FLAT';
  divergence: boolean;
  detail: string;
} {
  if (closes.length < 20) return { trend: 'FLAT', divergence: false, detail: '데이터 부족' };

  // Calculate OBV series
  const obvSeries: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i-1])      obvSeries.push(obvSeries[i-1] + volumes[i]);
    else if (closes[i] < closes[i-1]) obvSeries.push(obvSeries[i-1] - volumes[i]);
    else                               obvSeries.push(obvSeries[i-1]);
  }

  // OBV trend: compare recent 10 vs previous 10
  const recent = obvSeries.slice(-10);
  const prev   = obvSeries.slice(-20, -10);
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const prevAvg   = prev.reduce((a, b)   => a + b, 0) / prev.length;
  const obvChange = ((recentAvg - prevAvg) / Math.abs(prevAvg || 1)) * 100;

  const trend: 'UP' | 'DOWN' | 'FLAT' = obvChange > 2 ? 'UP' : obvChange < -2 ? 'DOWN' : 'FLAT';

  // Divergence: price up but OBV down (bearish) or price down but OBV up (bullish)
  const priceRecent = closes.slice(-10);
  const pricePrev   = closes.slice(-20, -10);
  const priceChange = ((priceRecent[priceRecent.length-1] - pricePrev[0]) / pricePrev[0]) * 100;

  const divergence = (priceChange > 3 && obvChange < -1) || (priceChange < -3 && obvChange > 1);

  let detail: string;
  if (divergence && priceChange > 0) detail = 'OBV 베어리시 다이버전스 — 주가 상승 but 거래량 이탈 (분산 신호)';
  else if (divergence && priceChange < 0) detail = 'OBV 불리시 다이버전스 — 주가 하락 but 거래량 유입 (매집 신호)';
  else if (trend === 'UP') detail = 'OBV 상승 추세 — 기관 매집 진행 중';
  else if (trend === 'DOWN') detail = 'OBV 하락 추세 — 기관 분산 진행 중';
  else detail = 'OBV 횡보 — 방향성 중립';

  return { trend, divergence, detail };
}

// ── MA alignment ──────────────────────────────────────────────────────────────
function calcMAAlignment(price: number, mas: Record<string, number>) {
  const periods = [10, 20, 30, 50, 120] as const;
  let aboveCount = 0, minDist = Infinity, nearestSupport: number | null = null, nearest: string | null = null;
  for (const p of periods) {
    const ma = mas[`ma${p}`];
    if (isNaN(ma)) continue;
    if (price > ma) { aboveCount++; const d = price - ma; if (d < minDist) { minDist = d; nearestSupport = ma; nearest = `MA${p}`; } }
  }
  const v = periods.map(p => mas[`ma${p}`]).filter(v => !isNaN(v));
  const stackedBull = v.length >= 3 && v.every((val, i) => i === 0 || val < v[i-1]);
  const stackedBear = v.length >= 3 && v.every((val, i) => i === 0 || val > v[i-1]);
  return { aboveCount, stackedBull, stackedBear, nearestSupport, nearest };
}

// ── Precise entry zone ────────────────────────────────────────────────────────
function calcEntryZone(price: number, mas: Record<string, number>, atrAbs: number, signal: string, distFromHigh: number, vcp: VCPResult, pivot: { isBroken: boolean; distFromPivot: number; withinChaseLimit: boolean }) {
  const r = (n: number) => Math.round(n * 100) / 100;
  if (!signal.includes('BUY')) return { entry: null, stopLoss: `$${r(price - 2 * atrAbs)}` };

  // Priority 1: VCP pivot breakout within 3%
  if (vcp.isVCP && vcp.pivotPrice && pivot.isBroken && pivot.withinChaseLimit) {
    return {
      entry: `$${r(vcp.pivotPrice)}–$${r(vcp.pivotPrice * 1.03)} (VCP 피봇 돌파)`,
      stopLoss: `$${r(vcp.pivotPrice * 0.97)}`,
    };
  }

  // Priority 2: VCP pivot not yet broken — wait zone
  if (vcp.isVCP && vcp.pivotPrice && !pivot.isBroken) {
    return {
      entry: `$${r(vcp.pivotPrice)}–$${r(vcp.pivotPrice * 1.03)} (피봇 돌파 대기)`,
      stopLoss: `$${r(vcp.pivotPrice * 0.97)}`,
    };
  }

  // Priority 3: Near MA support (within 1 ATR)
  const periods = [10, 20, 30, 50, 120] as const;
  for (const p of periods) {
    const ma = mas[`ma${p}`];
    if (isNaN(ma)) continue;
    if (price > ma && price - ma < atrAbs * 1.2) {
      return { entry: `$${r(ma * 1.001)}–$${r(ma + atrAbs * 0.5)} (MA${p} 지지)`, stopLoss: `$${r(ma - atrAbs * 0.5)}` };
    }
  }

  // Priority 4: Near 52w high breakout
  if (distFromHigh > -3) {
    return { entry: `$${r(price * 0.998)}–$${r(price * 1.01)} (신고가 돌파)`, stopLoss: `$${r(price - 2 * atrAbs)}` };
  }

  // Fallback: pullback to nearest MA
  const nearestMA = periods.map(p => ({ p, ma: mas[`ma${p}`] }))
    .filter(x => !isNaN(x.ma) && price > x.ma)
    .sort((a, b) => (price - a.ma) - (price - b.ma))[0];
  if (nearestMA) {
    return { entry: `$${r(nearestMA.ma * 1.002)}–$${r((price + nearestMA.ma) / 2)} (눌림목)`, stopLoss: `$${r(nearestMA.ma - atrAbs * 0.5)}` };
  }

  return { entry: `$${r(price * 0.99)}–$${r(price * 1.005)}`, stopLoss: `$${r(price - 2 * atrAbs)}` };
}



// ── Multi-Timeframe: Weekly Analysis ─────────────────────────────────────────
interface WeeklyData {
  trend:        'UPTREND' | 'DOWNTREND' | 'SIDEWAYS';
  ma10w:        number;
  ma20w:        number;
  ma40w:        number;   // ~200일선 (주봉 40주)
  rsi:          number;
  macdHist:     number;
  aboveAllMAs:  boolean;
  pullbackPct:  number;   // 주봉 고점 대비 현재 얼마나 눌렸나
  isEntry:      boolean;  // 주봉 강세 + 일봉 눌림목 = 최고 타점
  alignScore:   number;   // 0-10 주봉-일봉 정렬 점수
  detail:       string;
}

async function fetchWeeklyData(ticker: string): Promise<WeeklyData | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1wk&range=2y`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 0 } }
    );
    if (!res.ok) return null;
    const data   = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const closes: number[] = (result.indicators?.quote?.[0]?.close ?? [])
      .filter((c: number) => c != null && !isNaN(c));
    if (closes.length < 20) return null;

    const price  = closes[closes.length - 1];
    const ma10w  = calcMA(closes, 10);
    const ma20w  = calcMA(closes, 20);
    const ma40w  = calcMA(closes, Math.min(40, closes.length));
    const rsi    = calcRSI(closes.slice(-20));
    const { histogram: macdHist } = calcMACD(closes);

    const aboveAllMAs = price > ma10w && price > ma20w && price > ma40w;

    // Weekly trend
    const week8ago = closes[Math.max(0, closes.length - 8)];
    const trendPct = ((price - week8ago) / week8ago) * 100;
    const trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' =
      trendPct > 5 ? 'UPTREND' : trendPct < -5 ? 'DOWNTREND' : 'SIDEWAYS';

    // Pullback from recent 13-week high
    const high13w   = Math.max(...closes.slice(-13));
    const pullbackPct = ((price - high13w) / high13w) * 100;

    // Best entry: weekly uptrend + daily pullback (-3% ~ -8% from 13w high)
    const isEntry = trend === 'UPTREND' && aboveAllMAs && pullbackPct >= -8 && pullbackPct <= -2;

    // Alignment score (0-10)
    let alignScore = 5;
    if (trend === 'UPTREND')    alignScore += 2; else if (trend === 'DOWNTREND') alignScore -= 2;
    if (aboveAllMAs)            alignScore += 1.5;
    if (rsi >= 40 && rsi <= 70) alignScore += 0.5;
    if (macdHist > 0)           alignScore += 0.5;
    if (isEntry)                alignScore += 0.5; // bonus for pullback entry
    alignScore = Math.max(1, Math.min(10, Math.round(alignScore * 2) / 2));

    const detail = isEntry
      ? `🎯 최고 타점: 주봉 상승추세 + ${Math.abs(Math.round(pullbackPct*10)/10)}% 눌림목 — 진입 구간`
      : trend === 'UPTREND'
        ? `주봉 상승추세 (8주 +${Math.round(trendPct*10)/10}%) · MA 정렬 ${aboveAllMAs ? '완성' : '미완성'}`
        : trend === 'DOWNTREND'
          ? `주봉 하락추세 — 일봉 매수 신호 신뢰도 낮음`
          : `주봉 횡보 — 돌파 방향 확인 필요`;

    const r = (n: number) => Math.round(n * 100) / 100;
    return {
      trend, ma10w: r(ma10w), ma20w: r(ma20w), ma40w: r(ma40w),
      rsi: Math.round(rsi * 10) / 10,
      macdHist: Math.round(macdHist * 1000) / 1000,
      aboveAllMAs, pullbackPct: Math.round(pullbackPct * 10) / 10,
      isEntry, alignScore, detail,
    };
  } catch { return null; }
}

// ── Short Interest (Yahoo Finance quoteSummary) ───────────────────────────────
async function fetchShortInterest(ticker: string): Promise<{
  shortPct: number | null;      // % of float shorted
  shortRatio: number | null;    // days to cover
  squeezePotential: 'HIGH' | 'MEDIUM' | 'LOW';
  shortDetail: string;
} | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=defaultKeyStatistics`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 86400 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const stats = data?.quoteSummary?.result?.[0]?.defaultKeyStatistics;
    if (!stats) return null;

    const shortPct   = stats.shortPercentOfFloat?.raw ? Math.round(stats.shortPercentOfFloat.raw * 1000) / 10 : null;
    const shortRatio = stats.shortRatio?.raw ? Math.round(stats.shortRatio.raw * 10) / 10 : null;

    let squeezePotential: 'HIGH' | 'MEDIUM' | 'LOW';
    let shortDetail: string;

    if (shortPct !== null && shortPct > 25) {
      squeezePotential = 'HIGH';
      shortDetail = `공매도 ${shortPct}% — 숏스퀴즈 가능성 높음 (호재 시 급등 가능)`;
    } else if (shortPct !== null && shortPct > 10) {
      squeezePotential = 'MEDIUM';
      shortDetail = `공매도 ${shortPct}% — 중간 수준 (상승 저항 존재)`;
    } else if (shortPct !== null) {
      squeezePotential = 'LOW';
      shortDetail = `공매도 ${shortPct}% — 낮음 (공매도 압력 미미)`;
    } else {
      squeezePotential = 'LOW';
      shortDetail = '공매도 데이터 없음';
    }

    return { shortPct, shortRatio, squeezePotential, shortDetail };
  } catch { return null; }
}

// ── Yahoo Finance fetch ───────────────────────────────────────────────────────
interface QuoteData {
  ticker: string; price: number; change1d: number; ytdReturn: number;
  ma10: number; ma20: number; ma30: number; ma50: number; ma120: number; ma200: number;
  high52w: number; low52w: number; distFromHigh: number; momentum3m: number;
  rsi: number; macdHistogram: number; bbPosition: number;
  atrPct: number; atrAbs: number; volumeRatio: number;
  vcp: VCPResult;
  pivot: { isBroken: boolean; distFromPivot: number; withinChaseLimit: boolean };
  obv: { trend: 'UP' | 'DOWN' | 'FLAT'; divergence: boolean; detail: string };
  shortInterest: { shortPct: number | null; shortRatio: number | null; squeezePotential: 'HIGH' | 'MEDIUM' | 'LOW'; shortDetail: string } | null;
  weekly: WeeklyData | null;
}

async function fetchQuote(ticker: string): Promise<QuoteData | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=2y`,
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

    if (valid.length < 60) return null;

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
    const momentum3m = ((price - cs[Math.max(0, cs.length - 63)]) / cs[Math.max(0, cs.length - 63)]) * 100;

    // MAs
    const ma10 = calcMA(cs, 10), ma20 = calcMA(cs, 20), ma30 = calcMA(cs, 30);
    const ma50 = calcMA(cs, 50), ma120 = calcMA(cs, 120), ma200 = calcMA(cs, 200);

    const high52w = Math.max(...cs.slice(-252));
    const low52w  = Math.min(...cs.slice(-252));
    const distFromHigh = ((price - high52w) / high52w) * 100;

    const rsi            = calcRSI(cs.slice(-30));
    const { histogram }  = calcMACD(cs);
    const { position }   = calcBB(cs);
    const atrVal         = calcATR(hs.slice(-20), ls.slice(-20), cs.slice(-20));
    const volRatio       = calcVolumeRatio(vs);

    // OBV
    const obv = calcOBV(cs.slice(-60), vs.slice(-60));

    // Short Interest + Weekly (parallel)
    const [shortInterest, weekly] = await Promise.all([
      fetchShortInterest(ticker),
      fetchWeeklyData(ticker),
    ]);

    // VCP detection
    const vcp   = detectVCP(cs, vs, high52w);
    const pivot = checkPivotBreakout(cs, vs, vcp.pivotPrice);

    const r = (n: number, d = 2) => Math.round(n * 10**d) / 10**d;
    return {
      ticker, price: r(price), change1d: r(change1d, 1),
      ytdReturn: r(ytdReturn, 1), momentum3m: r(momentum3m, 1),
      ma10: r(ma10), ma20: r(ma20), ma30: r(ma30),
      ma50: r(ma50), ma120: r(ma120), ma200: r(ma200),
      high52w: r(high52w), low52w: r(low52w),
      distFromHigh: r(distFromHigh, 1),
      rsi: r(rsi, 1), macdHistogram: r(histogram, 4),
      bbPosition: Math.round(position),
      atrPct: r((atrVal / price) * 100, 2), atrAbs: r(atrVal, 2),
      volumeRatio: r(volRatio, 2),
      vcp, pivot, obv, shortInterest, weekly,
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
  const ma50Status = q.price > q.ma50 * 1.01 ? 'ABOVE' : q.price < q.ma50 * 0.99 ? 'BELOW' : 'AT';

  // Pattern
  let pattern: string;
  if      (q.vcp.isVCP && q.pivot.isBroken)                              pattern = 'BREAKOUT';
  else if (q.vcp.isVCP && !q.pivot.isBroken)                             pattern = 'CUP';
  else if (q.distFromHigh >= -20 && aboveCount >= 2 && q.momentum3m > 0) pattern = 'W_BASE';
  else if (aboveCount <= 1 && q.momentum3m < -10)                        pattern = 'DOWNTREND';
  else                                                                     pattern = 'NONE';

  // ── Score ─────────────────────────────────────────────────────────────────
  let score = 5;

  // MA alignment (strongest factor)
  score += (aboveCount - 2.5) * 0.5;
  if (stackedBull) score += 0.5;
  if (stackedBear) score -= 0.5;

  // RS
  if (rsIndex  === 'STRONG') score += 1.0; else if (rsIndex  === 'WEAK') score -= 1.0;
  if (rsSector === 'STRONG') score += 1.0; else if (rsSector === 'WEAK') score -= 1.0;

  // RSI
  if (q.rsi >= 45 && q.rsi <= 70) score += 0.5;
  else if (q.rsi > 80) score -= 0.5;
  else if (q.rsi < 30) score -= 0.5;

  // MACD
  if (q.macdHistogram > 0) score += 0.5; else score -= 0.5;

  // Volume
  if (q.volumeRatio > 1.5) score += 0.5; else if (q.volumeRatio < 0.7) score -= 0.3;

  // BB
  if (q.bbPosition >= 40 && q.bbPosition <= 80) score += 0.3;
  else if (q.bbPosition > 95) score -= 0.5;

  // 52w high proximity
  if (q.distFromHigh > -8) score += 0.5;

  // VCP bonus (최대 +2점)
  score += (q.vcp.score / 100) * 2;

  // Weekly timeframe alignment bonus
  if (q.weekly) {
    score += (q.weekly.alignScore - 5) * 0.3; // -1.5 ~ +1.5
    if (q.weekly.isEntry) score += 1.0;        // best entry signal bonus
    if (q.weekly.trend === 'DOWNTREND') score -= 1.0; // weekly downtrend = red flag
  }

  // Short Interest adjustment
  if (q.shortInterest) {
    const si = q.shortInterest;
    // High short interest = headwind for buyers (score penalty)
    // But extreme short interest + VCP = squeeze setup (bonus)
    if (si.shortPct !== null) {
      if (si.shortPct > 25 && q.vcp.isVCP) score += 0.5; // squeeze setup
      else if (si.shortPct > 20) score -= 0.5;            // heavy shorting
      else if (si.shortPct > 10) score -= 0.2;            // moderate shorting
    }
  }

  // OBV bonus/penalty
  if (q.obv.trend === 'UP' && !q.obv.divergence) score += 0.5;
  else if (q.obv.trend === 'DOWN') score -= 0.3;
  if (q.obv.divergence && q.obv.trend === 'DOWN') score -= 0.5; // bearish divergence

  // Pivot breakout within 3% bonus
  if (q.pivot.isBroken && q.pivot.withinChaseLimit) score += 0.5;

  // Lowest vol week in base bonus (기관 매도 없음)
  if (q.vcp.lowestVolWeekInBase) score += 0.3;

  score = Math.max(1, Math.min(10, Math.round(score * 2) / 2));

  // ── Signal ────────────────────────────────────────────────────────────────
  let signal: string;
  const macdBull  = q.macdHistogram > 0;
  const macdBear  = q.macdHistogram < 0;
  const rsiOk     = q.rsi >= 45 && q.rsi <= 75;
  const volStrong = q.volumeRatio > 1.5;

  // VCP 피봇 돌파 + 거래량 폭발 = 최고 타점
  if (q.vcp.isVCP && q.pivot.isBroken && q.pivot.withinChaseLimit && volStrong && aboveCount >= 3) {
    signal = 'STRONG_BUY';
  } else if (score >= 8.5 && aboveCount >= 4 && stackedBull && macdBull && rsiOk && volStrong) {
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

  // Entry / stop
  const { entry, stopLoss } = calcEntryZone(q.price, mas, q.atrAbs, signal, q.distFromHigh, q.vcp, q.pivot);
  const support    = nearestSupport ? `$${Math.round(nearestSupport * 100) / 100} (${nearest})` : `$${q.ma50}`;
  const resistance = `$${q.high52w}`;

  // Summary
  const maStatus   = `MA ${aboveCount}/5개 위${stackedBull ? ' (정배열)' : stackedBear ? ' (역배열)' : ''}`;
  const vcpStatus  = q.vcp.isVCP ? ` · VCP ${q.vcp.score}점` : '';
  const pivotStatus = q.pivot.isBroken && q.pivot.withinChaseLimit ? ` · 피봇 돌파 +${q.pivot.distFromPivot}%` : '';
  const signalWord = { STRONG_BUY:'즉시매수', BUY:'매수', HOLD:'관망', SELL:'매도', STRONG_SELL:'즉시매도' }[signal] ?? signal;

  const summary = `[${signalWord}] YTD ${q.ytdReturn > 0 ? '+' : ''}${q.ytdReturn}% (S&P500 대비 ${excessIdx > 0 ? '+' : ''}${Math.round(excessIdx*10)/10}%). `
    + `${maStatus}${vcpStatus}${pivotStatus}. RSI ${q.rsi} · MACD ${macdBull?'상승':'하락'} · 거래량 ${q.volumeRatio}x.`;

  const cautions: string[] = [];
  if (q.rsi > 78) cautions.push(`RSI ${q.rsi} 과열`);
  if (q.bbPosition > 90) cautions.push('BB 상단 근접');
  if (q.distFromHigh > -3 && signal.includes('BUY') && !q.pivot.isBroken) cautions.push('52주 고점 근접 — 돌파 확인 후 진입');
  if (q.pivot.isBroken && !q.pivot.withinChaseLimit) cautions.push(`피봇 돌파 후 ${q.pivot.distFromPivot}% 상승 — 추격 한도(3%) 초과`);
  if (q.volumeRatio < 0.6) cautions.push('거래량 부족 — 돌파 신뢰도 낮음');
  if (q.obv.divergence) cautions.push(q.obv.detail);
  if (q.weekly?.isEntry) {/* No caution — it's a positive signal */}
  if (q.weekly?.trend === 'DOWNTREND')
    cautions.push('주봉 하락추세 — 일봉 매수 신호 신뢰도 저하');
  if (q.shortInterest?.shortPct && q.shortInterest.shortPct > 20)
    cautions.push(q.shortInterest.shortDetail);
  if (q.shortInterest?.squeezePotential === 'HIGH' && signal.includes('BUY'))
    cautions.push('⚡ 숏스퀴즈 가능성 — 호재 발생 시 급등 가능');
  if (aboveCount <= 1 && signal === 'HOLD') cautions.push('MA 다수 아래 — 추세 약화');

  return {
    ticker: q.ticker, signal, confidence,
    momentum_score: score,
    rs_vs_index: rsIndex, rs_vs_sector: rsSector,
    ma50_status: ma50Status, pattern,
    volume_confirmation: volStrong,
    entry_zone: entry, key_support: support,
    key_resistance: resistance, stop_loss: stopLoss,
    summary, caution: cautions.length > 0 ? cautions.join(' / ') : null,
    rsi: q.rsi, macd_histogram: q.macdHistogram,
    bb_position: q.bbPosition, atr_pct: q.atrPct, volume_ratio: q.volumeRatio,
    ma10: q.ma10, ma20: q.ma20, ma30: q.ma30, ma50: q.ma50, ma120: q.ma120,
    above_ma_count: aboveCount, stacked_bull: stackedBull, stacked_bear: stackedBear,
    // VCP / Pivot data
    vcp_score: q.vcp.score, vcp_is_vcp: q.vcp.isVCP,
    vcp_contraction_count: q.vcp.contractionCount,
    vcp_last_pullback: q.vcp.lastPullbackPct,
    vcp_base_weeks: q.vcp.baseWeeks,
    vcp_lowest_vol: q.vcp.lowestVolWeekInBase,
    vcp_pivot: q.vcp.pivotPrice,
    vcp_detail: q.vcp.detail,
    pivot_broken: q.pivot.isBroken,
    pivot_dist: q.pivot.distFromPivot,
    pivot_within_chase: q.pivot.withinChaseLimit,
    // OBV
    obv_trend: q.obv.trend,
    obv_divergence: q.obv.divergence,
    obv_detail: q.obv.detail,
    // Weekly timeframe
    weekly_trend:       q.weekly?.trend ?? null,
    weekly_align_score: q.weekly?.alignScore ?? null,
    weekly_is_entry:    q.weekly?.isEntry ?? false,
    weekly_pullback:    q.weekly?.pullbackPct ?? null,
    weekly_above_mas:   q.weekly?.aboveAllMAs ?? false,
    weekly_detail:      q.weekly?.detail ?? null,
    weekly_rsi:         q.weekly?.rsi ?? null,
    // Short Interest
    short_pct: q.shortInterest?.shortPct ?? null,
    short_ratio: q.shortInterest?.shortRatio ?? null,
    short_squeeze: q.shortInterest?.squeezePotential ?? 'LOW',
    short_detail: q.shortInterest?.shortDetail ?? null,
  };
}

// ── Route ─────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let tickers: string[];
  try {
    const body = await req.json(); tickers = body.tickers;
    if (!Array.isArray(tickers) || tickers.length === 0) throw new Error('invalid');
  } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }); }

  const [spyQuote, ...stockQuotes] = await Promise.all([fetchQuote('SPY'), ...tickers.map(fetchQuote)]);
  const validStocks = stockQuotes.filter((q): q is QuoteData => q !== null);
  if (validStocks.length === 0) return NextResponse.json({ error: '주가 데이터를 가져올 수 없습니다.' }, { status: 500 });

  const spyYtd       = spyQuote?.ytdReturn ?? 0;
  const sectorAvgYtd = validStocks.reduce((a, s) => a + s.ytdReturn, 0) / validStocks.length;
  const stocks       = validStocks.map(q => analyzeStock(q, spyYtd, sectorAvgYtd));

  const strongBuys = stocks.filter(s => s.signal === 'STRONG_BUY').map(s => s.ticker);
  const buys       = stocks.filter(s => s.signal === 'BUY').map(s => s.ticker);
  const vcpPicks   = stocks.filter(s => s.vcp_is_vcp).sort((a, b) => b.vcp_score - a.vcp_score).slice(0, 3).map(s => s.ticker);

  const market_context =
    `섹터 YTD 평균 ${sectorAvgYtd > 0 ? '+' : ''}${Math.round(sectorAvgYtd*10)/10}% vs S&P500 ${spyYtd > 0 ? '+' : ''}${Math.round(spyYtd*10)/10}%. ` +
    (strongBuys.length > 0 ? `즉시매수: ${strongBuys.slice(0,5).join(', ')}. ` : '') +
    (buys.length > 0 ? `매수: ${buys.slice(0,5).join(', ')}. ` : '') +
    (vcpPicks.length > 0 ? `VCP 패턴 감지: ${vcpPicks.join(', ')}.` : '');

  return NextResponse.json({ stocks, market_context, analyzed_at: new Date().toISOString() });
}
