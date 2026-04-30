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

// ── 🆕 R/R 비율 계산 ──────────────────────────────────────────────────────────
// 진입가(entry), 손절가(stopLoss), 목표가(resistance)로 리스크/리워드 계산
function calcRRRatio(
  entryZone: string | null,
  stopLossStr: string | null,
  resistanceStr: string | null,
  price: number
): {
  rrRatio: number | null;
  rrGrade: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | null;
  riskAmt: number | null;
  rewardAmt: number | null;
  rrLabel: string;
} {
  // 가격 문자열에서 숫자 추출 ($307.37–$321.94 → 307.37 / $298.42 → 298.42)
  const parsePrice = (s: string | null): number | null => {
    if (!s) return null;
    const m = s.match(/\$(\d+\.?\d*)/);
    return m ? parseFloat(m[1]) : null;
  };

  const entryPrice     = parsePrice(entryZone) ?? price;   // 진입가 (구간 하단)
  const stopLossPrice  = parsePrice(stopLossStr);           // 손절가
  const resistancePrice = parsePrice(resistanceStr);        // 목표가(저항선)

  if (!stopLossPrice || !resistancePrice) {
    return { rrRatio: null, rrGrade: null, riskAmt: null, rewardAmt: null, rrLabel: '계산 불가' };
  }

  const riskAmt   = Math.abs(entryPrice - stopLossPrice);   // 손실 가능 금액
  const rewardAmt = Math.abs(resistancePrice - entryPrice); // 수익 가능 금액

  if (riskAmt === 0) {
    return { rrRatio: null, rrGrade: null, riskAmt: null, rewardAmt: null, rrLabel: '계산 불가' };
  }

  const rrRatio = Math.round((rewardAmt / riskAmt) * 10) / 10;

  // R/R 등급
  const rrGrade: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' =
    rrRatio >= 4   ? 'EXCELLENT' :
    rrRatio >= 2.5 ? 'GOOD' :
    rrRatio >= 1.5 ? 'FAIR' : 'POOR';

  const gradeLabel = { EXCELLENT: '최상 🏆', GOOD: '양호 ✓', FAIR: '보통', POOR: '불리 ✗' }[rrGrade];
  const rrLabel = `1 : ${rrRatio} (${gradeLabel})`;

  return {
    rrRatio,
    rrGrade,
    riskAmt:   Math.round(riskAmt * 100) / 100,
    rewardAmt: Math.round(rewardAmt * 100) / 100,
    rrLabel,
  };
}

// ── Market Regime Filter ──────────────────────────────────────────────────────
export type MarketRegime = 'BULL' | 'NEUTRAL' | 'CAUTION' | 'BEAR';

interface MarketRegimeData {
  regime: MarketRegime;
  spyPrice: number; spyMa200: number; spyAboveMa200: boolean; spyMa200Dist: number;
  vix: number; vixLevel: 'LOW' | 'MID' | 'HIGH' | 'EXTREME';
  qqqAboveMa200: boolean; label: string; emoji: string; signalAdjust: string;
}

async function fetchMarketRegime(): Promise<MarketRegimeData | null> {
  try {
    const [spyRes, qqqRes, vixRes] = await Promise.all([
      fetch('https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1d&range=1y', { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 3600 } }),
      fetch('https://query1.finance.yahoo.com/v8/finance/chart/QQQ?interval=1d&range=1y', { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 3600 } }),
      fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=5d', { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 3600 } }),
    ]);
    let spyPrice = 0, spyMa200 = 0, spyAboveMa200 = false, spyMa200Dist = 0;
    if (spyRes.ok) {
      const sd = await spyRes.json();
      const sc: number[] = (sd?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? []).filter((v: number) => v != null && !isNaN(v));
      if (sc.length >= 200) { spyPrice = sc[sc.length-1]; spyMa200 = calcMA(sc, 200); spyAboveMa200 = spyPrice > spyMa200; spyMa200Dist = Math.round(((spyPrice - spyMa200) / spyMa200) * 1000) / 10; }
    }
    let qqqAboveMa200 = false;
    if (qqqRes.ok) {
      const qd = await qqqRes.json();
      const qc: number[] = (qd?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? []).filter((v: number) => v != null && !isNaN(v));
      if (qc.length >= 200) { const qp = qc[qc.length-1]; qqqAboveMa200 = qp > calcMA(qc, 200); }
    }
    let vix = 20;
    if (vixRes.ok) {
      const vd = await vixRes.json();
      const vc: number[] = (vd?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? []).filter((v: number) => v != null && !isNaN(v));
      if (vc.length > 0) vix = Math.round(vc[vc.length-1] * 10) / 10;
    }
    const vixLevel: 'LOW' | 'MID' | 'HIGH' | 'EXTREME' = vix < 20 ? 'LOW' : vix < 25 ? 'MID' : vix < 35 ? 'HIGH' : 'EXTREME';
    let regime: MarketRegime, label: string, emoji: string, signalAdjust: string;
    if (spyAboveMa200 && qqqAboveMa200 && vix < 20) { regime = 'BULL'; label = '강세장'; emoji = '🟢'; signalAdjust = '신호 그대로 적용'; }
    else if (spyAboveMa200 && vix < 25) { regime = 'NEUTRAL'; label = '중립'; emoji = '🟡'; signalAdjust = 'STRONG_BUY → BUY 강등'; }
    else if (!spyAboveMa200 && vix < 35) { regime = 'CAUTION'; label = '약세주의'; emoji = '🟠'; signalAdjust = 'BUY → HOLD 강등'; }
    else { regime = 'BEAR'; label = '약세장'; emoji = '🔴'; signalAdjust = '모든 매수 신호 → HOLD 강등'; }
    return { regime, spyPrice, spyMa200: Math.round(spyMa200 * 100) / 100, spyAboveMa200, spyMa200Dist, vix, vixLevel, qqqAboveMa200, label, emoji, signalAdjust };
  } catch { return null; }
}

