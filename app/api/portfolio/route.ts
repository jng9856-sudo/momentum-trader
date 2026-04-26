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
function calcMACDHist(closes: number[]): { histogram: number; historyHist: number[] } {
  const e12 = calcEMA(closes, 12), e26 = calcEMA(closes, 26);
  const line = e12.map((v, i) => v - e26[i]);
  const sig  = calcEMA(line.slice(-60), 9);
  const histLine = line.slice(-sig.length).map((v, i) => v - sig[i]);
  return {
    histogram: Math.round((line[line.length-1] - sig[sig.length-1]) * 1000) / 1000,
    historyHist: histLine.slice(-10),
  };
}
function calcATR(hs: number[], ls: number[], cs: number[], period = 14): number {
  const trs: number[] = [];
  for (let i = 1; i < hs.length; i++)
    trs.push(Math.max(hs[i]-ls[i], Math.abs(hs[i]-cs[i-1]), Math.abs(ls[i]-cs[i-1])));
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}
function calcADX(hs: number[], ls: number[], cs: number[], period = 14): number {
  if (hs.length < period + 2) return 0;
  const trList: number[] = [], plusDM: number[] = [], minusDM: number[] = [];
  for (let i = 1; i < hs.length; i++) {
    trList.push(Math.max(hs[i]-ls[i], Math.abs(hs[i]-cs[i-1]), Math.abs(ls[i]-cs[i-1])));
    const upMove = hs[i] - hs[i-1], downMove = ls[i-1] - ls[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  const smooth = (arr: number[]) => {
    let val = arr.slice(0, period).reduce((a, b) => a + b, 0);
    const out = [val];
    for (let i = period; i < arr.length; i++) { val = val - val/period + arr[i]; out.push(val); }
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

// ── RSI Divergence detection ──────────────────────────────────────────────────
function detectRSIDivergence(closes: number[], lookback = 20): {
  bearish: boolean; bullish: boolean; detail: string;
} {
  if (closes.length < lookback + 15) return { bearish: false, bullish: false, detail: '데이터 부족' };

  // Calculate RSI for recent period
  const rsiSeries: number[] = [];
  for (let i = closes.length - lookback - 14; i <= closes.length - 1; i++) {
    rsiSeries.push(calcRSI(closes.slice(0, i + 1), 14));
  }

  const recentCloses = closes.slice(-lookback);
  const recentRSI    = rsiSeries.slice(-lookback);

  // Find recent price highs and lows (local peaks)
  const priceHighs: { idx: number; val: number }[] = [];
  const priceLows:  { idx: number; val: number }[] = [];
  for (let i = 2; i < recentCloses.length - 2; i++) {
    if (recentCloses[i] > recentCloses[i-1] && recentCloses[i] > recentCloses[i+1]) priceHighs.push({ idx: i, val: recentCloses[i] });
    if (recentCloses[i] < recentCloses[i-1] && recentCloses[i] < recentCloses[i+1]) priceLows.push({ idx: i, val: recentCloses[i] });
  }

  let bearish = false, bullish = false, detail = '다이버전스 없음';

  // Bearish: price higher high, RSI lower high
  if (priceHighs.length >= 2) {
    const [prev, last] = priceHighs.slice(-2);
    if (last.val > prev.val && recentRSI[last.idx] < recentRSI[prev.idx] - 2) {
      bearish = true;
      detail = `베어리시 다이버전스: 주가 신고가(${Math.round(last.val)}) but RSI 하락(${Math.round(recentRSI[last.idx])} < ${Math.round(recentRSI[prev.idx])})`;
    }
  }
  // Bullish: price lower low, RSI higher low
  if (priceLows.length >= 2) {
    const [prev, last] = priceLows.slice(-2);
    if (last.val < prev.val && recentRSI[last.idx] > recentRSI[prev.idx] + 2) {
      bullish = true;
      detail = `불리시 다이버전스: 주가 신저가(${Math.round(last.val)}) but RSI 상승(${Math.round(recentRSI[last.idx])} > ${Math.round(recentRSI[prev.idx])})`;
    }
  }

  return { bearish, bullish, detail };
}

// ── Volume divergence ─────────────────────────────────────────────────────────
function detectVolumeDivergence(closes: number[], volumes: number[], lookback = 10): {
  bearish: boolean; detail: string;
} {
  const recentC = closes.slice(-lookback);
  const recentV = volumes.slice(-lookback);
  const avgVol  = recentV.reduce((a, b) => a + b, 0) / recentV.length;

  // Price making new high but recent volume below average
  const priceAtHigh = recentC[recentC.length-1] === Math.max(...recentC);
  const volFading   = recentV[recentV.length-1] < avgVol * 0.8;

  const bearish = priceAtHigh && volFading;
  return {
    bearish,
    detail: bearish
      ? `신고가 갱신 but 거래량 감소 (현재 ${Math.round(recentV[recentV.length-1]/avgVol*100)}% 수준) — 기관 매도 가능성`
      : '거래량 정상',
  };
}

// ── MACD histogram contraction ────────────────────────────────────────────────
function detectMACDContraction(histSeries: number[]): {
  contracting: boolean; detail: string;
} {
  if (histSeries.length < 4) return { contracting: false, detail: '데이터 부족' };
  const recent = histSeries.slice(-4);
  const allPositive = recent.every(v => v > 0);
  // Histogram decreasing for last 3 bars while still positive = contraction
  const contracting = allPositive &&
    recent[recent.length-1] < recent[recent.length-2] &&
    recent[recent.length-2] < recent[recent.length-3];
  return {
    contracting,
    detail: contracting
      ? `MACD 히스토그램 3연속 수축 (${recent.slice(-3).map(v => v.toFixed(3)).join(' → ')}) — 상승 모멘텀 약화`
      : 'MACD 정상',
  };
}

// ── Upside potential score (0–100) ────────────────────────────────────────────
function calcUpsidePotential(params: {
  rsi: number; adx: number; macdHist: number; macdContracting: boolean;
  rsiBearDiv: boolean; volBearDiv: boolean; aboveCount: number;
  distFromHigh: number; bbPosition: number; volRatio: number;
}): { score: number; label: string } {
  let score = 50;

  // RSI (over 78 = overbought, 45-70 = ideal)
  if (params.rsi >= 45 && params.rsi <= 70) score += 10;
  else if (params.rsi > 78) score -= 20;
  else if (params.rsi > 70) score -= 10;
  else if (params.rsi < 40) score -= 15;

  // ADX trend strength
  if (params.adx >= 25 && params.adx <= 45) score += 10;
  else if (params.adx > 50) score -= 10; // trend exhausting
  else if (params.adx < 20) score -= 5;  // no trend

  // MACD
  if (params.macdHist > 0 && !params.macdContracting) score += 10;
  else if (params.macdContracting) score -= 15;
  else if (params.macdHist < 0) score -= 15;

  // Divergences
  if (params.rsiBearDiv) score -= 20;
  if (params.volBearDiv) score -= 15;

  // MA alignment
  score += (params.aboveCount - 2) * 5;

  // Distance from 52w high
  if (params.distFromHigh > -5)  score += 5;
  else if (params.distFromHigh < -20) score -= 10;

  // BB position
  if (params.bbPosition > 85) score -= 10;
  else if (params.bbPosition < 40) score -= 5;

  // Volume
  if (params.volRatio > 1.3) score += 5;

  score = Math.max(0, Math.min(100, Math.round(score)));
  const label = score >= 70 ? '상승 여력 충분' : score >= 50 ? '보통' : score >= 30 ? '상승 여력 제한' : '소진 임박';
  return { score, label };
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
  if (cs.length < 30) return null;

  const price = cs[cs.length-1];
  const ma10 = calcMA(cs,10), ma20 = calcMA(cs,20), ma50 = calcMA(cs,50), ma120 = calcMA(cs,120);
  const rsi  = calcRSI(cs.slice(-30));
  const { histogram: macd, historyHist } = calcMACDHist(cs);
  const atr  = calcATR(hs.slice(-20), ls.slice(-20), cs.slice(-20));
  const adx  = calcADX(hs.slice(-30), ls.slice(-30), cs.slice(-30));
  const high52w = Math.max(...cs);
  const volAvg  = vs.slice(-21,-1).reduce((a,b) => a+b, 0) / 20;
  const volRatio = volAvg > 0 ? Math.round((vs[vs.length-1]/volAvg)*100)/100 : 1;

  const mas = [ma10, ma20, ma50, ma120].filter(m => !isNaN(m));
  const aboveCount = mas.filter(m => price > m).length;
  const distFromHigh = ((price - high52w) / high52w) * 100;

  // BB position
  const sl = cs.slice(-20), mid = sl.reduce((a,b) => a+b,0)/20;
  const std = Math.sqrt(sl.reduce((a,b) => a+(b-mid)**2,0)/20);
  const bbPos = std > 0 ? Math.round(((price-(mid-2*std))/(4*std))*100) : 50;

  // Advanced sell signals
  const rsiDiv  = detectRSIDivergence(cs);
  const volDiv  = detectVolumeDivergence(cs, vs);
  const macdCon = detectMACDContraction(historyHist);
  const upside  = calcUpsidePotential({
    rsi, adx, macdHist: macd, macdContracting: macdCon.contracting,
    rsiBearDiv: rsiDiv.bearish, volBearDiv: volDiv.bearish,
    aboveCount, distFromHigh, bbPosition: bbPos, volRatio,
  });

  return {
    price, ma10, ma20, ma50, ma120, rsi, macd, atr, high52w, volRatio,
    adx, aboveCount, distFromHigh, bbPos,
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
    const r = (n: number, dec = 2) => isNaN(n) ? 0 : Math.round(n * 10**dec) / 10**dec;

    const { price, ma10, ma20, ma50, ma120, rsi, macd, atr, high52w, volRatio,
            adx, aboveCount, distFromHigh, bbPos, rsiDiv, volDiv, macdCon, upside } = d;
    const avgPrice = h.avgPrice, shares = h.shares ?? 0;
    const pnlPct = r(((price - avgPrice) / avgPrice) * 100);
    const pnlAbs = r((price - avgPrice) * shares);

    // Stop losses
    const stopMA20 = !isNaN(ma20) ? r(ma20 * 0.99) : null;
    const stopMA50 = !isNaN(ma50) ? r(ma50 * 0.98) : null;
    const stopATR  = r(price - 2.0 * atr);
    const recommendedStop = !isNaN(ma20) && price > ma20
      ? { price: stopMA20, label: 'MA20 기준' }
      : !isNaN(ma50) && price > ma50
        ? { price: stopMA50, label: 'MA50 기준' }
        : { price: stopATR, label: 'ATR 2x' };

    // Targets
    const target1 = r(avgPrice * 1.10);
    const target2 = r(avgPrice * 1.20);
    const target3 = r(Math.min(high52w * 1.05, avgPrice * 1.35));

    // ── Sell signals (7 indicators) ──
    const sellSignals: { text: string; severity: 'high' | 'medium' | 'low' }[] = [];
    const holdSignals: string[] = [];

    // 1. RSI divergence
    if (rsiDiv.bearish) sellSignals.push({ text: `RSI 베어리시 다이버전스 — ${rsiDiv.detail}`, severity: 'high' });
    if (rsiDiv.bullish) holdSignals.push(`RSI 불리시 다이버전스 — 저점 지지 강화`);

    // 2. MACD histogram contraction
    if (macdCon.contracting) sellSignals.push({ text: macdCon.detail, severity: 'high' });
    else if (macd > 0) holdSignals.push('MACD 히스토그램 양수 유지 — 상승 모멘텀 지속');

    // 3. ADX trend exhaustion
    if (adx > 50) sellSignals.push({ text: `ADX ${adx} — 추세 과열, 소진 임박`, severity: 'medium' });
    else if (adx >= 25 && adx <= 45) holdSignals.push(`ADX ${adx} — 건전한 추세 강도 유지`);
    else if (adx < 20) sellSignals.push({ text: `ADX ${adx} — 추세 약화 (20 미만)`, severity: 'low' });

    // 4. Volume divergence
    if (volDiv.bearish) sellSignals.push({ text: volDiv.detail, severity: 'high' });
    else if (volRatio > 1.3) holdSignals.push(`거래량 ${volRatio}x — 강한 매수세 유지`);

    // 5. RSI overbought
    if (rsi > 80) sellSignals.push({ text: `RSI ${rsi} 극도 과열 — 즉시 부분 익절 고려`, severity: 'high' });
    else if (rsi > 72) sellSignals.push({ text: `RSI ${rsi} 과열 구간 진입`, severity: 'medium' });
    else if (rsi >= 45 && rsi <= 70) holdSignals.push(`RSI ${rsi} 건전한 강세 구간`);

    // 6. MA death cross (short-term)
    const ma10Val = r(ma10), ma20Val = r(ma20);
    if (!isNaN(ma10Val) && !isNaN(ma20Val) && ma10Val < ma20Val)
      sellSignals.push({ text: `MA10(${ma10Val}) < MA20(${ma20Val}) 데드크로스 — 단기 추세 전환`, severity: 'medium' });
    if (price < r(ma50)) sellSignals.push({ text: `MA50(${r(ma50)}) 이탈 — 중기 추세 붕괴`, severity: 'high' });
    if (price < r(ma120)) sellSignals.push({ text: `MA120(${r(ma120)}) 이탈 — 장기 추세 붕괴`, severity: 'high' });
    if (aboveCount >= 3) holdSignals.push(`이동평균선 ${aboveCount}/4개 위 — 추세 양호`);

    // 7. RS divergence proxy (dist from high)
    if (distFromHigh > -3 && rsi > 70) sellSignals.push({ text: `52주 고점 근접(${r(distFromHigh,1)}%) + RSI 과열 — 저항 구간`, severity: 'medium' });

    // Profit protection
    if (pnlPct > 25 && rsi > 70) sellSignals.push({ text: `수익 +${pnlPct}% + RSI 과열 — 단계적 익절 권장`, severity: 'medium' });

    // Overall action
    const highSigs  = sellSignals.filter(s => s.severity === 'high').length;
    const totalSigs = sellSignals.length;

    let action: string;
    if (price < r(ma50) && macd < 0 && aboveCount <= 1) action = '즉시매도';
    else if (highSigs >= 3 || totalSigs >= 4) action = '매도';
    else if (pnlPct > 20 && rsi > 72) action = '부분익절';
    else if (highSigs >= 1 || totalSigs >= 2) action = '매도검토';
    else if (holdSignals.length >= 2 && upside.score >= 50) action = '홀딩';
    else action = '모니터링';

    const sellUrgency = highSigs >= 2 || price < r(ma50) ? 'HIGH' : highSigs >= 1 || totalSigs >= 2 ? 'MEDIUM' : 'LOW';

    return {
      ticker: h.ticker, avgPrice, shares, currentPrice: r(price),
      pnlPct, pnlAbs, action, sellUrgency,
      sellSignals: sellSignals.map(s => ({ text: s.text, severity: s.severity })),
      holdSignals,
      upside,
      indicators: { rsi, macd, adx: r(adx,1), volRatio, aboveCount, bbPos, distFromHigh: r(distFromHigh,1) },
      stopLoss: { tight: r(price - 1.5*atr), standard: stopATR, ma20: stopMA20, ma50: stopMA50, recommended: recommendedStop },
      targets: { t1: target1, t2: target2, t3: target3 },
      mas: { ma10: r(ma10), ma20: r(ma20), ma50: r(ma50), ma120: r(ma120) },
      divergences: { rsi: rsiDiv, volume: volDiv, macd: macdCon },
    };
  }));

  return NextResponse.json({ holdings: results, analyzed_at: new Date().toISOString() });
}
