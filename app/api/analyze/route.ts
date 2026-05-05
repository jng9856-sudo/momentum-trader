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

// ── R/R 비율 계산 ──────────────────────────────────────────────────────────────
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
  const parsePrice = (s: string | null): number | null => {
    if (!s) return null;
    const m = s.match(/\$(\d+\.?\d*)/);
    return m ? parseFloat(m[1]) : null;
  };

  const entryPrice     = parsePrice(entryZone) ?? price;
  const stopLossPrice  = parsePrice(stopLossStr);
  const resistancePrice = parsePrice(resistanceStr);

  if (!stopLossPrice || !resistancePrice) {
    return { rrRatio: null, rrGrade: null, riskAmt: null, rewardAmt: null, rrLabel: '계산 불가' };
  }

  const riskAmt   = Math.abs(entryPrice - stopLossPrice);
  const rewardAmt = Math.abs(resistancePrice - entryPrice);

  if (riskAmt === 0) {
    return { rrRatio: null, rrGrade: null, riskAmt: null, rewardAmt: null, rrLabel: '계산 불가' };
  }

  const rrRatio = Math.round((rewardAmt / riskAmt) * 10) / 10;

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

// ── 트레일링 스탑 계산 ─────────────────────────────────────────────────────────
interface TrailingStopResult {
  initialStop:    number;
  trailStop10:    number;
  trailStop20:    number;
  trailStop30:    number;
  atrMultiplier:  number;
  atrAbs:         number;
  breakEvenStop:  number;
  detail:         string;
}

function calcTrailingStop(price: number, atrAbs: number, entryZone: string | null): TrailingStopResult {
  const r = (n: number) => Math.round(n * 100) / 100;

  const entryMatch = entryZone?.match(/\$(\d+\.?\d*)/);
  const entryPrice = entryMatch ? parseFloat(entryMatch[1]) : price;

  const atrPct = (atrAbs / price) * 100;
  const multiplier = atrPct <= 2 ? 2.5 : atrPct <= 4 ? 2.0 : 1.5;

  const initialStop = r(entryPrice - atrAbs * multiplier);
  const trailStop10 = r(entryPrice * 1.10 - atrAbs * multiplier);
  const trailStop20 = r(entryPrice * 1.20 - atrAbs * multiplier);
  const trailStop30 = r(entryPrice * 1.30 - atrAbs * multiplier);
  const breakEvenStop = r(entryPrice * 1.005);

  const detail = `ATR ${r(atrAbs)} × ${multiplier}배 기준 | 초기 손절 $${initialStop} | +10% 시 $${trailStop10} | +20% 시 $${trailStop20}`;

  return { initialStop, trailStop10, trailStop20, trailStop30, atrMultiplier: multiplier, atrAbs: r(atrAbs), breakEvenStop, detail };
}

// ── 분할 매수/매도 구간 계산 ──────────────────────────────────────────────────
interface SplitZoneResult {
  entry1: { price: string; ratio: number; condition: string };
  entry2: { price: string; ratio: number; condition: string };
  entry3: { price: string; ratio: number; condition: string };
  exit1:  { price: string; ratio: number; gain: string };
  exit2:  { price: string; ratio: number; gain: string };
  exit3:  { price: string; ratio: number; gain: string };
  avgEntry: number;
}

function calcSplitZones(
  price: number,
  mas:   Record<string, number>,
  atrAbs: number,
  vcp:   { isVCP: boolean; pivotPrice: number | null },
  pullback: { isPullback: boolean; supportPrice: number | null; nearestSupport: string | null }
): SplitZoneResult {
  const r = (n: number) => `$${Math.round(n * 100) / 100}`;
  const rn = (n: number) => Math.round(n * 100) / 100;

  const support1 = pullback.supportPrice ?? (!isNaN(mas.ma20) ? mas.ma20 : price * 0.97);
  const entry1Price = rn(support1 * 1.002);

  const support2 = !isNaN(mas.ma50) ? mas.ma50 : (!isNaN(mas.ma30) ? mas.ma30 : price * 0.94);
  const entry2Price = rn(support2 * 1.002);

  const entry3Price = vcp.isVCP && vcp.pivotPrice
    ? rn(vcp.pivotPrice * 1.005)
    : rn(price * 1.01);

  const avgEntry = rn((entry1Price * 0.5 + entry2Price * 0.3 + entry3Price * 0.2));

  const exit1Price = rn(avgEntry * 1.08);
  const exit2Price = rn(avgEntry * 1.18);
  const exit3Price = rn(avgEntry * 1.30);

  return {
    entry1: { price: r(entry1Price), ratio: 50, condition: `${pullback.nearestSupport ?? 'MA20'} 지지 확인` },
    entry2: { price: r(entry2Price), ratio: 30, condition: `MA50($${Math.round(support2 * 100) / 100}) 지지 확인` },
    entry3: { price: r(entry3Price), ratio: 20, condition: vcp.isVCP ? 'VCP 피봇 돌파 + 거래량' : '추세 재개 확인' },
    exit1:  { price: r(exit1Price), ratio: 30, gain: '+8%' },
    exit2:  { price: r(exit2Price), ratio: 30, gain: '+18%' },
    exit3:  { price: r(exit3Price), ratio: 40, gain: '+30%↑ 트레일링' },
    avgEntry,
  };
}