function applyRegimeFilter(signal: string, score: number, regime: MarketRegime): { adjustedSignal: string; adjustedScore: number; regimeNote: string | null } {
  if (regime === 'BULL') return { adjustedSignal: signal, adjustedScore: score, regimeNote: null };
  if (regime === 'NEUTRAL') {
    if (signal === 'STRONG_BUY') return { adjustedSignal: 'BUY', adjustedScore: Math.max(1, score - 0.5), regimeNote: '🟡 중립 시장 — STRONG_BUY → BUY 하향' };
    return { adjustedSignal: signal, adjustedScore: score, regimeNote: null };
  }
  if (regime === 'CAUTION') {
    if (signal === 'STRONG_BUY') return { adjustedSignal: 'BUY', adjustedScore: Math.max(1, score - 1), regimeNote: '🟠 약세주의 — STRONG_BUY → BUY 하향 (SPY 200일선 하회)' };
    if (signal === 'BUY') return { adjustedSignal: 'HOLD', adjustedScore: Math.max(1, score - 1), regimeNote: '🟠 약세주의 — BUY → HOLD 하향 (SPY 200일선 하회)' };
    return { adjustedSignal: signal, adjustedScore: score, regimeNote: null };
  }
  if (regime === 'BEAR') {
    if (signal === 'STRONG_BUY' || signal === 'BUY') return { adjustedSignal: 'HOLD', adjustedScore: Math.max(1, score - 2), regimeNote: '🔴 약세장 — 매수 신호 무효화 (SPY 200일선 하회 + VIX 35+)' };
    return { adjustedSignal: signal, adjustedScore: score, regimeNote: null };
  }
  return { adjustedSignal: signal, adjustedScore: score, regimeNote: null };
}

// ── VCP Detection ─────────────────────────────────────────────────────────────
interface VCPResult {
  score: number; isVCP: boolean; contractionCount: number; lastPullbackPct: number;
  baseWeeks: number; lowestVolWeekInBase: boolean; pivotPrice: number | null; detail: string;
}
function detectVCP(closes: number[], volumes: number[], high52w: number): VCPResult {
  const WEEK = 5;
  if (closes.length < WEEK * 15) return { score: 0, isVCP: false, contractionCount: 0, lastPullbackPct: 0, baseWeeks: 0, lowestVolWeekInBase: false, pivotPrice: null, detail: '데이터 부족' };
  const weeks: { high: number; low: number; close: number; avgVol: number }[] = [];
  for (let i = closes.length - WEEK * 20; i < closes.length; i += WEEK) {
    const slice = closes.slice(i, i + WEEK), vSlice = volumes.slice(i, i + WEEK).filter(v => v > 0);
    if (slice.length < 3) continue;
    weeks.push({ high: Math.max(...slice), low: Math.min(...slice), close: slice[slice.length-1], avgVol: vSlice.length > 0 ? vSlice.reduce((a,b)=>a+b,0)/vSlice.length : 0 });
  }
  if (weeks.length < 6) return { score: 0, isVCP: false, contractionCount: 0, lastPullbackPct: 0, baseWeeks: 0, lowestVolWeekInBase: false, pivotPrice: null, detail: '데이터 부족' };
  const recentWeeks = weeks.slice(-20), baseHigh = Math.max(...recentWeeks.map(w => w.high));
  let baseStartIdx = recentWeeks.length - 1;
  for (let i = recentWeeks.length - 2; i >= 0; i--) { if (recentWeeks[i].high >= baseHigh * 0.98) { baseStartIdx = i; break; } }
  const baseWeeks = recentWeeks.length - baseStartIdx, baseSlice = recentWeeks.slice(baseStartIdx);
  const pullbacks: number[] = [];
  for (let i = 1; i < baseSlice.length; i++) { const lh = baseSlice[i-1].high, ll = baseSlice[i].low; if (ll < lh) pullbacks.push(((lh - ll) / lh) * 100); }
  let contractionCount = 0;
  for (let i = 1; i < pullbacks.length; i++) { if (pullbacks[i] < pullbacks[i-1] * 0.85) contractionCount++; }
  const lastPullback = pullbacks[pullbacks.length-1] ?? 0;
  const baseVols = baseSlice.map(w => w.avgVol).filter(v => v > 0);
  const overallAvgVol = recentWeeks.map(w => w.avgVol).filter(v => v > 0).reduce((a,b)=>a+b,0) / recentWeeks.length;
  const lowestVolWeekInBase = Math.min(...baseVols) < overallAvgVol * 0.7;
  let vcpScore = 0;
  const price = closes[closes.length-1], distFrom52wHigh = ((price - high52w) / high52w) * 100;
  if (distFrom52wHigh > -2) vcpScore += 25; else if (distFrom52wHigh > -5) vcpScore += 20; else if (distFrom52wHigh > -10) vcpScore += 10; else if (distFrom52wHigh > -15) vcpScore += 5;
  if (baseWeeks >= 8) vcpScore += 20; else if (baseWeeks >= 5) vcpScore += 15; else if (baseWeeks >= 3) vcpScore += 10;
  if (lowestVolWeekInBase) vcpScore += 20;
  vcpScore += Math.min(20, contractionCount * 7);
  if (lastPullback <= 2) vcpScore += 15; else if (lastPullback <= 4) vcpScore += 10; else if (lastPullback <= 6) vcpScore += 5;
  const isVCP = vcpScore >= 50 && contractionCount >= 2 && baseWeeks >= 3;
  return { score: vcpScore, isVCP, contractionCount, lastPullbackPct: Math.round(lastPullback*10)/10, baseWeeks, lowestVolWeekInBase, pivotPrice: Math.round(baseHigh*100)/100, detail: isVCP ? `VCP 확인: ${contractionCount}회 수렴 · 베이스 ${baseWeeks}주 · 마지막 조정 ${lastPullback.toFixed(1)}%${lowestVolWeekInBase?' · 저거래량 확인':''}` : `VCP 미충족: 수렴${contractionCount}회 · 베이스${baseWeeks}주 · 조정${lastPullback.toFixed(1)}%` };
}

