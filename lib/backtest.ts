// lib/backtest.ts — 백테스트 엔진

// ── 지표 계산 (route.ts와 동일 로직) ─────────────────────────────────────────
function calcEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1); let prev = data[0];
  return data.map(d => { prev = d * k + prev * (1 - k); return prev; });
}
function calcMA(closes: number[], period: number): number {
  const sl = closes.slice(-period);
  return sl.length < period ? NaN : sl.reduce((a, b) => a + b, 0) / period;
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
function calcMACDHist(closes: number[]): number {
  if (closes.length < 35) return 0;
  const e12 = calcEMA(closes, 12), e26 = calcEMA(closes, 26);
  const line = e12.map((v, i) => v - e26[i]);
  const sig = calcEMA(line.slice(-60), 9);
  return line[line.length - 1] - sig[sig.length - 1];
}
function calcATR(hs: number[], ls: number[], cs: number[], period = 14): number {
  if (hs.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < hs.length; i++)
    trs.push(Math.max(hs[i] - ls[i], Math.abs(hs[i] - cs[i - 1]), Math.abs(ls[i] - cs[i - 1])));
  const sl = trs.slice(-period);
  return sl.length > 0 ? sl.reduce((a, b) => a + b, 0) / sl.length : 0;
}
function calcVolumeRatio(vs: number[], period = 20): number {
  if (vs.length < period + 1) return 1;
  const avg = vs.slice(-period - 1, -1).reduce((a, b) => a + b, 0) / period;
  return avg > 0 ? vs[vs.length - 1] / avg : 1;
}

// ── 일봉 기반 스코어·신호 계산 (VCP 제외, 순수 기술지표) ──────────────────────
function calcDailyScore(
  closes: number[], highs: number[], lows: number[], volumes: number[]
): { score: number; signal: string; atrAbs: number } {
  const price  = closes[closes.length - 1];
  const ma10   = calcMA(closes, 10);
  const ma20   = calcMA(closes, 20);
  const ma50   = calcMA(closes, 50);
  const ma120  = calcMA(closes, 120);
  const rsi    = calcRSI(closes.slice(-30));
  const macdH  = calcMACDHist(closes);
  const atrAbs = calcATR(highs.slice(-20), lows.slice(-20), closes.slice(-20));
  const volRatio = calcVolumeRatio(volumes);
  const high52w  = Math.max(...closes.slice(-Math.min(252, closes.length)));
  const distFromHigh = ((price - high52w) / high52w) * 100;
  const atrPct = (atrAbs / price) * 100;

  const maVals = [ma10, ma20, ma50, ma120].filter(v => !isNaN(v));
  let aboveCount = 0;
  if (!isNaN(ma10)  && price > ma10)  aboveCount++;
  if (!isNaN(ma20)  && price > ma20)  aboveCount++;
  if (!isNaN(ma50)  && price > ma50)  aboveCount++;
  if (!isNaN(ma120) && price > ma120) aboveCount++;

  const stackedBull = maVals.length >= 3 && maVals.every((v, i) => i === 0 || v < maVals[i - 1]);
  const stackedBear = maVals.length >= 3 && maVals.every((v, i) => i === 0 || v > maVals[i - 1]);

  let score = 0;

  // MA 정렬 (최대 15점)
  score += aboveCount * 2.5;
  if (stackedBull) score += 5;
  if (stackedBear) score -= 5;

  // RSI (최대 15점)
  if      (rsi >= 50 && rsi <= 70) score += 15;
  else if (rsi >= 45 && rsi <  50) score += 8;
  else if (rsi >= 70 && rsi <= 78) score += 5;
  else if (rsi >  78)              score -= 8;
  else if (rsi <  30)              score -= 5;

  // MACD histogram (최대 15점)
  if      (macdH >  0.05) score += 15;
  else if (macdH >  0)    score += 6;
  else if (macdH < -0.05) score -= 8;
  else                    score -= 3;

  // 거래량 비율 (최대 15점)
  if      (volRatio >= 2.0) score += 15;
  else if (volRatio >= 1.5) score += 10;
  else if (volRatio >= 1.0) score += 4;
  else if (volRatio <  0.7) score -= 4;

  // 52주 고점 근접도 (최대 15점)
  if      (distFromHigh > -3)  score += 15;
  else if (distFromHigh > -8)  score += 8;
  else if (distFromHigh > -15) score += 3;
  else                         score -= 3;

  // ATR 변동성 안정성 (최대 5점)
  if      (atrPct < 2) score += 5;
  else if (atrPct < 4) score += 2;
  else if (atrPct > 8) score -= 3;

  score = Math.max(0, Math.min(100, Math.round(score)));

  // 신호 결정
  let signal = 'HOLD';
  const macdBull = macdH > 0;
  const volStrong = volRatio > 1.5;
  if      (score >= 72 && aboveCount >= 3 && stackedBull && macdBull && volStrong) signal = 'BREAKOUT';
  else if (score >= 60 && aboveCount >= 3 && macdBull)                             signal = 'SETUP';
  else if (score >= 45 && aboveCount >= 2)                                         signal = 'WATCH';
  else if (score <= 20 || (aboveCount === 0 && !macdBull))                         signal = 'STRONG_SELL';
  else if (score <= 35 || aboveCount <= 1)                                         signal = 'SELL';

  return { score, signal, atrAbs };
}

// ── 인터페이스 정의 ──────────────────────────────────────────────────────────
export interface BacktestTrade {
  ticker:     string;
  entryDate:  string;
  exitDate:   string;
  entryPrice: number;
  exitPrice:  number;
  shares:     number;
  pnl:        number;
  pnlPct:     number;
  holdDays:   number;
  exitReason: 'STOP_LOSS' | 'TRAILING_STOP' | 'SIGNAL_EXIT' | 'END_OF_DATA';
  entryScore: number;
  signal:     string;
}

export interface TickerResult {
  ticker:      string;
  trades:      number;
  winTrades:   number;
  winRate:     number;
  totalPnl:    number;
  totalPnlPct: number;
}

export interface BacktestResult {
  metrics: {
    initialCapital: number;
    finalCapital:   number;
    totalReturn:    number;
    cagr:           number;
    winRate:        number;
    avgWin:         number;
    avgLoss:        number;
    profitFactor:   number;
    maxDrawdown:    number;
    totalTrades:    number;
    winTrades:      number;
    lossTrades:     number;
    avgHoldDays:    number;
    bestTrade:      number;
    worstTrade:     number;
  };
  trades:        BacktestTrade[];
  tickerResults: TickerResult[];
  equityCurve:   { date: string; value: number }[];
  startDate:     string;
  endDate:       string;
}

// ── Yahoo Finance 데이터 페치 ────────────────────────────────────────────────
async function fetchHistoricalData(ticker: string, fetchStart: string, endDate: string) {
  const p1 = Math.floor(new Date(fetchStart).getTime() / 1000);
  const p2 = Math.floor(new Date(endDate).getTime()   / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&period1=${p1}&period2=${p2}`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next:    { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data   = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const ts: number[]      = result.timestamp ?? [];
    const q                  = result.indicators?.quote?.[0] ?? {};
    const closes: number[]  = q.close  ?? [];
    const highs: number[]   = q.high   ?? [];
    const lows: number[]    = q.low    ?? [];
    const opens: number[]   = q.open   ?? [];
    const volumes: number[] = q.volume ?? [];

    return ts
      .map((t, i) => ({
        date:   new Date(t * 1000).toISOString().slice(0, 10),
        open:   opens[i]   ?? closes[i] ?? 0,
        high:   highs[i]   ?? closes[i] ?? 0,
        low:    lows[i]    ?? closes[i] ?? 0,
        close:  closes[i]  ?? 0,
        volume: volumes[i] ?? 0,
      }))
      .filter(b => b.close > 0);
  } catch { return null; }
}

// ── 메인 백테스트 실행 ──────────────────────────────────────────────────────
export async function runBacktest(
  tickers: string[],
  startDate: string,
  endDate: string,
  initialCapital: number,
  opts = { positionSizePct: 0.2, maxPositions: 5, atrStopMult: 2.0, trailActivatePct: 0.10 }
): Promise<BacktestResult> {
  // 워밍업: 지표 계산용으로 시작 8개월 전부터 데이터 가져옴
  const warmup = new Date(startDate);
  warmup.setMonth(warmup.getMonth() - 8);
  const fetchStart = warmup.toISOString().slice(0, 10);

  const allData = await Promise.all(tickers.map(t => fetchHistoricalData(t, fetchStart, endDate)));

  // 거래일 목록 구성
  const tradingDates = new Set<string>();
  for (const bars of allData) {
    if (!bars) continue;
    for (const b of bars) {
      if (b.date >= startDate && b.date <= endDate) tradingDates.add(b.date);
    }
  }
  const sortedDates = Array.from(tradingDates).sort();

  const dataMap: Record<string, NonNullable<typeof allData[0]>> = {};
  tickers.forEach((t, i) => { if (allData[i]) dataMap[t] = allData[i]!; });

  interface Position {
    ticker:      string;
    entryDate:   string;
    entryPrice:  number;
    shares:      number;
    stopLoss:    number;
    trailHigh:   number;
    trailActive: boolean;
    entryScore:  number;
    signal:      string;
  }

  let cash = initialCapital;
  const positions: Position[] = [];
  const closedTrades: BacktestTrade[] = [];
  const equityCurve: { date: string; value: number }[] = [];
  let peakValue = initialCapital;
  let maxDrawdown = 0;

  for (const date of sortedDates) {
    // ── 1. 보유 포지션 청산 체크 ──────────────────────────────────────────────
    const toClose: number[] = [];

    for (let pi = 0; pi < positions.length; pi++) {
      const pos  = positions[pi];
      const bars = dataMap[pos.ticker];
      if (!bars) continue;
      const bar = bars.find(b => b.date === date);
      if (!bar) continue;

      let exitPrice:  number | null = null;
      let exitReason: BacktestTrade['exitReason'] | null = null;

      // 손절
      if (bar.low <= pos.stopLoss) {
        exitPrice  = Math.max(bar.open, pos.stopLoss); // 갭다운 고려
        exitReason = 'STOP_LOSS';
      } else {
        // 트레일링 고점 갱신
        if (bar.high > pos.trailHigh) pos.trailHigh = bar.high;
        const gainPct = (pos.trailHigh - pos.entryPrice) / pos.entryPrice;
        if (gainPct >= opts.trailActivatePct) pos.trailActive = true;

        if (pos.trailActive) {
          const trailStop = pos.trailHigh * 0.92; // -8% 트레일링
          if (bar.low <= trailStop) {
            exitPrice  = Math.max(bar.open, trailStop);
            exitReason = 'TRAILING_STOP';
          }
        }

        // 신호 악화 → 종가 청산
        if (!exitPrice) {
          const idx = bars.findIndex(b => b.date === date);
          if (idx >= 60) {
            const sl     = bars.slice(0, idx + 1);
            const { signal } = calcDailyScore(
              sl.map(b => b.close), sl.map(b => b.high),
              sl.map(b => b.low),   sl.map(b => b.volume)
            );
            if (signal === 'SELL' || signal === 'STRONG_SELL') {
              exitPrice  = bar.close;
              exitReason = 'SIGNAL_EXIT';
            }
          }
        }
      }

      if (exitPrice && exitReason) {
        const pnl      = (exitPrice - pos.entryPrice) * pos.shares;
        const pnlPct   = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;
        const holdDays = Math.round(
          (new Date(date).getTime() - new Date(pos.entryDate).getTime()) / 86400000
        );
        closedTrades.push({
          ticker:     pos.ticker,
          entryDate:  pos.entryDate,
          exitDate:   date,
          entryPrice: Math.round(pos.entryPrice * 100) / 100,
          exitPrice:  Math.round(exitPrice * 100) / 100,
          shares:     pos.shares,
          pnl:        Math.round(pnl * 100) / 100,
          pnlPct:     Math.round(pnlPct * 100) / 100,
          holdDays,
          exitReason,
          entryScore: pos.entryScore,
          signal:     pos.signal,
        });
        cash += pos.entryPrice * pos.shares + pnl;
        toClose.push(pi);
      }
    }
    for (const pi of toClose.sort((a, b) => b - a)) positions.splice(pi, 1);

    // ── 2. 신규 진입 ─────────────────────────────────────────────────────────
    if (positions.length < opts.maxPositions) {
      for (const ticker of tickers) {
        if (positions.length >= opts.maxPositions) break;
        if (positions.find(p => p.ticker === ticker)) continue;

        const bars = dataMap[ticker];
        if (!bars) continue;
        const idx = bars.findIndex(b => b.date === date);
        if (idx < 60) continue;

        const sl    = bars.slice(0, idx + 1);
        const { score, signal, atrAbs } = calcDailyScore(
          sl.map(b => b.close), sl.map(b => b.high),
          sl.map(b => b.low),   sl.map(b => b.volume)
        );

        if (signal !== 'BREAKOUT' && signal !== 'SETUP') continue;

        // 다음 거래일 시가로 진입
        const nextBar = bars[idx + 1];
        if (!nextBar || nextBar.date > endDate) continue;

        const entryPrice = nextBar.open > 0 ? nextBar.open : bars[idx].close;
        const stopLoss   = entryPrice - opts.atrStopMult * atrAbs;
        const posValue   = cash * opts.positionSizePct;
        const shares     = Math.floor(posValue / entryPrice);

        if (shares <= 0 || entryPrice * shares > cash) continue;

        cash -= entryPrice * shares;
        positions.push({
          ticker,
          entryDate:  nextBar.date,
          entryPrice,
          shares,
          stopLoss:    Math.round(stopLoss * 100) / 100,
          trailHigh:   entryPrice,
          trailActive: false,
          entryScore:  score,
          signal,
        });
      }
    }

    // ── 3. 자산 기록 ─────────────────────────────────────────────────────────
    const posValue = positions.reduce((sum, pos) => {
      const bar = dataMap[pos.ticker]?.find(b => b.date === date);
      return sum + (bar ? bar.close * pos.shares : pos.entryPrice * pos.shares);
    }, 0);
    const totalValue = Math.round(cash + posValue);
    equityCurve.push({ date, value: totalValue });

    if (totalValue > peakValue) peakValue = totalValue;
    const dd = ((peakValue - totalValue) / peakValue) * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // ── 4. 미청산 포지션 마지막날 종가 강제 청산 ─────────────────────────────
  const lastDate = sortedDates[sortedDates.length - 1] ?? endDate;
  for (const pos of positions) {
    const bar = dataMap[pos.ticker]?.find(b => b.date === lastDate);
    if (!bar) continue;
    const exitPrice = bar.close;
    const pnl       = (exitPrice - pos.entryPrice) * pos.shares;
    const pnlPct    = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;
    const holdDays  = Math.round(
      (new Date(lastDate).getTime() - new Date(pos.entryDate).getTime()) / 86400000
    );
    closedTrades.push({
      ticker:     pos.ticker,
      entryDate:  pos.entryDate,
      exitDate:   lastDate,
      entryPrice: Math.round(pos.entryPrice * 100) / 100,
      exitPrice:  Math.round(exitPrice * 100) / 100,
      shares:     pos.shares,
      pnl:        Math.round(pnl * 100) / 100,
      pnlPct:     Math.round(pnlPct * 100) / 100,
      holdDays,
      exitReason: 'END_OF_DATA',
      entryScore: pos.entryScore,
      signal:     pos.signal,
    });
    cash += pos.entryPrice * pos.shares + pnl;
  }

  // ── 5. 성과 지표 계산 ─────────────────────────────────────────────────────
  const wins   = closedTrades.filter(t => t.pnl > 0);
  const losses = closedTrades.filter(t => t.pnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss   = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const finalCapital = Math.round(initialCapital + closedTrades.reduce((s, t) => s + t.pnl, 0));
  const totalReturn  = ((finalCapital - initialCapital) / initialCapital) * 100;
  const days  = (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000;
  const years = days / 365;
  const cagr  = years > 0 ? (Math.pow(finalCapital / initialCapital, 1 / years) - 1) * 100 : 0;

  const winRate      = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0;
  const avgWin       = wins.length   > 0 ? wins.reduce((s, t) => s + t.pnlPct, 0)   / wins.length   : 0;
  const avgLoss      = losses.length > 0 ? losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;
  const avgHoldDays  = closedTrades.length > 0
    ? closedTrades.reduce((s, t) => s + t.holdDays, 0) / closedTrades.length : 0;
  const pnlPcts      = closedTrades.map(t => t.pnlPct);
  const bestTrade    = pnlPcts.length > 0 ? Math.max(...pnlPcts) : 0;
  const worstTrade   = pnlPcts.length > 0 ? Math.min(...pnlPcts) : 0;

  const tickerResults: TickerResult[] = tickers.map(ticker => {
    const ts = closedTrades.filter(t => t.ticker === ticker);
    const tw = ts.filter(t => t.pnl > 0);
    return {
      ticker,
      trades:      ts.length,
      winTrades:   tw.length,
      winRate:     ts.length > 0 ? Math.round((tw.length / ts.length) * 100) : 0,
      totalPnl:    Math.round(ts.reduce((s, t) => s + t.pnl, 0) * 100) / 100,
      totalPnlPct: Math.round(ts.reduce((s, t) => s + t.pnlPct, 0) * 100) / 100,
    };
  });

  return {
    metrics: {
      initialCapital,
      finalCapital,
      totalReturn:   Math.round(totalReturn * 100) / 100,
      cagr:          Math.round(cagr * 100) / 100,
      winRate:       Math.round(winRate * 100) / 100,
      avgWin:        Math.round(avgWin * 100) / 100,
      avgLoss:       Math.round(avgLoss * 100) / 100,
      profitFactor:  Math.round(profitFactor * 100) / 100,
      maxDrawdown:   Math.round(maxDrawdown * 100) / 100,
      totalTrades:   closedTrades.length,
      winTrades:     wins.length,
      lossTrades:    losses.length,
      avgHoldDays:   Math.round(avgHoldDays),
      bestTrade:     Math.round(bestTrade * 100) / 100,
      worstTrade:    Math.round(worstTrade * 100) / 100,
    },
    trades:         closedTrades.sort((a, b) => a.entryDate.localeCompare(b.entryDate)),
    tickerResults,
    equityCurve,
    startDate,
    endDate,
  };
}