// Pocket Pivot
interface PocketPivotResult {
  isPocketPivot:    boolean;
  daysAgo:          number;
  volume:           number;
  maxDownVol:       number;
  volRatio:         number;
  aboveMA:          string | null;
  detail:           string;
}

function detectPocketPivot(
  closes:  number[],
  volumes: number[],
  mas:     Record<string, number>
): PocketPivotResult {
  const empty: PocketPivotResult = {
    isPocketPivot: false, daysAgo: -1, volume: 0,
    maxDownVol: 0, volRatio: 0, aboveMA: null, detail: '피벗 없음',
  };
  if (closes.length < 15 || volumes.length < 15) return empty;

  const lookback = closes.slice(-12, -1);
  const volSlice  = volumes.slice(-12, -1);
  const downVols: number[] = [];
  for (let i = 1; i < lookback.length; i++) {
    if (lookback[i] < lookback[i - 1]) downVols.push(volSlice[i]);
  }
  if (downVols.length === 0) return { ...empty, detail: '하락일 없음 (상승 추세)' };
  const maxDownVol = Math.max(...downVols);

  for (const daysAgo of [0, 1]) {
    const idx     = closes.length - 1 - daysAgo;
    const price   = closes[idx];
    const prevPrice = closes[idx - 1];
    const vol     = volumes[idx];

    if (price <= prevPrice) continue;
    if (vol <= maxDownVol) continue;

    const maPriority = [
      { name: 'MA10',  val: mas.ma10  },
      { name: 'MA20',  val: mas.ma20  },
      { name: 'MA50',  val: mas.ma50  },
    ];
    const aboveMA = maPriority.find(m => !isNaN(m.val) && price > m.val)?.name ?? null;
    if (!aboveMA) continue;

    const volRatio = Math.round((vol / maxDownVol) * 100) / 100;
    return {
      isPocketPivot: true,
      daysAgo,
      volume:     vol,
      maxDownVol,
      volRatio,
      aboveMA,
      detail: `${daysAgo === 0 ? '오늘' : '어제'} 포켓 피벗 — ${aboveMA} 위 거래량 ${volRatio}x (하락일 최대 대비)`,
    };
  }
  return { ...empty, detail: '포켓 피벗 조건 미충족' };
}

// ── RS Line 다이버전스 ─────────────────────────────────────────────────────────
interface RSLineResult {
  rsLine:           number;
  rsLineTrend:      'UP' | 'DOWN' | 'FLAT';
  divergence:       'BULLISH' | 'BEARISH' | 'NONE';
  spyNewLow:        boolean;
  rsLineNewHigh:    boolean;
  rs3mChange:       number;
  detail:           string;
}