function checkPivotBreakout(closes: number[], volumes: number[], pivotPrice: number | null) {
  if (!pivotPrice) return { isBroken: false, distFromPivot: 0, withinChaseLimit: false };
  const price = closes[closes.length-1], distFromPivot = ((price - pivotPrice) / pivotPrice) * 100;
  void volumes;
  return { isBroken: price > pivotPrice, distFromPivot: Math.round(distFromPivot*10)/10, withinChaseLimit: distFromPivot <= 3 };
}

function calcOBV(closes: number[], volumes: number[]) {
  if (closes.length < 20) return { trend: 'FLAT' as const, divergence: false, detail: '데이터 부족' };
  const obvSeries: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i-1]) obvSeries.push(obvSeries[i-1] + volumes[i]);
    else if (closes[i] < closes[i-1]) obvSeries.push(obvSeries[i-1] - volumes[i]);
    else obvSeries.push(obvSeries[i-1]);
  }
  const recent = obvSeries.slice(-10), prev = obvSeries.slice(-20, -10);
  const rAvg = recent.reduce((a,b)=>a+b,0)/recent.length, pAvg = prev.reduce((a,b)=>a+b,0)/prev.length;
  const obvChange = ((rAvg - pAvg) / Math.abs(pAvg || 1)) * 100;
  const trend = obvChange > 2 ? 'UP' as const : obvChange < -2 ? 'DOWN' as const : 'FLAT' as const;
  const priceRecent = closes.slice(-10), pricePrev = closes.slice(-20, -10);
  const priceChange = ((priceRecent[priceRecent.length-1] - pricePrev[0]) / pricePrev[0]) * 100;
  const divergence = (priceChange > 3 && obvChange < -1) || (priceChange < -3 && obvChange > 1);
  const detail = divergence && priceChange > 0 ? 'OBV 베어리시 다이버전스 — 주가 상승 but 거래량 이탈' : divergence && priceChange < 0 ? 'OBV 불리시 다이버전스 — 주가 하락 but 거래량 유입' : trend === 'UP' ? 'OBV 상승 추세 — 기관 매집 진행 중' : trend === 'DOWN' ? 'OBV 하락 추세 — 기관 분산 진행 중' : 'OBV 횡보 — 방향성 중립';
  return { trend, divergence, detail };
}

function calcMAAlignment(price: number, mas: Record<string, number>) {
  const periods = [10, 20, 30, 50, 120] as const;
  let aboveCount = 0, minDist = Infinity, nearestSupport: number | null = null, nearest: string | null = null;
  for (const p of periods) {
    const ma = mas[`ma${p}`]; if (isNaN(ma)) continue;
    if (price > ma) { aboveCount++; const d = price - ma; if (d < minDist) { minDist = d; nearestSupport = ma; nearest = `MA${p}`; } }
  }
  const v = periods.map(p => mas[`ma${p}`]).filter(v => !isNaN(v));
  return { aboveCount, stackedBull: v.length >= 3 && v.every((val,i) => i===0||val<v[i-1]), stackedBear: v.length >= 3 && v.every((val,i) => i===0||val>v[i-1]), nearestSupport, nearest };
}

function calcEntryZone(price: number, mas: Record<string, number>, atrAbs: number, signal: string, distFromHigh: number, vcp: VCPResult, pivot: { isBroken: boolean; distFromPivot: number; withinChaseLimit: boolean }) {
  const r = (n: number) => Math.round(n * 100) / 100;
  if (!signal.includes('BUY')) return { entry: null, stopLoss: `$${r(price - 2 * atrAbs)}` };
  if (vcp.isVCP && vcp.pivotPrice && pivot.isBroken && pivot.withinChaseLimit) return { entry: `$${r(vcp.pivotPrice)}–$${r(vcp.pivotPrice * 1.03)} (VCP 피봇 돌파)`, stopLoss: `$${r(vcp.pivotPrice * 0.97)}` };
  if (vcp.isVCP && vcp.pivotPrice && !pivot.isBroken) return { entry: `$${r(vcp.pivotPrice)}–$${r(vcp.pivotPrice * 1.03)} (피봇 돌파 대기)`, stopLoss: `$${r(vcp.pivotPrice * 0.97)}` };
  const periods = [10, 20, 30, 50, 120] as const;
  for (const p of periods) { const ma = mas[`ma${p}`]; if (isNaN(ma)) continue; if (price > ma && price - ma < atrAbs * 1.2) return { entry: `$${r(ma * 1.001)}–$${r(ma + atrAbs * 0.5)} (MA${p} 지지)`, stopLoss: `$${r(ma - atrAbs * 0.5)}` }; }
  if (distFromHigh > -3) return { entry: `$${r(price * 0.998)}–$${r(price * 1.01)} (신고가 돌파)`, stopLoss: `$${r(price - 2 * atrAbs)}` };
  const nearestMA = periods.map(p => ({ p, ma: mas[`ma${p}`] })).filter(x => !isNaN(x.ma) && price > x.ma).sort((a,b) => (price-a.ma)-(price-b.ma))[0];
  if (nearestMA) return { entry: `$${r(nearestMA.ma * 1.002)}–$${r((price + nearestMA.ma) / 2)} (눌림목)`, stopLoss: `$${r(nearestMA.ma - atrAbs * 0.5)}` };
  return { entry: `$${r(price * 0.99)}–$${r(price * 1.005)}`, stopLoss: `$${r(price - 2 * atrAbs)}` };
}

