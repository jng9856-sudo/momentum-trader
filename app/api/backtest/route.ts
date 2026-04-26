import { NextRequest, NextResponse } from 'next/server';

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
  const g = ch.map(c => c > 0 ? c : 0), l = ch.map(c => c < 0 ? -c : 0);
  let ag = g.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let al = l.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < ch.length; i++) {
    ag = (ag*(period-1)+g[i])/period; al = (al*(period-1)+l[i])/period;
  }
  return al === 0 ? 100 : 100 - 100/(1+ag/al);
}

interface BacktestSignal {
  date: string;
  price: number;
  signalType: string;
  vcpScore: number;
  ret5d: number | null;
  ret10d: number | null;
  ret20d: number | null;
  ret60d: number | null;
  isWin5d: boolean | null;
  isWin20d: boolean | null;
}

function detectVCPAtPoint(closes: number[], volumes: number[], idx: number): number {
  if (idx < 60) return 0;
  const window = closes.slice(Math.max(0, idx - 60), idx + 1);
  const vWindow = volumes.slice(Math.max(0, idx - 60), idx + 1);
  if (window.length < 30) return 0;

  const WEEK = 5;
  const weeks: { high: number; low: number; avgVol: number }[] = [];
  for (let i = 0; i < window.length - WEEK; i += WEEK) {
    const sl = window.slice(i, i + WEEK), vsl = vWindow.slice(i, i + WEEK).filter(v => v > 0);
    weeks.push({ high: Math.max(...sl), low: Math.min(...sl), avgVol: vsl.length ? vsl.reduce((a,b)=>a+b,0)/vsl.length : 0 });
  }
  if (weeks.length < 4) return 0;

  const baseHigh = Math.max(...weeks.map(w => w.high));
  const pullbacks: number[] = [];
  for (let i = 1; i < weeks.length; i++) {
    const pb = ((weeks[i-1].high - weeks[i].low) / weeks[i-1].high) * 100;
    if (pb > 0) pullbacks.push(pb);
  }

  let contractions = 0;
  for (let i = 1; i < pullbacks.length; i++) {
    if (pullbacks[i] < pullbacks[i-1] * 0.85) contractions++;
  }

  const price = closes[idx];
  const distFromHigh = ((price - baseHigh) / baseHigh) * 100;
  const lastPB = pullbacks[pullbacks.length - 1] ?? 0;
  const overallVol = weeks.map(w => w.avgVol).reduce((a,b)=>a+b,0) / weeks.length;
  const lowVolInBase = Math.min(...weeks.slice(-4).map(w => w.avgVol)) < overallVol * 0.7;

  let score = 0;
  if (distFromHigh > -5)  score += 25;
  else if (distFromHigh > -10) score += 10;
  if (weeks.length >= 6)  score += 20;
  else if (weeks.length >= 4) score += 10;
  if (lowVolInBase) score += 20;
  score += Math.min(20, contractions * 7);
  if (lastPB <= 2) score += 15;
  else if (lastPB <= 4) score += 10;
  else if (lastPB <= 6) score += 5;

  return Math.min(100, score);
}