function calcRSLine(
  closes:    number[],
  spyCloses: number[]
): RSLineResult {
  const empty: RSLineResult = {
    rsLine: 0, rsLineTrend: 'FLAT', divergence: 'NONE',
    spyNewLow: false, rsLineNewHigh: false, rs3mChange: 0, detail: '데이터 부족',
  };

  const len = Math.min(closes.length, spyCloses.length);
  if (len < 30) return empty;

  const stockSlice = closes.slice(-len);
  const spySlice   = spyCloses.slice(-len);

  const rsLineArr = stockSlice.map((c, i) => (c / spySlice[i]) * 100);
  const currentRS = rsLineArr[rsLineArr.length - 1];

  const recentRS = rsLineArr.slice(-10);
  const prevRS   = rsLineArr.slice(-20, -10);
  const recentAvg = recentRS.reduce((a, b) => a + b, 0) / recentRS.length;
  const prevAvg   = prevRS.reduce((a, b)   => a + b, 0) / prevRS.length;
  const rsChange  = ((recentAvg - prevAvg) / prevAvg) * 100;
  const rsLineTrend: 'UP' | 'DOWN' | 'FLAT' =
    rsChange > 1 ? 'UP' : rsChange < -1 ? 'DOWN' : 'FLAT';

  const rs3mAgo    = rsLineArr[Math.max(0, rsLineArr.length - 63)];
  const rs3mChange = Math.round(((currentRS - rs3mAgo) / rs3mAgo) * 1000) / 10;

  const spyRecent20  = spySlice.slice(-20);
  const spyMin20     = Math.min(...spyRecent20.slice(0, -1));
  const spyNewLow    = spySlice[spySlice.length - 1] <= spyMin20 * 1.01;

  const rsRecent20   = rsLineArr.slice(-20);
  const rsMax20      = Math.max(...rsRecent20.slice(0, -1));
  const rsLineNewHigh = rsLineArr[rsLineArr.length - 1] >= rsMax20 * 0.98;

  let divergence: 'BULLISH' | 'BEARISH' | 'NONE' = 'NONE';
  let detail = '';

  if (spyNewLow && rsLineNewHigh) {
    divergence = 'BULLISH';
    detail = '🏆 RS 강세 다이버전스 — SPY 신저점인데 RS Line 강세 유지 (최우량 VCP 후보)';
  } else if (!spyNewLow && rsLineTrend === 'DOWN' && rsChange < -3) {
    divergence = 'BEARISH';
    detail = `⚠ RS 약세 다이버전스 — 시장 대비 상대강도 약화 (${rs3mChange > 0 ? '+' : ''}${rs3mChange}% 3개월)`;
  } else if (rsLineTrend === 'UP') {
    detail = `RS Line 상승 추세 — 시장 대비 강세 (3개월 ${rs3mChange > 0 ? '+' : ''}${rs3mChange}%)`;
  } else if (rsLineTrend === 'DOWN') {
    detail = `RS Line 하락 추세 — 시장 대비 약세 (3개월 ${rs3mChange > 0 ? '+' : ''}${rs3mChange}%)`;
  } else {
    detail = `RS Line 횡보 — 시장과 유사한 움직임 (3개월 ${rs3mChange > 0 ? '+' : ''}${rs3mChange}%)`;
  }

  return {
    rsLine:        Math.round(currentRS * 100) / 100,
    rsLineTrend,
    divergence,
    spyNewLow,
    rsLineNewHigh,
    rs3mChange,
    detail,
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
    else if (spyAboveMa200 && vix < 25) { regime = 'NEUTRAL'; label = '중립'; emoji = '🟡'; signalAdjust = 'BREAKOUT → SETUP 강등'; }
    else if (!spyAboveMa200 && vix < 35) { regime = 'CAUTION'; label = '약세주의'; emoji = '🟠'; signalAdjust = 'SETUP → WATCH 강등'; }
    else { regime = 'BEAR'; label = '약세장'; emoji = '🔴'; signalAdjust = '모든 진입 신호 → HOLD 강등'; }
    return { regime, spyPrice, spyMa200: Math.round(spyMa200 * 100) / 100, spyAboveMa200, spyMa200Dist, vix, vixLevel, qqqAboveMa200, label, emoji, signalAdjust };
  } catch { return null; }
}