interface WeeklyData {
  trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS'; ma10w: number; ma20w: number; ma40w: number;
  rsi: number; macdHist: number; aboveAllMAs: boolean; pullbackPct: number;
  isEntry: boolean; alignScore: number; detail: string;
}
async function fetchWeeklyData(ticker: string): Promise<WeeklyData | null> {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1wk&range=2y`, { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 0 } });
    if (!res.ok) return null;
    const data = await res.json(), result = data?.chart?.result?.[0];
    if (!result) return null;
    const closes: number[] = (result.indicators?.quote?.[0]?.close ?? []).filter((c: number) => c != null && !isNaN(c));
    if (closes.length < 20) return null;
    const price = closes[closes.length-1], ma10w = calcMA(closes,10), ma20w = calcMA(closes,20), ma40w = calcMA(closes,Math.min(40,closes.length));
    const rsi = calcRSI(closes.slice(-20)), { histogram: macdHist } = calcMACD(closes);
    const aboveAllMAs = price > ma10w && price > ma20w && price > ma40w;
    const week8ago = closes[Math.max(0, closes.length-8)], trendPct = ((price - week8ago) / week8ago) * 100;
    const trend: 'UPTREND'|'DOWNTREND'|'SIDEWAYS' = trendPct > 5 ? 'UPTREND' : trendPct < -5 ? 'DOWNTREND' : 'SIDEWAYS';
    const high13w = Math.max(...closes.slice(-13)), pullbackPct = ((price - high13w) / high13w) * 100;
    const isEntry = trend === 'UPTREND' && aboveAllMAs && pullbackPct >= -8 && pullbackPct <= -2;
    let alignScore = 5;
    if (trend === 'UPTREND') alignScore += 2; else if (trend === 'DOWNTREND') alignScore -= 2;
    if (aboveAllMAs) alignScore += 1.5; if (rsi >= 40 && rsi <= 70) alignScore += 0.5; if (macdHist > 0) alignScore += 0.5; if (isEntry) alignScore += 0.5;
    alignScore = Math.max(1, Math.min(10, Math.round(alignScore * 2) / 2));
    const detail = isEntry ? `🎯 최고 타점: 주봉 상승추세 + ${Math.abs(Math.round(pullbackPct*10)/10)}% 눌림목` : trend === 'UPTREND' ? `주봉 상승추세 (8주 +${Math.round(trendPct*10)/10}%) · MA 정렬 ${aboveAllMAs?'완성':'미완성'}` : trend === 'DOWNTREND' ? '주봉 하락추세 — 일봉 매수 신호 신뢰도 낮음' : '주봉 횡보 — 돌파 방향 확인 필요';
    const r = (n: number) => Math.round(n * 100) / 100;
    return { trend, ma10w: r(ma10w), ma20w: r(ma20w), ma40w: r(ma40w), rsi: Math.round(rsi*10)/10, macdHist: Math.round(macdHist*1000)/1000, aboveAllMAs, pullbackPct: Math.round(pullbackPct*10)/10, isEntry, alignScore, detail };
  } catch { return null; }
}

function detect52wBreakout(closes: number[], volumes: number[]) {
  if (closes.length < 252) return { isBreakout: false, breakoutDay: -1, prev52wHigh: 0, breakoutPct: 0, volConfirmed: false, detail: '데이터 부족' };
  const today = closes[closes.length-1], yesterday = closes[closes.length-2];
  const prev52wHigh = Math.max(...closes.slice(-252, -1));
  const avgVol = volumes.slice(-21,-1).reduce((a,b)=>a+b,0)/20, volConfirmed = volumes[volumes.length-1] > avgVol * 1.4;
  if (today > prev52wHigh && yesterday <= prev52wHigh) { const bp = ((today-prev52wHigh)/prev52wHigh)*100; return { isBreakout:true, breakoutDay:0, prev52wHigh:Math.round(prev52wHigh*100)/100, breakoutPct:Math.round(bp*10)/10, volConfirmed, detail:`🚀 52주 신고가 돌파! $${Math.round(prev52wHigh*100)/100} 돌파 (+${Math.round(bp*10)/10}%)${volConfirmed?' · 거래량 확인':' · 거래량 부족'}` }; }
  const prev52wHigh2 = Math.max(...closes.slice(-253,-2));
  if (yesterday > prev52wHigh2 && closes[closes.length-3] <= prev52wHigh2) { const bp = ((yesterday-prev52wHigh2)/prev52wHigh2)*100; return { isBreakout:true, breakoutDay:1, prev52wHigh:Math.round(prev52wHigh2*100)/100, breakoutPct:Math.round(bp*10)/10, volConfirmed, detail:'어제 52주 신고가 돌파 — 3% 이내 추격 진입 가능' }; }
  return { isBreakout:false, breakoutDay:-1, prev52wHigh, breakoutPct:0, volConfirmed:false, detail:'' };
}

async function fetchEarningsSurprise(ticker: string) {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=earningsTrend`, { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 86400 } });
    if (!res.ok) return null;
    const data = await res.json(), trend = data?.quoteSummary?.result?.[0]?.earningsTrend?.trend;
    if (!trend) return null;
    const lastQ = trend.find((t: { period: string }) => t.period === '-1q');
    if (!lastQ) return null;
    const actual = lastQ.actualEarnings?.raw, estimate = lastQ.earningsEstimate?.avg?.raw;
    if (actual == null || estimate == null || estimate === 0) return null;
    const surprisePct = ((actual - estimate) / Math.abs(estimate)) * 100, hasSurprise = surprisePct > 5;
    return { hasSurprise, surprisePct: Math.round(surprisePct*10)/10, reportDate:null, daysAgo:null, peadSignal:hasSurprise, detail: hasSurprise ? `어닝 서프라이즈 +${Math.round(surprisePct*10)/10}% — PEAD 상승 모멘텀 유효` : `어닝 인라인/미스 (${Math.round(surprisePct*10)/10}%)` };
  } catch { return null; }
}