export async function POST(req: NextRequest) {
  let ticker: string, months: number;
  try {
    const body = await req.json();
    ticker = body.ticker; months = Math.min(12, Math.max(1, body.months ?? 6));
    if (!ticker) throw new Error('invalid');
  } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }

  try {
    const range = months <= 3 ? '6mo' : months <= 6 ? '1y' : '2y';
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=${range}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 0 } }
    );
    if (!res.ok) return NextResponse.json({ error: '데이터 없음' }, { status: 404 });

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return NextResponse.json({ error: '데이터 없음' }, { status: 404 });

    const timestamps: number[] = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0] ?? {};
    const closes:  number[] = (q.close  ?? []).filter((c: number) => c != null && !isNaN(c));
    const volumes: number[] = (q.volume ?? []).filter((v: number) => v != null && !isNaN(v));

    if (closes.length < 60) return NextResponse.json({ error: '데이터 부족' }, { status: 400 });

    const cutoff = Date.now() - months * 30 * 24 * 60 * 60 * 1000;
    const signals: BacktestSignal[] = [];

    for (let i = 60; i < closes.length - 5; i++) {
      const ts = timestamps[i] * 1000;
      if (ts < cutoff) continue;

      const vcpScore = detectVCPAtPoint(closes, volumes, i);
      if (vcpScore < 50) continue;

      const rsi = calcRSI(closes.slice(Math.max(0, i-30), i+1));
      const ma20 = calcMA(closes.slice(0, i+1), 20);
      const ma50 = calcMA(closes.slice(0, i+1), 50);
      const price = closes[i];

      // Check for pivot breakout signal
      const recent = closes.slice(Math.max(0, i-10), i);
      const localHigh = Math.max(...recent);
      const isBreakout = price > localHigh && price > ma20 && price > ma50;
      const signalType = isBreakout ? 'VCP 피봇 돌파' : vcpScore >= 70 ? 'VCP 고점수' : 'VCP 신호';

      // Calculate forward returns
      const ret5d  = closes[i+5]  ? ((closes[i+5]  - price) / price) * 100 : null;
      const ret10d = closes[i+10] ? ((closes[i+10] - price) / price) * 100 : null;
      const ret20d = closes[i+20] ? ((closes[i+20] - price) / price) * 100 : null;
      const ret60d = closes[i+60] ? ((closes[i+60] - price) / price) * 100 : null;

      const date = new Date(ts).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });

      signals.push({
        date, price: Math.round(price * 100) / 100, signalType, vcpScore,
        ret5d:  ret5d  ? Math.round(ret5d  * 10) / 10 : null,
        ret10d: ret10d ? Math.round(ret10d * 10) / 10 : null,
        ret20d: ret20d ? Math.round(ret20d * 10) / 10 : null,
        ret60d: ret60d ? Math.round(ret60d * 10) / 10 : null,
        isWin5d:  ret5d  !== null ? ret5d  > 0 : null,
        isWin20d: ret20d !== null ? ret20d > 0 : null,
      });

      // Skip ahead to avoid overlapping signals (at least 10 days apart)
      i += 10;
    }

    if (signals.length === 0) {
      return NextResponse.json({ ticker, signals: [], stats: null, months });
    }

    // Stats
    const with5d  = signals.filter(s => s.ret5d  !== null);
    const with20d = signals.filter(s => s.ret20d !== null);
    const wins5d  = with5d.filter(s => s.isWin5d);
    const wins20d = with20d.filter(s => s.isWin20d);

    const avg5d  = with5d.length  ? with5d.reduce((a, s)  => a + (s.ret5d  ?? 0), 0) / with5d.length  : 0;
    const avg20d = with20d.length ? with20d.reduce((a, s) => a + (s.ret20d ?? 0), 0) / with20d.length : 0;
    const maxWin = Math.max(...signals.map(s => s.ret20d ?? 0));
    const maxLoss = Math.min(...signals.map(s => s.ret20d ?? 0));

    const stats = {
      totalSignals: signals.length,
      winRate5d:  with5d.length  ? Math.round((wins5d.length  / with5d.length)  * 100) : 0,
      winRate20d: with20d.length ? Math.round((wins20d.length / with20d.length) * 100) : 0,
      avgRet5d:  Math.round(avg5d  * 10) / 10,
      avgRet20d: Math.round(avg20d * 10) / 10,
      maxWin:    Math.round(maxWin  * 10) / 10,
      maxLoss:   Math.round(maxLoss * 10) / 10,
      profitFactor: maxLoss !== 0 ? Math.round((maxWin / Math.abs(maxLoss)) * 10) / 10 : 0,
    };

    return NextResponse.json({ ticker, signals, stats, months });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