// ── 시장 국면 신호 강등 ────────────────────────────────────────────────────────
// BREAKOUT → SETUP → WATCH → HOLD 단계별 강등
function applyRegimeFilter(signal: string, score: number, regime: MarketRegime): { adjustedSignal: string; adjustedScore: number; regimeNote: string | null } {
  if (regime === 'BULL') return { adjustedSignal: signal, adjustedScore: score, regimeNote: null };
  if (regime === 'NEUTRAL') {
    // 중립장: 즉시진입 → 진입대기로 한 단계 하향
    if (signal === 'BREAKOUT') return { adjustedSignal: 'SETUP', adjustedScore: Math.max(0, score - 5), regimeNote: '🟡 중립 시장 — BREAKOUT → SETUP 하향' };
    return { adjustedSignal: signal, adjustedScore: score, regimeNote: null };
  }
  if (regime === 'CAUTION') {
    // 약세주의: BREAKOUT → SETUP, SETUP → WATCH
    if (signal === 'BREAKOUT') return { adjustedSignal: 'SETUP', adjustedScore: Math.max(0, score - 10), regimeNote: '🟠 약세주의 — BREAKOUT → SETUP 하향 (SPY 200일선 하회)' };
    if (signal === 'SETUP') return { adjustedSignal: 'WATCH', adjustedScore: Math.max(0, score - 10), regimeNote: '🟠 약세주의 — SETUP → WATCH 하향 (SPY 200일선 하회)' };
    return { adjustedSignal: signal, adjustedScore: score, regimeNote: null };
  }
  if (regime === 'BEAR') {
    // 약세장: 모든 진입 신호 무효화
    if (signal === 'BREAKOUT' || signal === 'SETUP' || signal === 'WATCH') return { adjustedSignal: 'HOLD', adjustedScore: Math.max(0, score - 20), regimeNote: '🔴 약세장 — 진입 신호 무효화 (SPY 200일선 하회 + VIX 35+)' };
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
  // HOLD/SELL/STRONG_SELL은 진입구간 없음
  if (signal === 'HOLD' || signal === 'SELL' || signal === 'STRONG_SELL') return { entry: null, stopLoss: `$${r(price - 2 * atrAbs)}` };
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

    // ── 주봉 alignScore 0-100 스케일 ──────────────────────────────────────────
    let alignScore = 50;
    if (trend === 'UPTREND') alignScore += 20; else if (trend === 'DOWNTREND') alignScore -= 20;
    if (aboveAllMAs) alignScore += 15;
    if (rsi >= 40 && rsi <= 70) alignScore += 5;
    if (macdHist > 0) alignScore += 5;
    if (isEntry) alignScore += 5;
    alignScore = Math.max(0, Math.min(100, Math.round(alignScore)));

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

// ── 섹터/업종 조회 ─────────────────────────────────────────────────────────────
async function fetchSector(ticker: string): Promise<{ sector: string | null; industry: string | null }> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=assetProfile`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 86400 } }
    );
    if (!res.ok) return { sector: null, industry: null };
    const profile = (await res.json())?.quoteSummary?.result?.[0]?.assetProfile;
    return {
      sector:   profile?.sector   ?? null,
      industry: profile?.industry ?? null,
    };
  } catch { return { sector: null, industry: null }; }
}

interface QuoteData {
  ticker: string; price: number; change1d: number; ytdReturn: number;
  ma10: number; ma20: number; ma30: number; ma50: number; ma120: number; ma200: number;
  high52w: number; low52w: number; distFromHigh: number; momentum3m: number;
  rsi: number; macdHistogram: number; bbPosition: number; atrPct: number; atrAbs: number; volumeRatio: number;
  closes: number[]; volumes: number[];
  spyCloses: number[];
  vcp: VCPResult; pivot: { isBroken: boolean; distFromPivot: number; withinChaseLimit: boolean };
  obv: { trend: 'UP'|'DOWN'|'FLAT'; divergence: boolean; detail: string };
  shortInterest: { shortPct: number|null; shortRatio: number|null; squeezePotential: 'HIGH'|'MEDIUM'|'LOW'; shortDetail: string } | null;
  weekly: WeeklyData | null;
  breakout52w: { isBreakout: boolean; breakoutDay: number; prev52wHigh: number; breakoutPct: number; volConfirmed: boolean; detail: string };
  earningSurprise: { hasSurprise: boolean; surprisePct: number|null; peadSignal: boolean; detail: string } | null;
  sector: string | null;
  industry: string | null;
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
    const [shortInterest, weekly, earningSurprise, sectorData] = await Promise.all([fetchShortInterest(ticker), fetchWeeklyData(ticker), fetchEarningsSurprise(ticker), fetchSector(ticker)]);
    const breakout52w=detect52wBreakout(cs,vs), vcp=detectVCP(cs,vs,high52w), pivot=checkPivotBreakout(cs,vs,vcp.pivotPrice);
    const r = (n: number, d=2) => Math.round(n * 10**d) / 10**d;
    return { ticker, price:r(price), change1d:r(change1d,1), ytdReturn:r(ytdReturn,1), momentum3m:r(momentum3m,1), ma10:r(ma10), ma20:r(ma20), ma30:r(ma30), ma50:r(ma50), ma120:r(ma120), ma200:r(ma200), high52w:r(high52w), low52w:r(low52w), distFromHigh:r(distFromHigh,1), rsi:r(rsi,1), macdHistogram:r(histogram,4), bbPosition:Math.round(position), atrPct:r((atrVal/price)*100,2), atrAbs:r(atrVal,2), volumeRatio:r(volRatio,2), closes:cs.slice(-70), volumes:vs.slice(-15), spyCloses:[], vcp, pivot, obv, shortInterest, weekly, breakout52w, earningSurprise, sector: sectorData.sector, industry: sectorData.industry };
  } catch { return null; }
}

function analyzeStock(q: QuoteData, spyYtd: number, sectorAvgYtd: number, regime: MarketRegime) {
  const excessIdx=q.ytdReturn-spyYtd, excessSector=q.ytdReturn-sectorAvgYtd;
  const rsIndex=excessIdx>5?'STRONG':excessIdx<-5?'WEAK':'NEUTRAL';
  const rsSector=excessSector>3?'STRONG':excessSector<-3?'WEAK':'NEUTRAL';
  const mas={ma10:q.ma10,ma20:q.ma20,ma30:q.ma30,ma50:q.ma50,ma120:q.ma120};
  const { aboveCount, stackedBull, stackedBear, nearestSupport, nearest }=calcMAAlignment(q.price, mas);
  const ma50Status=q.price>q.ma50*1.01?'ABOVE':q.price<q.ma50*0.99?'BELOW':'AT';

  const pocketPivot = detectPocketPivot(q.closes, q.volumes, mas);
  const rsLine      = calcRSLine(q.closes, q.spyCloses);

  let pattern='NONE';
  if (q.vcp.isVCP && q.pivot.isBroken) pattern='BREAKOUT';
  else if (q.vcp.isVCP && !q.pivot.isBroken) pattern='CUP';
  else if (q.distFromHigh>=-20 && aboveCount>=2 && q.momentum3m>0) pattern='W_BASE';
  else if (aboveCount<=1 && q.momentum3m<-10) pattern='DOWNTREND';

  // ── 0-100점 가중치 스코어링 ───────────────────────────────────────────────────
  let score = 0;

  // ── A. 패턴·구조 (최대 30점) ─────────────────────────────────────────────────
  // VCP 점수 (내부 0-100 → 최대 15점)
  score += (q.vcp.score / 100) * 15;

  // 피봇 돌파 + 추격 한도 (최대 10점)
  if (q.pivot.isBroken && q.pivot.withinChaseLimit)        score += 10;
  else if (q.pivot.isBroken && !q.pivot.withinChaseLimit)  score += 3;   // 돌파했으나 추격 한도 초과
  else if (q.vcp.isVCP && q.pivot.distFromPivot >= -5)     score += 5;   // 피봇 5% 이내 대기

  // 52주 신고가 돌파 (최대 5점)
  if (q.breakout52w.isBreakout && q.breakout52w.breakoutDay === 0 && q.breakout52w.volConfirmed) score += 5;
  else if (q.breakout52w.isBreakout && q.breakout52w.breakoutDay === 0)  score += 3;
  else if (q.breakout52w.isBreakout && q.breakout52w.breakoutDay === 1)  score += 2;

  // ── B. 상대강도 (최대 25점) ──────────────────────────────────────────────────
  // RS Line (최대 15점) — Minervini 전략의 최우선 지표
  if      (rsLine.divergence === 'BULLISH')                               score += 15; // SPY 신저 + RS 신고 = 최우량
  else if (rsLine.rsLineTrend === 'UP' && rsLine.rs3mChange > 5)         score += 10;
  else if (rsLine.rsLineTrend === 'UP')                                   score += 6;
  else if (rsLine.rsLineTrend === 'FLAT')                                 score += 2;
  else if (rsLine.rsLineTrend === 'DOWN')                                 score -= 3;
  if      (rsLine.divergence === 'BEARISH')                               score -= 5;  // 추가 감점

  // RS vs 지수 YTD (최대 5점)
  if      (rsIndex === 'STRONG') score += 5;
  else if (rsIndex === 'WEAK')   score -= 5;

  // RS vs 섹터 (최대 5점)
  if      (rsSector === 'STRONG') score += 5;
  else if (rsSector === 'WEAK')   score -= 3;

  // ── C. MA 배열·추세 (최대 20점) ──────────────────────────────────────────────
  // MA 위 개수 0~5개 → 0~10점
  score += aboveCount * 2;

  // 정배열/역배열 (최대 5점)
  if (stackedBull) score += 5;
  if (stackedBear) score -= 5;

  // 주봉 추세·진입 타점 (최대 5점)
  if (q.weekly) {
    if      (q.weekly.trend === 'UPTREND' && q.weekly.isEntry)        score += 5; // 최고 타점
    else if (q.weekly.trend === 'UPTREND' && q.weekly.aboveAllMAs)    score += 3;
    else if (q.weekly.trend === 'UPTREND')                            score += 1;
    else if (q.weekly.trend === 'DOWNTREND')                          score -= 5;
  }

  // ── D. 모멘텀 지표 (최대 15점) ───────────────────────────────────────────────
  // RSI (최대 5점)
  if      (q.rsi >= 50 && q.rsi <= 70) score += 5;  // 황금 구간
  else if (q.rsi >= 45 && q.rsi <  50) score += 3;
  else if (q.rsi >= 70 && q.rsi <= 78) score += 2;  // 약간 과열
  else if (q.rsi >  78)                score -= 3;  // 과열 감점
  else if (q.rsi <  30)                score -= 3;  // 과매도 감점

  // 거래량 비율 (최대 4점)
  if      (q.volumeRatio >= 2.0) score += 4;
  else if (q.volumeRatio >= 1.5) score += 3;
  else if (q.volumeRatio >= 1.0) score += 1;
  else if (q.volumeRatio <  0.7) score -= 2;

  // MACD histogram (최대 3점)
  if      (q.macdHistogram > 0.05)  score += 3;
  else if (q.macdHistogram > 0)     score += 1;
  else if (q.macdHistogram < -0.05) score -= 2;
  else                              score -= 1;

  // OBV (최대 3점)
  if      (q.obv.trend === 'UP'   && !q.obv.divergence) score += 3;
  else if (q.obv.trend === 'DOWN' && !q.obv.divergence) score -= 2;
  if      (q.obv.divergence && q.obv.trend === 'DOWN')  score -= 3; // 베어리시 다이버전스 추가 감점

  // ── E. 촉매·특수 (최대 10점) ─────────────────────────────────────────────────
  // Pocket Pivot (최대 5점)
  if      (pocketPivot.isPocketPivot && pocketPivot.daysAgo === 0) score += 5;
  else if (pocketPivot.isPocketPivot && pocketPivot.daysAgo === 1) score += 3;

  // 어닝 서프라이즈 PEAD (최대 3점)
  if (q.earningSurprise?.peadSignal) {
    if ((q.earningSurprise.surprisePct ?? 0) > 15) score += 3;
    else                                           score += 2;
  }

  // 숏스퀴즈 (최대 2점, VCP 조합일 때만 가점 / 과도한 공매도는 감점)
  if      (q.shortInterest?.squeezePotential === 'HIGH' && q.vcp.isVCP) score += 2;
  else if (q.shortInterest?.shortPct && q.shortInterest.shortPct > 20)  score -= 2;

  // ── 최종 클램핑 0-100 ─────────────────────────────────────────────────────────
  score = Math.max(0, Math.min(100, Math.round(score)));

  const macdBull=q.macdHistogram>0, macdBear=q.macdHistogram<0, rsiOk=q.rsi>=45&&q.rsi<=75, volStrong=q.volumeRatio>1.5;

  // ── 신호 4단계 분류 (0-100 임계값) ───────────────────────────────────────────
  // BREAKOUT: 거래량 동반 실제 돌파 — 지금 당장 진입 가능한 종목만
  // SETUP:    피봇 근처 대기 or 패턴 완성 — 진입 준비 완료
  // WATCH:    좋은 종목이나 아직 셋업 미완성 — 관심 등록
  // HOLD:     기본값 — 보유 중이거나 조건 미달
  let signal='HOLD';

  // BREAKOUT: 거래량 확인된 진짜 돌파 신호
  if (q.breakout52w.isBreakout&&q.breakout52w.breakoutDay===0&&q.breakout52w.volConfirmed&&aboveCount>=3&&rsIndex!=='WEAK') signal='BREAKOUT';
  else if (q.vcp.isVCP&&q.pivot.isBroken&&q.pivot.withinChaseLimit&&volStrong&&aboveCount>=3) signal='BREAKOUT';
  else if (score>=85&&aboveCount>=4&&stackedBull&&macdBull&&rsiOk&&volStrong) signal='BREAKOUT';
  // Pocket Pivot 오늘 + RS 강세 다이버전스 = 최우량 BREAKOUT
  else if (pocketPivot.isPocketPivot&&pocketPivot.daysAgo===0&&rsLine.divergence==='BULLISH'&&aboveCount>=3) signal='BREAKOUT';

  // SETUP: 패턴 완성 or 피봇 5% 이내 대기 — 아직 돌파 전
  else if (q.vcp.isVCP&&!q.pivot.isBroken&&q.pivot.distFromPivot>=-5&&aboveCount>=3&&rsIndex!=='WEAK') signal='SETUP';
  else if (pocketPivot.isPocketPivot&&aboveCount>=3&&macdBull) signal='SETUP';
  else if (score>=70&&aboveCount>=3&&rsIndex!=='WEAK') signal='SETUP';

  // WATCH: 좋은 종목이나 셋업 미완성 — 관심 등록만
  else if (score>=50&&aboveCount>=2&&rsIndex!=='WEAK') signal='WATCH';

  // SELL / STRONG_SELL
  else if (score<=15||(aboveCount===0&&macdBear&&rsIndex==='WEAK')) signal='STRONG_SELL';
  else if (score<=35||(aboveCount<=1&&rsIndex==='WEAK')) signal='SELL';

  const { adjustedSignal, adjustedScore, regimeNote }=applyRegimeFilter(signal, score, regime);
  signal=adjustedSignal; score=adjustedScore;

  const confidence=score>=90||score<=10?'HIGH':score>=70||score<=35?'MEDIUM':'LOW';
  const { entry, stopLoss }=calcEntryZone(q.price, mas, q.atrAbs, signal, q.distFromHigh, q.vcp, q.pivot);
  const support=nearestSupport?`$${Math.round(nearestSupport*100)/100} (${nearest})`:`$${q.ma50}`;
  const resistance=`$${q.high52w}`;
  const { rrRatio, rrGrade, riskAmt, rewardAmt, rrLabel } = calcRRRatio(entry, stopLoss, resistance, q.price);

  const trailingStop = calcTrailingStop(q.price, q.atrAbs, entry);
  const pullbackForSplit = {
    isPullback:    (q as unknown as Record<string, unknown>).pullback_is as boolean ?? false,
    supportPrice:  null as number | null,
    nearestSupport: null as string | null,
  };
  // BREAKOUT / SETUP만 분할 매수 구간 계산
  const splitZones = (signal === 'BREAKOUT' || signal === 'SETUP')
    ? calcSplitZones(q.price, mas, q.atrAbs, q.vcp, pullbackForSplit)
    : null;

  const maStatus=`MA ${aboveCount}/5개 위${stackedBull?' (정배열)':stackedBear?' (역배열)':''}`;
  const signalWord={ BREAKOUT:'즉시진입', SETUP:'진입대기', WATCH:'관심등록', HOLD:'관망', SELL:'매도', STRONG_SELL:'즉시매도' }[signal]??signal;
  const summary=`[${signalWord}] YTD ${q.ytdReturn>0?'+':''}${q.ytdReturn}% (S&P500 대비 ${excessIdx>0?'+':''}${Math.round(excessIdx*10)/10}%). ${maStatus}. RSI ${q.rsi} · MACD ${macdBull?'상승':'하락'} · 거래량 ${q.volumeRatio}x.`;

  const cautions: string[]=[];
  if (regimeNote) cautions.push(regimeNote);
  if (rrGrade==='POOR'&&(signal==='BREAKOUT'||signal==='SETUP'||signal==='WATCH')) cautions.push(`R/R ${rrLabel} — 리스크 대비 수익 불리, 진입 재검토`);
  if (q.rsi>78) cautions.push(`RSI ${q.rsi} 과열`);
  if (q.bbPosition>90) cautions.push('BB 상단 근접');
  if (q.distFromHigh>-3&&(signal==='BREAKOUT'||signal==='SETUP')&&!q.pivot.isBroken) cautions.push('52주 고점 근접 — 돌파 확인 후 진입');
  if (q.pivot.isBroken&&!q.pivot.withinChaseLimit) cautions.push(`피봇 돌파 후 ${q.pivot.distFromPivot}% — 추격 한도 초과`);
  if (q.volumeRatio<0.6) cautions.push('거래량 부족');
  if (rsLine.divergence==='BEARISH') cautions.push(rsLine.detail);
  if (q.obv.divergence) cautions.push(q.obv.detail);
  if (q.weekly?.trend==='DOWNTREND') cautions.push('주봉 하락추세');
  if (q.shortInterest?.shortPct&&q.shortInterest.shortPct>20) cautions.push(q.shortInterest.shortDetail);
  if (q.shortInterest?.squeezePotential==='HIGH'&&(signal==='BREAKOUT'||signal==='SETUP')) cautions.push('⚡ 숏스퀴즈 가능성');
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
    rr_ratio:rrRatio, rr_grade:rrGrade, rr_risk:riskAmt, rr_reward:rewardAmt, rr_label:rrLabel,
    sector:   q.sector   ?? null,
    industry: q.industry ?? null,
    pocket_pivot:          pocketPivot.isPocketPivot,
    pocket_pivot_days_ago: pocketPivot.daysAgo,
    pocket_pivot_vol_ratio: pocketPivot.volRatio,
    pocket_pivot_above_ma:  pocketPivot.aboveMA,
    pocket_pivot_detail:    pocketPivot.detail,
    rs_line:               rsLine.rsLine,
    rs_line_trend:         rsLine.rsLineTrend,
    rs_line_divergence:    rsLine.divergence,
    rs_line_new_high:      rsLine.rsLineNewHigh,
    rs_line_spy_new_low:   rsLine.spyNewLow,
    rs_line_3m_change:     rsLine.rs3mChange,
    rs_line_detail:        rsLine.detail,
    trail_initial_stop:  trailingStop.initialStop,
    trail_stop_10:       trailingStop.trailStop10,
    trail_stop_20:       trailingStop.trailStop20,
    trail_stop_30:       trailingStop.trailStop30,
    trail_multiplier:    trailingStop.atrMultiplier,
    trail_break_even:    trailingStop.breakEvenStop,
    trail_detail:        trailingStop.detail,
    split_entry1:        splitZones?.entry1 ?? null,
    split_entry2:        splitZones?.entry2 ?? null,
    split_entry3:        splitZones?.entry3 ?? null,
    split_exit1:         splitZones?.exit1  ?? null,
    split_exit2:         splitZones?.exit2  ?? null,
    split_exit3:         splitZones?.exit3  ?? null,
    split_avg_entry:     splitZones?.avgEntry ?? null,
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
  const spyClosesForRS = spyQuote?.closes ?? [];
  const stocks=validStocks.map(q => {
    q.spyCloses = spyClosesForRS;
    return analyzeStock(q, spyYtd, sectorAvgYtd, regime);
  });

  const ytdValues=validStocks.map(s=>s.ytdReturn).sort((a,b)=>a-b), totalCount=ytdValues.length;
  for (let i=0;i<stocks.length;i++) {
    const ytd=validStocks[i]?.ytdReturn??0, rank=ytdValues.filter(v=>v<=ytd).length;
    const rsRank=Math.round((rank/totalCount)*100);
    (stocks[i] as Record<string,unknown>).rs_rank=rsRank;
    // BREAKOUT/SETUP/WATCH에서만 RS 순위 경고
    if (rsRank<10&&(stocks[i].signal==='BREAKOUT'||stocks[i].signal==='SETUP'||stocks[i].signal==='WATCH')) {
      (stocks[i] as Record<string,unknown>).rs_rank_warning=true;
      if (stocks[i].confidence==='HIGH') (stocks[i] as Record<string,unknown>).confidence='MEDIUM';
    }
    if (rsRank>=90&&(stocks[i].signal==='BREAKOUT'||stocks[i].signal==='SETUP')&&stocks[i].confidence==='MEDIUM') (stocks[i] as Record<string,unknown>).confidence='HIGH';
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
          if (isSemi) { (s as Record<string,unknown>).sector_ytd=Math.round(soxxYtd*10)/10; if (soxxYtd<-10&&(s.signal==='BREAKOUT'||s.signal==='SETUP')) { if (s.confidence==='HIGH') (s as Record<string,unknown>).confidence='MEDIUM'; (s as Record<string,unknown>).sector_warning='반도체 섹터 하락 중 — 신뢰도 하향'; } }
        }
      }
    }
  } catch {}

  const breakouts=stocks.filter(s=>s.signal==='BREAKOUT').map(s=>s.ticker);
  const setups=stocks.filter(s=>s.signal==='SETUP').map(s=>s.ticker);
  const watches=stocks.filter(s=>s.signal==='WATCH').map(s=>s.ticker);
  const vcpPicks=stocks.filter(s=>s.vcp_is_vcp).sort((a,b)=>b.vcp_score-a.vcp_score).slice(0,3).map(s=>s.ticker);
  const regimeStr=marketRegimeData?`${marketRegimeData.emoji} 시장 국면: ${marketRegimeData.label} (SPY ${marketRegimeData.spyAboveMa200?'200일선 위':'200일선 아래'} ${marketRegimeData.spyMa200Dist>0?'+':''}${marketRegimeData.spyMa200Dist}% / VIX ${marketRegimeData.vix}). `:'';
  const market_context=regimeStr+`섹터 YTD 평균 ${sectorAvgYtd>0?'+':''}${Math.round(sectorAvgYtd*10)/10}% vs S&P500 ${spyYtd>0?'+':''}${Math.round(spyYtd*10)/10}%. `+(breakouts.length>0?`즉시진입: ${breakouts.slice(0,5).join(', ')}. `:'')+(setups.length>0?`진입대기: ${setups.slice(0,5).join(', ')}. `:'')+(watches.length>0?`관심등록: ${watches.slice(0,5).join(', ')}. `:'')+(vcpPicks.length>0?`VCP 패턴 감지: ${vcpPicks.join(', ')}.`:'');

  return NextResponse.json({ stocks, market_context, analyzed_at:new Date().toISOString(), market_regime:marketRegimeData??null });
}