async function fetchShortInterest(ticker: string) {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=defaultKeyStatistics`, { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 86400 } });
    if (!res.ok) return null;
    const stats = (await res.json())?.quoteSummary?.result?.[0]?.defaultKeyStatistics;
    if (!stats) return null;
    const shortPct = stats.shortPercentOfFloat?.raw ? Math.round(stats.shortPercentOfFloat.raw*1000)/10 : null;
    const shortRatio = stats.shortRatio?.raw ? Math.round(stats.shortRatio.raw*10)/10 : null;
    const squeezePotential: 'HIGH'|'MEDIUM'|'LOW' = shortPct && shortPct > 25 ? 'HIGH' : shortPct && shortPct > 10 ? 'MEDIUM' : 'LOW';
    const shortDetail = shortPct ? (shortPct > 25 ? `공매도 ${shortPct}% — 숏스퀴즈 가능성 높음` : shortPct > 10 ? `공매도 ${shortPct}% — 중간 수준` : `공매도 ${shortPct}% — 낮음`) : '공매도 데이터 없음';
    return { shortPct, shortRatio, squeezePotential, shortDetail };
  } catch { return null; }
}

interface QuoteData {
  ticker: string; price: number; change1d: number; ytdReturn: number;
  ma10: number; ma20: number; ma30: number; ma50: number; ma120: number; ma200: number;
  high52w: number; low52w: number; distFromHigh: number; momentum3m: number;
  rsi: number; macdHistogram: number; bbPosition: number; atrPct: number; atrAbs: number; volumeRatio: number;
  vcp: VCPResult; pivot: { isBroken: boolean; distFromPivot: number; withinChaseLimit: boolean };
  obv: { trend: 'UP'|'DOWN'|'FLAT'; divergence: boolean; detail: string };
  shortInterest: { shortPct: number|null; shortRatio: number|null; squeezePotential: 'HIGH'|'MEDIUM'|'LOW'; shortDetail: string } | null;
  weekly: WeeklyData | null;
  breakout52w: { isBreakout: boolean; breakoutDay: number; prev52wHigh: number; breakoutPct: number; volConfirmed: boolean; detail: string };
  earningSurprise: { hasSurprise: boolean; surprisePct: number|null; peadSignal: boolean; detail: string } | null;
}

async function fetchQuote(ticker: string): Promise<QuoteData | null> {
  try {
    let realtimePrice: number | null = null;
    if (process.env.KIS_APP_KEY) {
      try {
        const { getUSStockPrice, isKRStock, getKRStockPrice, toKISCode } = await import('@/lib/kis');
        if (isKRStock(ticker)) { const kr = await getKRStockPrice(toKISCode(ticker)); if (kr?.price) realtimePrice = kr.price; }
        else { const us = await getUSStockPrice(ticker); if (us?.price) realtimePrice = us.price; }
      } catch {}
    }
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=2y`, { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 0 } });
    if (!res.ok) return null;
    const data = await res.json(), result = data?.chart?.result?.[0];
    if (!result) return null;
    const q = result.indicators?.quote?.[0] ?? {}, timestamps = result.timestamp ?? [];
    const closes: number[] = q.close ?? [], highs: number[] = q.high ?? [], lows: number[] = q.low ?? [], volumes: number[] = q.volume ?? [];
    const valid = closes.map((c: number, i: number) => ({ c, h: highs[i]??c, l: lows[i]??c, v: volumes[i]??0, t: timestamps[i]??0 })).filter(x => x.c != null && !isNaN(x.c));
    if (valid.length < 60) return null;
    const cs = valid.map(x=>x.c), hs = valid.map(x=>x.h), ls = valid.map(x=>x.l), vs = valid.map(x=>x.v);
    const price = realtimePrice ?? cs[cs.length-1];
    const change1d = ((price - cs[cs.length-2]) / cs[cs.length-2]) * 100;
    const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime() / 1000;
    const ytdIdx = valid.findIndex(x => x.t >= yearStart), ytdBase = cs[ytdIdx >= 0 ? ytdIdx : 0];
    const ytdReturn = ((price - ytdBase) / ytdBase) * 100;
    const momentum3m = ((price - cs[Math.max(0, cs.length-63)]) / cs[Math.max(0, cs.length-63)]) * 100;
    const ma10=calcMA(cs,10), ma20=calcMA(cs,20), ma30=calcMA(cs,30), ma50=calcMA(cs,50), ma120=calcMA(cs,120), ma200=calcMA(cs,200);
    const high52w=Math.max(...cs.slice(-252)), low52w=Math.min(...cs.slice(-252));
    const distFromHigh=((price-high52w)/high52w)*100, rsi=calcRSI(cs.slice(-30));
    const { histogram }=calcMACD(cs), { position }=calcBB(cs);
    const atrVal=calcATR(hs.slice(-20),ls.slice(-20),cs.slice(-20)), volRatio=calcVolumeRatio(vs);
    const obv=calcOBV(cs.slice(-60), vs.slice(-60));
    const [shortInterest, weekly, earningSurprise] = await Promise.all([fetchShortInterest(ticker), fetchWeeklyData(ticker), fetchEarningsSurprise(ticker)]);
    const breakout52w=detect52wBreakout(cs,vs), vcp=detectVCP(cs,vs,high52w), pivot=checkPivotBreakout(cs,vs,vcp.pivotPrice);
    const r = (n: number, d=2) => Math.round(n * 10**d) / 10**d;
    return { ticker, price:r(price), change1d:r(change1d,1), ytdReturn:r(ytdReturn,1), momentum3m:r(momentum3m,1), ma10:r(ma10), ma20:r(ma20), ma30:r(ma30), ma50:r(ma50), ma120:r(ma120), ma200:r(ma200), high52w:r(high52w), low52w:r(low52w), distFromHigh:r(distFromHigh,1), rsi:r(rsi,1), macdHistogram:r(histogram,4), bbPosition:Math.round(position), atrPct:r((atrVal/price)*100,2), atrAbs:r(atrVal,2), volumeRatio:r(volRatio,2), vcp, pivot, obv, shortInterest, weekly, breakout52w, earningSurprise };
  } catch { return null; }
}

