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
  // ✅ FIX: 최소 period*3 이상 데이터 필요. 30개 슬라이스로 쓰면 EMA 수렴 부족
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
function calcMACDHist(closes: number[]): { histogram: number; historyHist: number[] } {
  const e12 = calcEMA(closes, 12), e26 = calcEMA(closes, 26);
  const line = e12.map((v, i) => v - e26[i]);
  const sig  = calcEMA(line.slice(-60), 9);
  const histLine = line.slice(-sig.length).map((v, i) => v - sig[i]);
  return {
    histogram: Math.round((line[line.length - 1] - sig[sig.length - 1]) * 1000) / 1000,
    historyHist: histLine.slice(-10),
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

// ── RSI Divergence detection ──────────────────────────────────────────────────
function detectRSIDivergence(closes: number[], lookback = 20): {
  bearish: boolean; bullish: boolean; detail: string;
} {
  if (closes.length < lookback + 15) return { bearish: false, bullish: false, detail: '데이터 부족' };

  const rsiSeries: number[] = [];
  for (let i = closes.length - lookback - 14; i <= closes.length - 1; i++) {
    rsiSeries.push(calcRSI(closes.slice(0, i + 1), 14));
  }
  const recentCloses = closes.slice(-lookback);
  const recentRSI    = rsiSeries.slice(-lookback);

  const priceHighs: { idx: number; val: number }[] = [];
  const priceLows:  { idx: number; val: number }[] = [];
  for (let i = 2; i < recentCloses.length - 2; i++) {
    if (recentCloses[i] > recentCloses[i - 1] && recentCloses[i] > recentCloses[i + 1]) priceHighs.push({ idx: i, val: recentCloses[i] });
    if (recentCloses[i] < recentCloses[i - 1] && recentCloses[i] < recentCloses[i + 1]) priceLows.push({ idx: i, val: recentCloses[i] });
  }

  let bearish = false, bullish = false, detail = '다이버전스 없음';

  if (priceHighs.length >= 2) {
    const [prev, last] = priceHighs.slice(-2);
    // ✅ FIX: RSI 하락 조건을 -2 → -3pt 이상으로 강화 (노이즈 감소)
    if (last.val > prev.val && recentRSI[last.idx] < recentRSI[prev.idx] - 3) {
      bearish = true;
      detail = `베어리시 다이버전스: 주가 신고가(${Math.round(last.val)}) but RSI 하락(${Math.round(recentRSI[last.idx])} < ${Math.round(recentRSI[prev.idx])})`;
    }
  }
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
// ✅ FIX: volAvg20을 외부에서 받아 화면 표시 기준(20일 avg)과 일치시킴
//         임계값 0.8 → 0.70으로 강화 (16% 감소는 노이즈, 30%+ 감소만 의미있음)
function detectVolumeDivergence(closes: number[], volumes: number[], volAvg20: number, lookback = 5): {
  bearish: boolean; detail: string;
} {
  const recentC = closes.slice(-lookback);
  const recentV = volumes.slice(-lookback);

  // 최근 5일 고점 갱신 여부
  const priceAtHigh = recentC[recentC.length - 1] >= Math.max(...recentC) * 0.995;
  // ✅ 20일 평균 대비 30% 이상 감소 시에만 의미있는 기관 이탈로 판단
  const volFading = recentV[recentV.length - 1] < volAvg20 * 0.70;

  const bearish = priceAtHigh && volFading;
  const ratioVsAvg = Math.round(recentV[recentV.length - 1] / volAvg20 * 100);
  return {
    bearish,
    detail: bearish
      ? `신고가 갱신 but 거래량 급감 (20일평균 대비 ${ratioVsAvg}%) — 기관 이탈 가능성`
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
  const contracting = allPositive &&
    recent[recent.length - 1] < recent[recent.length - 2] &&
    recent[recent.length - 2] < recent[recent.length - 3];
  return {
    contracting,
    detail: contracting
      ? `MACD 히스토그램 3연속 수축 (${recent.slice(-3).map(v => v.toFixed(3)).join(' → ')}) — 상승 모멘텀 약화`
      : 'MACD 정상',
  };
}

// ── Upside potential score (0–100) ────────────────────────────────────────────
function calcUpsidePotential(params: {
  rsi: number; adx: number; adxRising: boolean; macdHist: number; macdContracting: boolean;
  rsiBearDiv: boolean; volBearDiv: boolean; aboveCount: number;
  distFromHigh: number; bbPosition: number; volRatio: number;
}): { score: number; label: string } {
  let score = 50;

  if (params.rsi >= 45 && params.rsi <= 72) score += 10;
  else if (params.rsi > 80) score -= 20;
  else if (params.rsi > 72) score -= 8;   // ✅ 72~80 패널티 완화
  else if (params.rsi < 40) score -= 15;

  // ✅ FIX: ADX 방향성 반영 (상승중이면 추세 강화, 하락중이면 소진)
  if (params.adx >= 25 && params.adx <= 60) score += 10;
  else if (params.adx > 60 && params.adxRising) score += 5;   // 강한 추세 지속
  else if (params.adx > 60 && !params.adxRising) score -= 10; // 추세 소진 임박
  else if (params.adx < 20) score -= 5;

  if (params.macdHist > 0 && !params.macdContracting) score += 10;
  else if (params.macdContracting) score -= 15;
  else if (params.macdHist < 0) score -= 15;

  if (params.rsiBearDiv) score -= 20;
  if (params.volBearDiv) score -= 15;

  score += (params.aboveCount - 2) * 5;

  // ✅ FIX: 52주 고점 근접은 상승 여력 패널티 없음 (모멘텀 투자에서 신고가 = 강세)
  if (params.distFromHigh < -20) score -= 10;
  // 신고가권은 중립 or 약간 긍정
  if (params.distFromHigh > -5) score += 3;

  if (params.bbPosition > 90) score -= 10;
  else if (params.bbPosition > 80) score -= 5;
  else if (params.bbPosition < 40) score -= 5;

  if (params.volRatio > 1.3) score += 5;

  score = Math.max(0, Math.min(100, Math.round(score)));
  const label = score >= 70 ? '상승 여력 충분' : score >= 50 ? '보통' : score >= 30 ? '상승 여력 제한' : '소진 임박';
  return { score, label };
}

// ── Trailing Stop Calculator ──────────────────────────────────────────────────
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
  if (pnlPct >= 30) {
    recommended = { price: trailPct8, label: '8% 트레일링 스탑', reasoning: `수익 +${pnlPct.toFixed(1)}% — 수익 보호 우선. 현재가 -8% 하락 시 즉시 매도` };
  } else if (pnlPct >= 15) {
    recommended = { price: trail2xATR, label: 'ATR 2x 트레일링', reasoning: `수익 +${pnlPct.toFixed(1)}% — 변동성 기반 트레일링. 하락 시 자동 손절` };
  } else if (pnlPct >= 0) {
    recommended = { price: trail3xATR, label: 'ATR 3x 트레일링', reasoning: `수익 +${pnlPct.toFixed(1)}% — 추세 유지 공간 확보. 조정 허용 후 홀딩` };
  } else {
    recommended = { price: Math.max(trail2xATR, r(avgPrice * 0.93)), label: '손절 우선', reasoning: `손실 중 — 평균매수가 대비 손절 엄수. 추가 손실 방지` };
  }
  return { trail2xATR, trail3xATR, trailPct8, trailPct15, highWaterMark, recommended };
}

// ── Fibonacci Extension Targets ───────────────────────────────────────────────
function calcFibTargets(avgPrice: number, high52w: number, low52w: number, currentPrice: number) {
  const r = (n: number) => Math.round(n * 100) / 100;
  const range = high52w - low52w;
  const t1_618 = r(avgPrice + range * 0.618);
  const t2_100 = r(avgPrice + range * 1.0);
  const t3_162 = r(avgPrice + range * 1.618);
  const t10 = r(avgPrice * 1.10);
  const t20 = r(avgPrice * 1.20);
  const t30 = r(avgPrice * 1.30);
  const pnlPct = ((currentPrice - avgPrice) / avgPrice) * 100;
  return {
    fib618: t1_618, fib100: t2_100, fib162: t3_162,
    pct10: t10, pct20: t20, pct30: t30,
    nextTarget: pnlPct < 10 ? t10 : pnlPct < 20 ? t20 : pnlPct < 30 ? t30 : t1_618,
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

  // ✅ FIX 1: RSI를 전체 데이터로 계산 (cs.slice(-30) 제거 → 정확도 대폭 향상)
  const rsi = calcRSI(cs, 14);

  const { histogram: macd, historyHist } = calcMACDHist(cs);
  const atr = calcATR(hs.slice(-20), ls.slice(-20), cs.slice(-20));

  // ✅ FIX 2: ADX 현재값 + 5일 전 값으로 방향성(상승/하락) 판단
  const adx     = calcADX(hs.slice(-35), ls.slice(-35), cs.slice(-35));
  const adxPrev = calcADX(hs.slice(-40, -5), ls.slice(-40, -5), cs.slice(-40, -5));
  const adxRising = adx > adxPrev + 1; // 1pt 이상 상승 시 "상승 중"으로 판단

  // ✅ FIX 3: 52주 고가/저가는 종가가 아닌 실제 고가(hs)/저가(ls)로 계산
  const high52w = Math.max(...hs);
  const low52w  = Math.min(...ls);

  // 20일 평균 거래량 (당일 제외) — 화면 표시와 동일한 기준
  const volAvg20 = vs.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
  const volRatio = volAvg20 > 0 ? Math.round((vs[vs.length - 1] / volAvg20) * 100) / 100 : 1;

  const mas = [ma10, ma20, ma50, ma120].filter(m => !isNaN(m));
  const aboveCount = mas.filter(m => price > m).length;
  const distFromHigh = ((price - high52w) / high52w) * 100;

  const sl = cs.slice(-20), mid = sl.reduce((a, b) => a + b, 0) / 20;
  const std = Math.sqrt(sl.reduce((a, b) => a + (b - mid) ** 2, 0) / 20);
  const bbPos = std > 0 ? Math.round(((price - (mid - 2 * std)) / (4 * std)) * 100) : 50;

  const rsiDiv  = detectRSIDivergence(cs);
  // ✅ FIX 4: detectVolumeDivergence에 volAvg20 전달 (화면 기준과 일치)
  const volDiv  = detectVolumeDivergence(cs, vs, volAvg20);
  const macdCon = detectMACDContraction(historyHist);
  const upside  = calcUpsidePotential({
    rsi, adx, adxRising, macdHist: macd, macdContracting: macdCon.contracting,
    rsiBearDiv: rsiDiv.bearish, volBearDiv: volDiv.bearish,
    aboveCount, distFromHigh, bbPosition: bbPos, volRatio,
  });

  return {
    price, ma10, ma20, ma50, ma120, rsi, macd, atr,
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

    const { price, ma10, ma20, ma50, ma120, rsi, macd, atr,
            high52w, low52w, volRatio,
            adx, adxRising, aboveCount, distFromHigh, bbPos,
            rsiDiv, volDiv, macdCon, upside } = d;

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

    // ── Sell signals ──────────────────────────────────────────────────────────
    const sellSignals: { text: string; severity: 'high' | 'medium' | 'low' }[] = [];
    const holdSignals: string[] = [];

    // ── MACD confirmation gate ────────────────────────────────────────────────
    // MACD 양수 + 수축 없음 + 전체 MA 정렬 → 이 상태에서는 단순 임계값 기반 신호 억제
    const macdPositive   = macd > 0 && !macdCon.contracting;
    const allMAsAligned  = aboveCount === 4;
    const strongUptrend  = macdPositive && allMAsAligned;

    // 1. RSI 베어리시 다이버전스 (고신뢰 매도 신호)
    if (rsiDiv.bearish) sellSignals.push({ text: `RSI 베어리시 다이버전스 — ${rsiDiv.detail}`, severity: 'high' });
    if (rsiDiv.bullish) holdSignals.push('RSI 불리시 다이버전스 — 저점 지지 강화');

    // 2. MACD 히스토그램 수축 (고신뢰 매도 신호)
    if (macdCon.contracting) {
      sellSignals.push({ text: macdCon.detail, severity: 'high' });
    } else if (macd > 0) {
      holdSignals.push('MACD 히스토그램 양수 유지 — 상승 모멘텀 지속');
    }

    // 3. ADX 추세 강도
    // ✅ FIX: 임계값 50→60 상향 + 방향성(adxRising) 추가
    // ADX가 60 이상이어도 상승 중이면 추세 강화, 하락 반전 시에만 소진 신호
    if (adx > 60 && !adxRising) {
      sellSignals.push({ text: `ADX ${adx} 하락 반전 — 추세 소진 시작`, severity: 'medium' });
    } else if (adx > 60 && adxRising) {
      holdSignals.push(`ADX ${adx} 상승 중 — 강한 추세 지속`);
    } else if (adx >= 25 && adx <= 60) {
      holdSignals.push(`ADX ${adx} — 건전한 추세 강도 유지`);
    } else if (adx < 20) {
      sellSignals.push({ text: `ADX ${adx} — 추세 약화 (20 미만)`, severity: 'low' });
    }

    // 4. 거래량 다이버전스
    // ✅ FIX: 임계값 0.8→0.70으로 강화, 20일 avg 기준으로 통일
    if (volDiv.bearish) {
      sellSignals.push({ text: volDiv.detail, severity: 'high' });
    } else if (volRatio > 1.3) {
      holdSignals.push(`거래량 ${volRatio}x — 강한 매수세 유지`);
    }

    // 5. RSI 과열
    // ✅ FIX: medium 임계값 72→78로 상향 (강세장에서 RSI 70~78 장기 유지 흔함)
    if (rsi > 80) {
      sellSignals.push({ text: `RSI ${rsi} 극도 과열 — 즉시 부분 익절 고려`, severity: 'high' });
    } else if (rsi > 78) {
      // strongUptrend면 경고만, 아니면 medium
      if (strongUptrend) {
        holdSignals.push(`RSI ${rsi} 과열권이나 MACD·MA 강세 유지 — 홀딩 우선`);
      } else {
        sellSignals.push({ text: `RSI ${rsi} 과열 구간 진입`, severity: 'medium' });
      }
    } else if (rsi >= 45 && rsi <= 75) {
      holdSignals.push(`RSI ${rsi} 건전한 강세 구간`);
    }

    // 6. MA 데드크로스 / 이탈 (구조적 약세)
    const ma10Val = r(ma10), ma20Val = r(ma20);
    if (!isNaN(ma10Val) && !isNaN(ma20Val) && ma10Val < ma20Val)
      sellSignals.push({ text: `MA10(${ma10Val}) < MA20(${ma20Val}) 데드크로스 — 단기 추세 전환`, severity: 'medium' });
    if (price < r(ma50))  sellSignals.push({ text: `MA50(${r(ma50)}) 이탈 — 중기 추세 붕괴`, severity: 'high' });
    if (price < r(ma120)) sellSignals.push({ text: `MA120(${r(ma120)}) 이탈 — 장기 추세 붕괴`, severity: 'high' });
    if (aboveCount >= 3) holdSignals.push(`이동평균선 ${aboveCount}/4개 위 — 추세 양호`);

    // 7. 52주 고점 근접 처리
    // ✅ FIX: 신고가 근접을 매도 신호에서 제거. 모멘텀 투자에서 신고가 = 강세 신호
    // 단, RSI 베어리시 다이버전스와 '동시에' 발생할 때만 저항 가중
    if (distFromHigh > -3) {
      holdSignals.push(`52주 고점 근접(${r(distFromHigh, 1)}%) — 모멘텀 강세 구간`);
      // RSI 다이버전스와 결합 시에만 medium 매도
      if (rsiDiv.bearish) {
        sellSignals.push({ text: `52주 고점권 + RSI 다이버전스 — 강한 저항 구간`, severity: 'medium' });
      }
    } else if (distFromHigh < -25) {
      sellSignals.push({ text: `52주 고점 대비 -${Math.abs(r(distFromHigh, 1))}% 후퇴 — 추세 훼손`, severity: 'medium' });
    }

    // 8. 수익 보호 (보유 주식 맥락)
    if (pnlPct > 25 && rsi > 78 && !strongUptrend) {
      sellSignals.push({ text: `수익 +${pnlPct}% + RSI 과열 — 단계적 익절 권장`, severity: 'medium' });
    }

    // ── Overall action ────────────────────────────────────────────────────────
    const highSigs  = sellSignals.filter(s => s.severity === 'high').length;
    const medSigs   = sellSignals.filter(s => s.severity === 'medium').length;
    const totalSigs = sellSignals.length;

    let action: string;

    // 즉시매도: MA50 이탈 + MACD 음전환 + MA 1개 이하 — 구조적 붕괴
    if (price < r(ma50) && macd < 0 && aboveCount <= 1) {
      action = '즉시매도';
    }
    // 매도: 고신뢰 신호 2개 이상 + 총 3개 이상
    // ✅ FIX: totalSigs >= 4 단독 제거 → highSigs 조건 강화
    else if (highSigs >= 2 && totalSigs >= 3) {
      action = '매도';
    }
    // 부분익절: 수익 +20% 이상 + RSI 78 초과 + MACD가 둔화 중
    else if (pnlPct > 20 && rsi > 78 && !macdPositive) {
      action = '부분익절';
    }
    // 홀딩: MACD 양수 + MA 전체 정렬 + 고신뢰 매도 신호 없음
    // ✅ 강세 추세가 명확할 때 medium 신호만 있으면 홀딩 유지
    else if (strongUptrend && highSigs === 0 && medSigs <= 1) {
      action = '홀딩';
    }
    // 매도검토: 고신뢰 1개 이상 or medium 2개 이상 (단, 강세추세 아닐 때)
    else if (highSigs >= 1 || (medSigs >= 2 && !strongUptrend)) {
      action = '매도검토';
    }
    // 홀딩: 홀딩 근거 2개 이상
    else if (holdSignals.length >= 2 && upside.score >= 50) {
      action = '홀딩';
    }
    // 기본: 모니터링
    else {
      action = '모니터링';
    }

    const sellUrgency = highSigs >= 2 || price < r(ma50) ? 'HIGH' : highSigs >= 1 || totalSigs >= 2 ? 'MEDIUM' : 'LOW';

    // ✅ FIX 5: fibTargets low52w를 실제 52주 저가로 계산 (기존 price*0.7 오류 수정)
    const trailing   = calcTrailingStop(price, avgPrice, atr, high52w, pnlPct);
    const fibTargets = calcFibTargets(avgPrice, high52w, low52w, price);

    return {
      ticker: h.ticker, avgPrice, shares, currentPrice: r(price),
      pnlPct, pnlAbs, action, sellUrgency,
      sellSignals: sellSignals.map(s => ({ text: s.text, severity: s.severity })),
      holdSignals,
      upside,
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
