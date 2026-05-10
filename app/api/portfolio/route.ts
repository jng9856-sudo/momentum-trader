import { NextRequest, NextResponse } from 'next/server';

// ── Math helpers ──────────────────────────────────────────────────────────────
function calcMA(closes: number[], period: number): number {
  const sl = closes.slice(-period);
  return sl.length < period ? NaN : sl.reduce((a, b) => a + b, 0) / period;
}
function calcEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1); let prev = data[0];
  return data.map(d => { prev = d * k + prev * (1 - k); return prev; });
}
function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  const ch = closes.slice(1).map((c, i) => c - closes[i]);
  const gains = ch.map(c => c > 0 ? c : 0), losses = ch.map(c => c < 0 ? -c : 0);
  let ag = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let al = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < ch.length; i++) {
    ag = (ag * (period - 1) + gains[i]) / period;
    al = (al * (period - 1) + losses[i]) / period;
  }
  return al === 0 ? 100 : Math.round((100 - 100 / (1 + ag / al)) * 10) / 10;
}
function calcMACDHist(closes: number[]): { histogram: number; prevHistogram: number; historyHist: number[] } {
  const e12 = calcEMA(closes, 12), e26 = calcEMA(closes, 26);
  const line = e12.map((v, i) => v - e26[i]);
  const sig  = calcEMA(line.slice(-60), 9);
  const histLine = line.slice(-sig.length).map((v, i) => v - sig[i]);
  return {
    histogram:     Math.round((line[line.length - 1] - sig[sig.length - 1]) * 1000) / 1000,
    prevHistogram: Math.round((line[line.length - 2] - sig[sig.length - 2]) * 1000) / 1000,
    historyHist:   histLine.slice(-10),
  };
}
function calcATR(hs: number[], ls: number[], cs: number[], period = 14): number {
  const trs: number[] = [];
  for (let i = 1; i < hs.length; i++)
    trs.push(Math.max(hs[i] - ls[i], Math.abs(hs[i] - cs[i - 1]), Math.abs(ls[i] - cs[i - 1])));
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}
function calcADX(hs: number[], ls: number[], cs: number[], period = 14): number {
  if (hs.length < period + 2) return 0;
  const trList: number[] = [], plusDM: number[] = [], minusDM: number[] = [];
  for (let i = 1; i < hs.length; i++) {
    trList.push(Math.max(hs[i] - ls[i], Math.abs(hs[i] - cs[i - 1]), Math.abs(ls[i] - cs[i - 1])));
    const upMove = hs[i] - hs[i - 1], downMove = ls[i - 1] - ls[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  const smooth = (arr: number[]) => {
    let val = arr.slice(0, period).reduce((a, b) => a + b, 0);
    const out = [val];
    for (let i = period; i < arr.length; i++) { val = val - val / period + arr[i]; out.push(val); }
    return out;
  };
  const sTR = smooth(trList), sPDM = smooth(plusDM), sMDM = smooth(minusDM);
  const dx: number[] = [];
  for (let i = 0; i < sTR.length; i++) {
    const pdi = sTR[i] ? (sPDM[i] / sTR[i]) * 100 : 0;
    const mdi = sTR[i] ? (sMDM[i] / sTR[i]) * 100 : 0;
    const sum = pdi + mdi;
    dx.push(sum ? (Math.abs(pdi - mdi) / sum) * 100 : 0);
  }
  return Math.round(dx.slice(-period).reduce((a, b) => a + b, 0) / period * 10) / 10;
}

// ── RSI Divergence ────────────────────────────────────────────────────────────
function detectRSIDivergence(closes: number[], lookback = 20): {
  bearish: boolean; bullish: boolean; detail: string;
} {
  if (closes.length < lookback + 15) return { bearish: false, bullish: false, detail: '데이터 부족' };
  const rsiSeries: number[] = [];
  for (let i = closes.length - lookback - 14; i <= closes.length - 1; i++)
    rsiSeries.push(calcRSI(closes.slice(0, i + 1), 14));
  const recentCloses = closes.slice(-lookback);
  const recentRSI    = rsiSeries.slice(-lookback);
  const priceHighs: { idx: number; val: number }[] = [];
  const priceLows:  { idx: number; val: number }[] = [];
  for (let i = 2; i < recentCloses.length - 2; i++) {
    if (recentCloses[i] > recentCloses[i-1] && recentCloses[i] > recentCloses[i+1]) priceHighs.push({ idx: i, val: recentCloses[i] });
    if (recentCloses[i] < recentCloses[i-1] && recentCloses[i] < recentCloses[i+1]) priceLows.push({ idx: i, val: recentCloses[i] });
  }
  let bearish = false, bullish = false, detail = '다이버전스 없음';
  if (priceHighs.length >= 2) {
    const [prev, last] = priceHighs.slice(-2);
    if (last.val > prev.val && recentRSI[last.idx] < recentRSI[prev.idx] - 3) {
      bearish = true;
      detail = `베어리시 다이버전스: 주가 신고가(${Math.round(last.val)}) but RSI 하락(${Math.round(recentRSI[last.idx])} < ${Math.round(recentRSI[prev.idx])})`;
    }
  }
  if (priceLows.length >= 2) {
    const [prev, last] = priceLows.slice(-2);
    if (last.val < prev.val && recentRSI[last.idx] > recentRSI[prev.idx] + 2) {
      bullish = true;
      detail = `불리시 다이버전스: 주가 신저가(${Math.round(last.val)}) but RSI 상승`;
    }
  }
  return { bearish, bullish, detail };
}

// ── Volume divergence ─────────────────────────────────────────────────────────
function detectVolumeDivergence(closes: number[], volumes: number[], volAvg20: number, lookback = 5): {
  bearish: boolean; detail: string;
} {
  const recentC = closes.slice(-lookback);
  const recentV = volumes.slice(-lookback);
  const priceAtHigh = recentC[recentC.length - 1] >= Math.max(...recentC) * 0.995;
  const volFading   = recentV[recentV.length - 1] < volAvg20 * 0.70;
  const bearish = priceAtHigh && volFading;
  const ratioVsAvg = Math.round(recentV[recentV.length - 1] / volAvg20 * 100);
  return {
    bearish,
    detail: bearish
      ? `신고가 갱신 but 거래량 급감 (20일평균 대비 ${ratioVsAvg}%) — 기관 이탈 가능성`
      : '거래량 정상',
  };
}

// ── MACD contraction ──────────────────────────────────────────────────────────
function detectMACDContraction(histSeries: number[]): { contracting: boolean; detail: string } {
  if (histSeries.length < 4) return { contracting: false, detail: '데이터 부족' };
  const recent = histSeries.slice(-4);
  const allPositive  = recent.every(v => v > 0);
  const contracting  = allPositive &&
    recent[recent.length - 1] < recent[recent.length - 2] &&
    recent[recent.length - 2] < recent[recent.length - 3];
  return {
    contracting,
    detail: contracting
      ? `MACD 히스토그램 3연속 수축 (${recent.slice(-3).map(v => v.toFixed(3)).join(' → ')}) — 상승 모멘텀 약화`
      : 'MACD 정상',
  };
}

// ── Upside potential ──────────────────────────────────────────────────────────
function calcUpsidePotential(params: {
  rsi: number; adx: number; adxRising: boolean; macdHist: number; macdContracting: boolean;
  macdExpanding: boolean; rsiBearDiv: boolean; volBearDiv: boolean; aboveCount: number;
  distFromHigh: number; bbPosition: number; volRatio: number;
}): { score: number; label: string } {
  let score = 50;
  if (params.rsi >= 45 && params.rsi <= 72) score += 10;
  else if (params.rsi > 85) score -= 25;
  else if (params.rsi > 80) score -= 15;
  else if (params.rsi > 72) score -= 5;
  else if (params.rsi < 40) score -= 15;

  if (params.adx >= 25 && params.adx <= 60) score += 10;
  else if (params.adx > 60 && params.adxRising) score += 5;
  else if (params.adx > 60 && !params.adxRising) score -= 10;
  else if (params.adx < 20) score -= 5;

  // MACD 확장/수축 구분
  if (params.macdHist > 0 && params.macdExpanding)   score += 15;
  else if (params.macdHist > 0 && !params.macdContracting) score += 8;
  else if (params.macdContracting) score -= 18;
  else if (params.macdHist < 0) score -= 15;

  if (params.rsiBearDiv) score -= 20;
  if (params.volBearDiv) score -= 15;
  score += (params.aboveCount - 2) * 5;
  if (params.distFromHigh < -20) score -= 10;
  if (params.distFromHigh > -5) score += 3;
  if (params.bbPosition > 90) score -= 10;
  else if (params.bbPosition > 80) score -= 5;
  else if (params.bbPosition < 40) score -= 5;
  if (params.volRatio > 1.3) score += 5;

  score = Math.max(0, Math.min(100, Math.round(score)));
  const label = score >= 70 ? '상승 여력 충분' : score >= 50 ? '보통' : score >= 30 ? '상승 여력 제한' : '소진 임박';
  return { score, label };
}

// ── Downside Risk Calculator ──────────────────────────────────────────────────
function calcDownsideRisk(
  currentPrice: number,
  avgPrice: number,
  ma20: number,
  ma50: number,
  ma120: number,
  atr: number,
  low52w: number,
  pnlPct: number,
): {
  toStopLoss: number;
  toMA20: number | null;
  toMA50: number | null;
  toMA120: number | null;
  worstCase: number;
  fromAvg: number;
  label: string;
  detail: string;
} {
  const r = (n: number) => Math.round(n * 10) / 10;
  const pct = (target: number) => r(((target - currentPrice) / currentPrice) * 100);
  const stopLoss = currentPrice - 2 * atr;

  const toStopLoss = pct(stopLoss);
  const toMA20     = !isNaN(ma20)  && ma20  < currentPrice ? pct(ma20)  : null;
  const toMA50     = !isNaN(ma50)  && ma50  < currentPrice ? pct(ma50)  : null;
  const toMA120    = !isNaN(ma120) && ma120 < currentPrice ? pct(ma120) : null;
  const worstCase  = pct(low52w);
  const fromAvg    = r(((stopLoss - avgPrice) / avgPrice) * 100);

  // 가장 가까운 지지선
  const nearestSupport = [
    !isNaN(ma20)  ? ma20  : null,
    !isNaN(ma50)  ? ma50  : null,
    !isNaN(ma120) ? ma120 : null,
  ].filter((v): v is number => v !== null && v < currentPrice)
   .sort((a, b) => b - a)[0];

  const nearestPct = nearestSupport ? pct(nearestSupport) : toStopLoss;

  const label = nearestPct > -5 ? '지지선 근접 — 위험 낮음'
    : nearestPct > -10 ? '1차 지지선까지 -10% 내'
    : nearestPct > -20 ? '중기 조정 가능'
    : '구조적 하락 위험';

  const detail = `ATR 손절 시 ${toStopLoss}% / 가장 가까운 지지선 ${nearestPct}% / 52주 저점까지 ${worstCase}%${pnlPct < 0 ? ` / 평균매수가 기준 추가 손실 ${fromAvg}%` : ''}`;

  return { toStopLoss, toMA20, toMA50, toMA120, worstCase, fromAvg, label, detail };
}

// ── Hold Regret / Sell Regret ─────────────────────────────────────────────────
function calcRegretAnalysis(params: {
  rsi: number; macd: number; prevMacd: number; macdContracting: boolean; macdExpanding: boolean;
  adx: number; adxRising: boolean; volRatio: number; aboveCount: number;
  distFromHigh: number; pnlPct: number; rsiDiv: { bearish: boolean; bullish: boolean };
  volDiv: { bearish: boolean }; strongUptrend: boolean; action: string;
  fibTargets: { remainingUpside: number; nextTargetLabel: string; nextTarget: number };
  downsideRisk: { toStopLoss: number; toMA50: number | null };
  upsideScore: number;
}): { holdRegret: string[]; sellRegret: string[] } {
  const holdRegret: string[] = [];  // 지금 팔면 아쉬운 이유
  const sellRegret: string[] = [];  // 지금 안팔면 위험한 이유

  // ── holdRegret (아직 달리는 중 근거) ──────────────────────────────────────
  if (params.macdExpanding && params.macd > 0)
    holdRegret.push(`MACD 히스토그램 확장 중 — 상승 모멘텀 가속 구간`);
  else if (params.macd > 0 && !params.macdContracting)
    holdRegret.push(`MACD 양수 유지 — 상승 모멘텀 지속 중`);

  if (params.adx >= 25 && params.adxRising)
    holdRegret.push(`ADX ${params.adx} 상승 중 — 추세 강화 구간 (매도 후 재진입 어려움)`);
  else if (params.adx >= 40 && !params.adxRising)
    holdRegret.push(`ADX ${params.adx} — 여전히 강한 추세 (소진 신호 미확인)`);

  if (params.aboveCount >= 4)
    holdRegret.push(`전체 이동평균선 정배열 — 추세 구조 이상 없음`);
  else if (params.aboveCount >= 3)
    holdRegret.push(`이동평균선 ${params.aboveCount}/4개 위 — 추세 지속 중`);

  if (params.distFromHigh > -3)
    holdRegret.push(`52주 신고가 근접(${params.distFromHigh}%) — 모멘텀 주식은 신고가 돌파 후 추가 상승 빈번`);

  if (params.volRatio >= 1.5)
    holdRegret.push(`거래량 ${params.volRatio}x — 강한 매수세 진입 중, 섣부른 매도 시 손에서 벗어남`);

  if (params.rsiDiv.bullish)
    holdRegret.push(`RSI 불리시 다이버전스 — 저점 지지 강화 신호`);

  if (params.fibTargets.remainingUpside > 5)
    holdRegret.push(`다음 목표가(${params.fibTargets.nextTargetLabel} $${params.fibTargets.nextTarget})까지 +${params.fibTargets.remainingUpside}% 여력`);

  if (params.pnlPct > 0 && params.pnlPct < 15 && params.upsideScore >= 60)
    holdRegret.push(`현재 수익 +${params.pnlPct.toFixed(1)}% — 목표 수익 미도달, 추세 유지 중`);

  // ── sellRegret (버텼다가 손해 볼 근거) ────────────────────────────────────
  if (params.rsiDiv.bearish)
    sellRegret.push(`RSI 베어리시 다이버전스 확인 — 역사적으로 고점 이후 10~25% 하락 패턴`);

  if (params.macdContracting)
    sellRegret.push(`MACD 히스토그램 수축 중 — 모멘텀 소진, 추세 전환 선행 신호`);
  else if (params.macd < 0)
    sellRegret.push(`MACD 음전환 — 하락 모멘텀 진입, 반등 시 매도 기회 놓칠 수 있음`);

  if (params.adx > 60 && !params.adxRising)
    sellRegret.push(`ADX ${params.adx} 하락 반전 — 과열된 추세는 급격히 소진될 수 있음`);

  if (params.rsi > 85)
    sellRegret.push(`RSI ${params.rsi} 극도 과열 — 이 수준에서 버티다 급락 시 손절 타이밍 놓침`);
  else if (params.rsi > 78 && !params.strongUptrend)
    sellRegret.push(`RSI ${params.rsi} 과열 + 추세 미확인 — 조정 시 -10~15% 낙폭 가능`);

  if (params.volDiv.bearish)
    sellRegret.push(`거래량 다이버전스 — 신고가인데 기관 이탈 중, 개인만 남은 천장 패턴`);

  if (params.downsideRisk.toStopLoss < -8)
    sellRegret.push(`손절까지 ${params.downsideRisk.toStopLoss}% — 버텨도 크게 빠질 경우 손실 확대 위험`);

  if (params.pnlPct > 20 && params.rsi > 78 && !params.macdExpanding)
    sellRegret.push(`수익 +${params.pnlPct.toFixed(1)}% 달성 + 모멘텀 약화 — 욕심이 수익을 반납시킬 수 있음`);

  if (params.aboveCount <= 1)
    sellRegret.push(`MA 대부분 이탈 — 추세 붕괴 진행 중, 반등 시 매도 기회`);

  return { holdRegret, sellRegret };
}

// ── Trailing Stop ─────────────────────────────────────────────────────────────
function calcTrailingStop(
  currentPrice: number, avgPrice: number, atr: number, high52w: number, pnlPct: number,
): {
  trail2xATR: number; trail3xATR: number;
  trailPct8: number; trailPct15: number;
  highWaterMark: number;
  recommended: { price: number; label: string; reasoning: string };
} {
  const r = (n: number) => Math.round(n * 100) / 100;
  const trail2xATR    = r(currentPrice - 2 * atr);
  const trail3xATR    = r(currentPrice - 3 * atr);
  const trailPct8     = r(currentPrice * 0.92);
  const trailPct15    = r(currentPrice * 0.85);
  const highWaterMark = r(high52w * 0.90);

  let recommended: { price: number; label: string; reasoning: string };
  if (pnlPct >= 30)      recommended = { price: trailPct8,  label: '8% 트레일링 스탑',  reasoning: `수익 +${pnlPct.toFixed(1)}% — 수익 보호 우선. 현재가 -8% 하락 시 즉시 매도` };
  else if (pnlPct >= 15) recommended = { price: trail2xATR, label: 'ATR 2x 트레일링', reasoning: `수익 +${pnlPct.toFixed(1)}% — 변동성 기반 트레일링. 하락 시 자동 손절` };
  else if (pnlPct >= 0)  recommended = { price: trail3xATR, label: 'ATR 3x 트레일링', reasoning: `수익 +${pnlPct.toFixed(1)}% — 추세 유지 공간 확보. 조정 허용 후 홀딩` };
  else                   recommended = { price: Math.max(trail2xATR, r(avgPrice * 0.93)), label: '손절 우선', reasoning: `손실 중 — 평균매수가 대비 손절 엄수. 추가 손실 방지` };

  return { trail2xATR, trail3xATR, trailPct8, trailPct15, highWaterMark, recommended };
}

// ── Fibonacci Targets ─────────────────────────────────────────────────────────
function calcFibTargets(avgPrice: number, high52w: number, low52w: number, currentPrice: number) {
  const r = (n: number) => Math.round(n * 100) / 100;
  const range = high52w - low52w;
  const t1_618 = r(avgPrice + range * 0.618);
  const t2_100 = r(avgPrice + range * 1.0);
  const t3_162 = r(avgPrice + range * 1.618);
  const t10 = r(avgPrice * 1.10), t20 = r(avgPrice * 1.20), t30 = r(avgPrice * 1.30);
  const pnlPct = ((currentPrice - avgPrice) / avgPrice) * 100;
  return {
    fib618: t1_618, fib100: t2_100, fib162: t3_162,
    pct10: t10, pct20: t20, pct30: t30,
    nextTarget:      pnlPct < 10 ? t10 : pnlPct < 20 ? t20 : pnlPct < 30 ? t30 : t1_618,
    nextTargetLabel: pnlPct < 10 ? '+10%' : pnlPct < 20 ? '+20%' : pnlPct < 30 ? '+30%' : 'Fib 61.8%',
    remainingUpside: r(((t1_618 - currentPrice) / currentPrice) * 100),
  };
}

// ── Yahoo Finance fetch ───────────────────────────────────────────────────────
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
  if (cs.length < 50) return null;

  const price = cs[cs.length - 1];
  const ma10  = calcMA(cs, 10), ma20 = calcMA(cs, 20), ma50 = calcMA(cs, 50), ma120 = calcMA(cs, 120);
  const rsi   = calcRSI(cs, 14);
  const { histogram: macd, prevHistogram, historyHist } = calcMACDHist(cs);
  const macdExpanding = macd > prevHistogram;
  const atr   = calcATR(hs.slice(-20), ls.slice(-20), cs.slice(-20));
  const adx   = calcADX(hs.slice(-35), ls.slice(-35), cs.slice(-35));
  const adxPrev = calcADX(hs.slice(-40, -5), ls.slice(-40, -5), cs.slice(-40, -5));
  const adxRising = adx > adxPrev + 1;
  const high52w = Math.max(...hs), low52w = Math.min(...ls);
  const volAvg20 = vs.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
  const volRatio = volAvg20 > 0 ? Math.round((vs[vs.length - 1] / volAvg20) * 100) / 100 : 1;
  const mas = [ma10, ma20, ma50, ma120].filter(m => !isNaN(m));
  const aboveCount = mas.filter(m => price > m).length;
  const distFromHigh = ((price - high52w) / high52w) * 100;
  const sl = cs.slice(-20), mid = sl.reduce((a, b) => a + b, 0) / 20;
  const std  = Math.sqrt(sl.reduce((a, b) => a + (b - mid) ** 2, 0) / 20);
  const bbPos = std > 0 ? Math.round(((price - (mid - 2 * std)) / (4 * std)) * 100) : 50;
  const rsiDiv  = detectRSIDivergence(cs);
  const volDiv  = detectVolumeDivergence(cs, vs, volAvg20);
  const macdCon = detectMACDContraction(historyHist);
  const upside  = calcUpsidePotential({
    rsi, adx, adxRising, macdHist: macd, macdContracting: macdCon.contracting,
    macdExpanding, rsiBearDiv: rsiDiv.bearish, volBearDiv: volDiv.bearish,
    aboveCount, distFromHigh, bbPosition: bbPos, volRatio,
  });

  return {
    price, ma10, ma20, ma50, ma120, rsi, macd, macdExpanding, atr,
    high52w, low52w, volRatio, volAvg20,
    adx, adxRising, aboveCount, distFromHigh, bbPos,
    rsiDiv, volDiv, macdCon, upside, historyHist,
  };
}

// ── Route ─────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let holdings: { ticker: string; avgPrice: number; shares: number }[];
  try {
    const body = await req.json(); holdings = body.holdings;
    if (!Array.isArray(holdings) || holdings.length === 0) throw new Error('invalid');
  } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }

  const results = await Promise.all(holdings.map(async (h) => {
    const d = await fetchData(h.ticker);
    if (!d) return { ticker: h.ticker, error: '데이터 없음' };
    const r = (n: number, dec = 2) => isNaN(n) ? 0 : Math.round(n * 10 ** dec) / 10 ** dec;

    const { price, ma10, ma20, ma50, ma120, rsi, macd, macdExpanding, atr,
            high52w, low52w, volRatio,
            adx, adxRising, aboveCount, distFromHigh, bbPos,
            rsiDiv, volDiv, macdCon, upside } = d;

    const avgPrice = h.avgPrice, shares = h.shares ?? 0;
    const pnlPct = r(((price - avgPrice) / avgPrice) * 100);
    const pnlAbs = r((price - avgPrice) * shares);

    const stopMA20 = !isNaN(ma20) ? r(ma20 * 0.99) : null;
    const stopMA50 = !isNaN(ma50) ? r(ma50 * 0.98) : null;
    const stopATR  = r(price - 2.0 * atr);
    const recommendedStop = !isNaN(ma20) && price > ma20
      ? { price: stopMA20, label: 'MA20 기준' }
      : !isNaN(ma50) && price > ma50
        ? { price: stopMA50, label: 'MA50 기준' }
        : { price: stopATR, label: 'ATR 2x' };

    const target1 = r(avgPrice * 1.10);
    const target2 = r(avgPrice * 1.20);
    const target3 = r(Math.min(high52w * 1.05, avgPrice * 1.35));

    // ── Sell / Hold signals ───────────────────────────────────────────────────
    const sellSignals: { text: string; severity: 'high' | 'medium' | 'low' }[] = [];
    const holdSignals: string[] = [];

    const macdPositive  = macd > 0 && !macdCon.contracting;
    const allMAsAligned = aboveCount === 4;
    const strongUptrend = macdPositive && allMAsAligned;

    if (rsiDiv.bearish) sellSignals.push({ text: `RSI 베어리시 다이버전스 — ${rsiDiv.detail}`, severity: 'high' });
    if (rsiDiv.bullish) holdSignals.push('RSI 불리시 다이버전스 — 저점 지지 강화');

    if (macdCon.contracting) {
      sellSignals.push({ text: macdCon.detail, severity: 'high' });
    } else if (macd > 0) {
      holdSignals.push(macdExpanding
        ? 'MACD 히스토그램 확장 중 — 상승 모멘텀 가속'
        : 'MACD 히스토그램 양수 유지 — 상승 모멘텀 지속');
    }

    if (adx > 60 && !adxRising) {
      sellSignals.push({ text: `ADX ${adx} 하락 반전 — 추세 소진 시작`, severity: 'medium' });
    } else if (adx > 60 && adxRising) {
      holdSignals.push(`ADX ${adx} 상승 중 — 강한 추세 지속`);
    } else if (adx >= 25 && adx <= 60) {
      holdSignals.push(`ADX ${adx} — 건전한 추세 강도 유지`);
    } else if (adx < 20) {
      sellSignals.push({ text: `ADX ${adx} — 추세 약화 (20 미만)`, severity: 'low' });
    }

    if (volDiv.bearish) {
      sellSignals.push({ text: volDiv.detail, severity: 'high' });
    } else if (volRatio > 1.3) {
      holdSignals.push(`거래량 ${volRatio}x — 강한 매수세 유지`);
    }

    if (rsi > 85) {
      sellSignals.push({ text: `RSI ${rsi} 극도 과열 — 즉시 부분 익절 고려`, severity: 'high' });
    } else if (rsi > 78) {
      if (strongUptrend && macdExpanding) {
        holdSignals.push(`RSI ${rsi} 과열권이나 MACD 확장 + 정배열 — 추세 홀딩`);
      } else {
        sellSignals.push({ text: `RSI ${rsi} 과열 구간 진입`, severity: 'medium' });
      }
    } else if (rsi >= 45 && rsi <= 75) {
      holdSignals.push(`RSI ${rsi} 건전한 강세 구간`);
    }

    const ma10Val = r(ma10), ma20Val = r(ma20);
    if (!isNaN(ma10Val) && !isNaN(ma20Val) && ma10Val < ma20Val)
      sellSignals.push({ text: `MA10(${ma10Val}) < MA20(${ma20Val}) 데드크로스`, severity: 'medium' });
    if (price < r(ma50))  sellSignals.push({ text: `MA50(${r(ma50)}) 이탈 — 중기 추세 붕괴`, severity: 'high' });
    if (price < r(ma120)) sellSignals.push({ text: `MA120(${r(ma120)}) 이탈 — 장기 추세 붕괴`, severity: 'high' });
    if (aboveCount >= 3) holdSignals.push(`이동평균선 ${aboveCount}/4개 위 — 추세 양호`);

    if (distFromHigh > -3) {
      holdSignals.push(`52주 고점 근접(${r(distFromHigh, 1)}%) — 모멘텀 강세 구간`);
      if (rsiDiv.bearish)
        sellSignals.push({ text: `52주 고점권 + RSI 다이버전스 — 강한 저항 구간`, severity: 'medium' });
    } else if (distFromHigh < -25) {
      sellSignals.push({ text: `52주 고점 대비 -${Math.abs(r(distFromHigh, 1))}% 후퇴 — 추세 훼손`, severity: 'medium' });
    }

    if (pnlPct > 25 && rsi > 78 && !strongUptrend)
      sellSignals.push({ text: `수익 +${pnlPct}% + RSI 과열 — 단계적 익절 권장`, severity: 'medium' });

    // ── Action 6단계 분류 ─────────────────────────────────────────────────────
    const highSigs  = sellSignals.filter(s => s.severity === 'high').length;
    const medSigs   = sellSignals.filter(s => s.severity === 'medium').length;
    const totalSigs = sellSignals.length;

    let action: string;

    if (price < r(ma50) && macd < 0 && aboveCount <= 1) {
      action = '즉시매도';
    } else if (highSigs >= 2 && totalSigs >= 3) {
      action = '매도';
    } else if (pnlPct > 20 && rsi > 78 && !macdPositive) {
      action = '부분익절';
    } else if (strongUptrend && macdExpanding && highSigs === 0) {
      // 강세 + MACD 확장 중 → 추세 홀딩 (아직 달리는 중)
      action = '추세홀딩';
    } else if (strongUptrend && highSigs === 0 && medSigs <= 1) {
      action = '홀딩';
    } else if (highSigs >= 1 || (medSigs >= 2 && !strongUptrend)) {
      action = '매도검토';
    } else if (holdSignals.length >= 2 && upside.score >= 50) {
      action = '홀딩';
    } else {
      action = '모니터링';
    }

    const sellUrgency = highSigs >= 2 || price < r(ma50) ? 'HIGH' : highSigs >= 1 || totalSigs >= 2 ? 'MEDIUM' : 'LOW';

    const trailing    = calcTrailingStop(price, avgPrice, atr, high52w, pnlPct);
    const fibTargets  = calcFibTargets(avgPrice, high52w, low52w, price);

    // ── Downside Risk ─────────────────────────────────────────────────────────
    const downsideRisk = calcDownsideRisk(price, avgPrice, ma20, ma50, ma120, atr, low52w, pnlPct);

    // ── Regret Analysis ───────────────────────────────────────────────────────
    const { holdRegret, sellRegret } = calcRegretAnalysis({
      rsi, macd, prevMacd: d.macd, macdContracting: macdCon.contracting, macdExpanding,
      adx, adxRising, volRatio, aboveCount, distFromHigh, pnlPct,
      rsiDiv, volDiv, strongUptrend, action, fibTargets, downsideRisk, upsideScore: upside.score,
    });

    return {
      ticker: h.ticker, avgPrice, shares, currentPrice: r(price),
      pnlPct, pnlAbs, action, sellUrgency,
      sellSignals: sellSignals.map(s => ({ text: s.text, severity: s.severity })),
      holdSignals,
      holdRegret,
      sellRegret,
      upside,
      downsideRisk,
      indicators: { rsi, macd, adx: r(adx, 1), volRatio, aboveCount, bbPos, distFromHigh: r(distFromHigh, 1) },
      stopLoss: { tight: r(price - 1.5 * atr), standard: stopATR, ma20: stopMA20, ma50: stopMA50, recommended: recommendedStop },
      trailing,
      fibTargets,
      targets: { t1: target1, t2: target2, t3: target3 },
      mas: { ma10: r(ma10), ma20: r(ma20), ma50: r(ma50), ma120: r(ma120) },
      divergences: { rsi: rsiDiv, volume: volDiv, macd: macdCon },
    };
  }));

  return NextResponse.json({ holdings: results, analyzed_at: new Date().toISOString() });
}