function analyzeStock(q: QuoteData, spyYtd: number, sectorAvgYtd: number, regime: MarketRegime) {
  const excessIdx=q.ytdReturn-spyYtd, excessSector=q.ytdReturn-sectorAvgYtd;
  const rsIndex=excessIdx>5?'STRONG':excessIdx<-5?'WEAK':'NEUTRAL';
  const rsSector=excessSector>3?'STRONG':excessSector<-3?'WEAK':'NEUTRAL';
  const mas={ma10:q.ma10,ma20:q.ma20,ma30:q.ma30,ma50:q.ma50,ma120:q.ma120};
  const { aboveCount, stackedBull, stackedBear, nearestSupport, nearest }=calcMAAlignment(q.price, mas);
  const ma50Status=q.price>q.ma50*1.01?'ABOVE':q.price<q.ma50*0.99?'BELOW':'AT';
  let pattern='NONE';
  if (q.vcp.isVCP && q.pivot.isBroken) pattern='BREAKOUT';
  else if (q.vcp.isVCP && !q.pivot.isBroken) pattern='CUP';
  else if (q.distFromHigh>=-20 && aboveCount>=2 && q.momentum3m>0) pattern='W_BASE';
  else if (aboveCount<=1 && q.momentum3m<-10) pattern='DOWNTREND';

  let score=5;
  score += (aboveCount-2.5)*0.5;
  if (stackedBull) score+=0.5; if (stackedBear) score-=0.5;
  if (rsIndex==='STRONG') score+=1.0; else if (rsIndex==='WEAK') score-=1.0;
  if (rsSector==='STRONG') score+=1.0; else if (rsSector==='WEAK') score-=1.0;
  if (q.rsi>=45&&q.rsi<=70) score+=0.5; else if (q.rsi>80) score-=0.5; else if (q.rsi<30) score-=0.5;
  if (q.macdHistogram>0) score+=0.5; else score-=0.5;
  if (q.volumeRatio>1.5) score+=0.5; else if (q.volumeRatio<0.7) score-=0.3;
  if (q.bbPosition>=40&&q.bbPosition<=80) score+=0.3; else if (q.bbPosition>95) score-=0.5;
  if (q.distFromHigh>-8) score+=0.5;
  score += (q.vcp.score/100)*2;
  if (q.weekly) { score+=(q.weekly.alignScore-5)*0.3; if (q.weekly.isEntry) score+=1.0; if (q.weekly.trend==='DOWNTREND') score-=1.0; }
  if (q.shortInterest?.shortPct) { if (q.shortInterest.shortPct>25&&q.vcp.isVCP) score+=0.5; else if (q.shortInterest.shortPct>20) score-=0.5; else if (q.shortInterest.shortPct>10) score-=0.2; }
  if (q.obv.trend==='UP'&&!q.obv.divergence) score+=0.5; else if (q.obv.trend==='DOWN') score-=0.3;
  if (q.obv.divergence&&q.obv.trend==='DOWN') score-=0.5;
  if (q.breakout52w.isBreakout) { if (q.breakout52w.breakoutDay===0&&q.breakout52w.volConfirmed) score+=1.5; else if (q.breakout52w.breakoutDay===0) score+=1.0; else score+=0.5; }
  if (q.earningSurprise?.peadSignal) score+=0.5;
  if (q.earningSurprise?.hasSurprise&&(q.earningSurprise.surprisePct??0)>15) score+=0.3;
  if (q.pivot.isBroken&&q.pivot.withinChaseLimit) score+=0.5;
  if (q.vcp.lowestVolWeekInBase) score+=0.3;
  score=Math.max(1,Math.min(10,Math.round(score*2)/2));

  const macdBull=q.macdHistogram>0, macdBear=q.macdHistogram<0, rsiOk=q.rsi>=45&&q.rsi<=75, volStrong=q.volumeRatio>1.5;
  let signal='HOLD';
  if (q.breakout52w.isBreakout&&q.breakout52w.breakoutDay===0&&q.breakout52w.volConfirmed&&aboveCount>=3&&rsIndex!=='WEAK') signal='STRONG_BUY';
  else if (q.vcp.isVCP&&q.pivot.isBroken&&q.pivot.withinChaseLimit&&volStrong&&aboveCount>=3) signal='STRONG_BUY';
  else if (score>=8.5&&aboveCount>=4&&stackedBull&&macdBull&&rsiOk&&volStrong) signal='STRONG_BUY';
  else if (score>=7&&aboveCount>=3&&rsIndex!=='WEAK') signal='BUY';
  else if (score<=2||(aboveCount===0&&macdBear&&rsIndex==='WEAK')) signal='STRONG_SELL';
  else if (score<=4||(aboveCount<=1&&rsIndex==='WEAK')) signal='SELL';

  const { adjustedSignal, adjustedScore, regimeNote }=applyRegimeFilter(signal, score, regime);
  signal=adjustedSignal; score=adjustedScore;

  const confidence=score>=9||score<=2?'HIGH':score>=7||score<=4?'MEDIUM':'LOW';
  const { entry, stopLoss }=calcEntryZone(q.price, mas, q.atrAbs, signal, q.distFromHigh, q.vcp, q.pivot);
  const support=nearestSupport?`$${Math.round(nearestSupport*100)/100} (${nearest})`:`$${q.ma50}`;
  const resistance=`$${q.high52w}`;

  // ── 🆕 R/R 비율 계산 ────────────────────────────────────────────────────────
  const { rrRatio, rrGrade, riskAmt, rewardAmt, rrLabel } = calcRRRatio(entry, stopLoss, resistance, q.price);
  // ────────────────────────────────────────────────────────────────────────────

  const maStatus=`MA ${aboveCount}/5개 위${stackedBull?' (정배열)':stackedBear?' (역배열)':''}`;
  const signalWord={STRONG_BUY:'즉시매수',BUY:'매수',HOLD:'관망',SELL:'매도',STRONG_SELL:'즉시매도'}[signal]??signal;
  const summary=`[${signalWord}] YTD ${q.ytdReturn>0?'+':''}${q.ytdReturn}% (S&P500 대비 ${excessIdx>0?'+':''}${Math.round(excessIdx*10)/10}%). ${maStatus}. RSI ${q.rsi} · MACD ${macdBull?'상승':'하락'} · 거래량 ${q.volumeRatio}x.`;

  const cautions: string[]=[];
  if (regimeNote) cautions.push(regimeNote);
  if (rrGrade==='POOR'&&signal.includes('BUY')) cautions.push(`R/R ${rrLabel} — 리스크 대비 수익 불리, 진입 재검토`); // 🆕 R/R 경고
  if (q.rsi>78) cautions.push(`RSI ${q.rsi} 과열`);
  if (q.bbPosition>90) cautions.push('BB 상단 근접');
  if (q.distFromHigh>-3&&signal.includes('BUY')&&!q.pivot.isBroken) cautions.push('52주 고점 근접 — 돌파 확인 후 진입');
  if (q.pivot.isBroken&&!q.pivot.withinChaseLimit) cautions.push(`피봇 돌파 후 ${q.pivot.distFromPivot}% — 추격 한도 초과`);
  if (q.volumeRatio<0.6) cautions.push('거래량 부족');
  if (q.obv.divergence) cautions.push(q.obv.detail);
  if (q.weekly?.trend==='DOWNTREND') cautions.push('주봉 하락추세');
  if (q.shortInterest?.shortPct&&q.shortInterest.shortPct>20) cautions.push(q.shortInterest.shortDetail);
  if (q.shortInterest?.squeezePotential==='HIGH'&&signal.includes('BUY')) cautions.push('⚡ 숏스퀴즈 가능성');
  if (aboveCount<=1&&signal==='HOLD') cautions.push('MA 다수 아래 — 추세 약화');

  return {
    ticker:q.ticker, signal, confidence, momentum_score:score,
    rs_vs_index:rsIndex, rs_vs_sector:rsSector, ma50_status:ma50Status, pattern,
    volume_confirmation:volStrong, entry_zone:entry, key_support:support, key_resistance:resistance, stop_loss:stopLoss,
    summary, caution:cautions.length>0?cautions.join(' / '):null,
    rsi:q.rsi, macd_histogram:q.macdHistogram, bb_position:q.bbPosition, atr_pct:q.atrPct, volume_ratio:q.volumeRatio,
    ma10:q.ma10, ma20:q.ma20, ma30:q.ma30, ma50:q.ma50, ma120:q.ma120,
    above_ma_count:aboveCount, stacked_bull:stackedBull, stacked_bear:stackedBear,
    vcp_score:q.vcp.score, vcp_is_vcp:q.vcp.isVCP, vcp_contraction_count:q.vcp.contractionCount,
    vcp_last_pullback:q.vcp.lastPullbackPct, vcp_base_weeks:q.vcp.baseWeeks,
    vcp_lowest_vol:q.vcp.lowestVolWeekInBase, vcp_pivot:q.vcp.pivotPrice, vcp_detail:q.vcp.detail,
    pivot_broken:q.pivot.isBroken, pivot_dist:q.pivot.distFromPivot, pivot_within_chase:q.pivot.withinChaseLimit,
    breakout_52w:q.breakout52w.isBreakout, breakout_52w_day:q.breakout52w.breakoutDay,
    breakout_52w_vol:q.breakout52w.volConfirmed, breakout_52w_detail:q.breakout52w.detail,
    pead_signal:q.earningSurprise?.peadSignal??false, pead_surprise_pct:q.earningSurprise?.surprisePct??null, pead_detail:q.earningSurprise?.detail??null,
    obv_trend:q.obv.trend, obv_divergence:q.obv.divergence, obv_detail:q.obv.detail,
    weekly_trend:q.weekly?.trend??null, weekly_align_score:q.weekly?.alignScore??null,
    weekly_is_entry:q.weekly?.isEntry??false, weekly_pullback:q.weekly?.pullbackPct??null,
    weekly_above_mas:q.weekly?.aboveAllMAs??false, weekly_detail:q.weekly?.detail??null, weekly_rsi:q.weekly?.rsi??null,
    short_pct:q.shortInterest?.shortPct??null, short_ratio:q.shortInterest?.shortRatio??null,
    short_squeeze:q.shortInterest?.squeezePotential??'LOW', short_detail:q.shortInterest?.shortDetail??null,
    regime_note:regimeNote,
    // 🆕 R/R 비율 필드
    rr_ratio:rrRatio, rr_grade:rrGrade, rr_risk:riskAmt, rr_reward:rewardAmt, rr_label:rrLabel,
  };
}

// ── Route ─────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let tickers: string[];
  try { const body=await req.json(); tickers=body.tickers; if (!Array.isArray(tickers)||tickers.length===0) throw new Error('invalid'); }
  catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }); }

  const [marketRegimeData, spyQuote, ...stockQuotes] = await Promise.all([fetchMarketRegime(), fetchQuote('SPY'), ...tickers.map(fetchQuote)]);
  const regime: MarketRegime = marketRegimeData?.regime ?? 'BULL';
  const validStocks = stockQuotes.filter((q): q is QuoteData => q !== null);
  if (validStocks.length===0) return NextResponse.json({ error: '주가 데이터를 가져올 수 없습니다.' }, { status: 500 });

  const spyYtd=spyQuote?.ytdReturn??0;
  const sectorAvgYtd=validStocks.reduce((a,s)=>a+s.ytdReturn,0)/validStocks.length;
  const stocks=validStocks.map(q=>analyzeStock(q,spyYtd,sectorAvgYtd,regime));

  const ytdValues=validStocks.map(s=>s.ytdReturn).sort((a,b)=>a-b), totalCount=ytdValues.length;
  for (let i=0;i<stocks.length;i++) {
    const ytd=validStocks[i]?.ytdReturn??0, rank=ytdValues.filter(v=>v<=ytd).length;
    const rsRank=Math.round((rank/totalCount)*100);
    (stocks[i] as Record<string,unknown>).rs_rank=rsRank;
    if (rsRank<10&&stocks[i].signal.includes('BUY')) { (stocks[i] as Record<string,unknown>).rs_rank_warning=true; if (stocks[i].confidence==='HIGH') (stocks[i] as Record<string,unknown>).confidence='MEDIUM'; }
    if (rsRank>=90&&stocks[i].signal.includes('BUY')&&stocks[i].confidence==='MEDIUM') (stocks[i] as Record<string,unknown>).confidence='HIGH';
  }

  try {
    const sectorRes=await fetch('https://query1.finance.yahoo.com/v8/finance/chart/SOXX?interval=1d&range=1y',{headers:{'User-Agent':'Mozilla/5.0'},next:{revalidate:3600}});
    if (sectorRes.ok) {
      const sd=await sectorRes.json();
      const sc: number[]=(sd?.chart?.result?.[0]?.indicators?.quote?.[0]?.close??[]).filter((v: number)=>v!=null&&!isNaN(v));
      const st: number[]=sd?.chart?.result?.[0]?.timestamp??[];
      if (sc.length>0) {
        const ys=new Date(new Date().getFullYear(),0,1).getTime()/1000, yi=st.findIndex((t: number)=>t>=ys);
        const soxxYtd=((sc[sc.length-1]-sc[yi>=0?yi:0])/sc[yi>=0?yi:0])*100;
        for (const s of stocks) {
          const isSemi=['AMD','NVDA','MRVL','MU','INTC','ARM','TSM','AVGO','QCOM','AMAT','LRCX','KLAC','SOXX'].includes(s.ticker);
          if (isSemi) { (s as Record<string,unknown>).sector_ytd=Math.round(soxxYtd*10)/10; if (soxxYtd<-10&&s.signal.includes('BUY')) { if (s.confidence==='HIGH') (s as Record<string,unknown>).confidence='MEDIUM'; (s as Record<string,unknown>).sector_warning='반도체 섹터 하락 중 — 신뢰도 하향'; } }
        }
      }
    }
  } catch {}

  const strongBuys=stocks.filter(s=>s.signal==='STRONG_BUY').map(s=>s.ticker);
  const buys=stocks.filter(s=>s.signal==='BUY').map(s=>s.ticker);
  const vcpPicks=stocks.filter(s=>s.vcp_is_vcp).sort((a,b)=>b.vcp_score-a.vcp_score).slice(0,3).map(s=>s.ticker);
  const regimeStr=marketRegimeData?`${marketRegimeData.emoji} 시장 국면: ${marketRegimeData.label} (SPY ${marketRegimeData.spyAboveMa200?'200일선 위':'200일선 아래'} ${marketRegimeData.spyMa200Dist>0?'+':''}${marketRegimeData.spyMa200Dist}% / VIX ${marketRegimeData.vix}). `:'';
  const market_context=regimeStr+`섹터 YTD 평균 ${sectorAvgYtd>0?'+':''}${Math.round(sectorAvgYtd*10)/10}% vs S&P500 ${spyYtd>0?'+':''}${Math.round(spyYtd*10)/10}%. `+(strongBuys.length>0?`즉시매수: ${strongBuys.slice(0,5).join(', ')}. `:'')+(buys.length>0?`매수: ${buys.slice(0,5).join(', ')}. `:'')+(vcpPicks.length>0?`VCP 패턴 감지: ${vcpPicks.join(', ')}.`:'');

  return NextResponse.json({ stocks, market_context, analyzed_at:new Date().toISOString(), market_regime:marketRegimeData??null });
}
