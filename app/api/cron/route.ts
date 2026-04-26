import { NextRequest, NextResponse } from 'next/server';
import { saveAnalysisCache } from '@/lib/supabase';

// ── 간단한 분석 함수 (analyze/route.ts 의 핵심 로직 재사용) ──────────────────
function calcMA(closes: number[], period: number): number {
  const sl = closes.slice(-period);
  return sl.length < period ? NaN : sl.reduce((a, b) => a + b, 0) / period;
}
function calcEMA(data: number[], p: number): number[] {
  const k = 2/(p+1); let prev = data[0];
  return data.map(d => { prev = d*k + prev*(1-k); return prev; });
}
function calcRSI(closes: number[], period = 14): number {
  const ch = closes.slice(1).map((c,i) => c - closes[i]);
  const g = ch.map(c => c>0?c:0), l = ch.map(c => c<0?-c:0);
  let ag = g.slice(0,period).reduce((a,b)=>a+b,0)/period;
  let al = l.slice(0,period).reduce((a,b)=>a+b,0)/period;
  for (let i = period; i < ch.length; i++) {
    ag = (ag*(period-1)+g[i])/period; al = (al*(period-1)+l[i])/period;
  }
  return al === 0 ? 100 : 100 - 100/(1+ag/al);
}
function calcMACDHist(closes: number[]): number {
  const e12 = calcEMA(closes,12), e26 = calcEMA(closes,26);
  const line = e12.map((v,i) => v-e26[i]);
  const sig  = calcEMA(line.slice(-60),9);
  return line[line.length-1] - sig[sig.length-1];
}
function calcATR(hs: number[], ls: number[], cs: number[], p = 14): number {
  const trs: number[] = [];
  for (let i = 1; i < hs.length; i++)
    trs.push(Math.max(hs[i]-ls[i], Math.abs(hs[i]-cs[i-1]), Math.abs(ls[i]-cs[i-1])));
  return trs.slice(-p).reduce((a,b)=>a+b,0)/p;
}

async function fetchAndAnalyze(ticker: string, spyYtd: number, sectorAvg: number) {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1y`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const q = result.indicators?.quote?.[0] ?? {};
    const timestamps: number[] = result.timestamp ?? [];
    const cs: number[] = (q.close  ?? []).filter((c: number) => c != null && !isNaN(c));
    const hs: number[] = (q.high   ?? []).filter((h: number) => h != null && !isNaN(h));
    const ls: number[] = (q.low    ?? []).filter((l: number) => l != null && !isNaN(l));
    const vs: number[] = (q.volume ?? []).filter((v: number) => v != null && !isNaN(v));
    if (cs.length < 60) return null;

    const price = cs[cs.length-1];
    const yearStart = new Date(new Date().getFullYear(),0,1).getTime()/1000;
    const ytdIdx = timestamps.findIndex((t: number) => t >= yearStart);
    const ytdBase = cs[ytdIdx >= 0 ? ytdIdx : 0];
    const ytdReturn = ((price - ytdBase) / ytdBase) * 100;

    const ma10 = calcMA(cs,10), ma20 = calcMA(cs,20), ma50 = calcMA(cs,50);
    const ma120 = calcMA(cs,120);
    const rsi = calcRSI(cs.slice(-30));
    const macd = calcMACDHist(cs);
    const atr  = calcATR(hs.slice(-20), ls.slice(-20), cs.slice(-20));
    const high52w = Math.max(...cs.slice(-252));
    const distFromHigh = ((price - high52w) / high52w) * 100;
    const avgVol = vs.slice(-21,-1).reduce((a,b)=>a+b,0)/20;
    const volRatio = avgVol > 0 ? vs[vs.length-1]/avgVol : 1;

    const mas = [ma10,ma20,ma50,ma120].filter(m => !isNaN(m));
    const aboveCount = mas.filter(m => price > m).length;
    const excessIdx = ytdReturn - spyYtd;
    const excessSec = ytdReturn - sectorAvg;

    const rsIndex  = excessIdx  >  5 ? 'STRONG' : excessIdx  < -5 ? 'WEAK' : 'NEUTRAL';
    const rsSector = excessSec  >  3 ? 'STRONG' : excessSec  < -3 ? 'WEAK' : 'NEUTRAL';
    const ma50Status = price > ma50*1.01 ? 'ABOVE' : price < ma50*0.99 ? 'BELOW' : 'AT';

    let score = 5;
    score += (aboveCount - 2.5) * 0.5;
    if (rsIndex  === 'STRONG') score += 1; else if (rsIndex  === 'WEAK') score -= 1;
    if (rsSector === 'STRONG') score += 1; else if (rsSector === 'WEAK') score -= 1;
    if (rsi >= 45 && rsi <= 70) score += 0.5; else if (rsi > 80 || rsi < 30) score -= 0.5;
    if (macd > 0) score += 0.5; else score -= 0.5;
    if (volRatio > 1.5) score += 0.5;
    if (distFromHigh > -8) score += 0.5;
    score = Math.max(1, Math.min(10, Math.round(score*2)/2));

    let signal: string;
    if (score >= 8 && aboveCount >= 3 && macd > 0 && rsIndex !== 'WEAK') signal = 'STRONG_BUY';
    else if (score >= 7 && aboveCount >= 3 && rsIndex !== 'WEAK') signal = 'BUY';
    else if (score <= 2 || (aboveCount === 0 && macd < 0 && rsIndex === 'WEAK')) signal = 'STRONG_SELL';
    else if (score <= 4 || (aboveCount <= 1 && rsIndex === 'WEAK')) signal = 'SELL';
    else signal = 'HOLD';

    const r = (n: number, d=2) => Math.round(n*10**d)/10**d;
    const stopLoss = `$${r(price - 2*atr)}`;
    const entry = signal.includes('BUY') ? `$${r(price*0.99)}–$${r(price*1.02)}` : null;

    return {
      ticker, signal, confidence: score >= 8 ? 'HIGH' : score >= 6 ? 'MEDIUM' : 'LOW',
      momentum_score: score,
      rs_vs_index: rsIndex, rs_vs_sector: rsSector,
      ma50_status: ma50Status, pattern: 'NONE',
      volume_confirmation: volRatio > 1.5,
      entry_zone: entry, key_support: `$${r(ma50)}`, key_resistance: `$${r(high52w)}`,
      stop_loss: stopLoss,
      summary: `[${signal}] YTD ${ytdReturn > 0?'+':''}${r(ytdReturn,1)}% | RSI ${r(rsi,1)} | MA ${aboveCount}/4개 위`,
      caution: rsi > 78 ? 'RSI 과열' : null,
      rsi: r(rsi,1), macd_histogram: r(macd,4), bb_position: 50,
      atr_pct: r((atr/price)*100,2), volume_ratio: r(volRatio,2),
    };
  } catch { return null; }
}

// Vercel Cron: 매일 오전 7시 KST (= UTC 22:00 전날) → "0 22 * * 1-5"
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const watchlistStr = process.env.ALERT_WATCHLIST ?? 'AMD,MRVL,AVGO,MU,NVDA,ARM,TSM,INTC,SOXX,QQQ';
  const tickers = watchlistStr.split(',').map((t: string) => t.trim()).filter(Boolean);

  // Fetch SPY first for benchmark
  let spyYtd = 0;
  try {
    const sr = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1d&range=1y', { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const sd = await sr.json();
    const sc = sd?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter((c: number) => c != null && !isNaN(c)) ?? [];
    const st: number[] = sd?.chart?.result?.[0]?.timestamp ?? [];
    const ys = new Date(new Date().getFullYear(),0,1).getTime()/1000;
    const yi = st.findIndex((t: number) => t >= ys);
    if (sc.length > 0) spyYtd = ((sc[sc.length-1] - sc[yi >= 0 ? yi : 0]) / sc[yi >= 0 ? yi : 0]) * 100;
  } catch {}

  // Analyze all tickers
  const rawResults = await Promise.all(tickers.map(t => fetchAndAnalyze(t, spyYtd, spyYtd)));
  const stocks = rawResults.filter(Boolean);
  const sectorAvg = stocks.length ? stocks.reduce((a, s) => a + (s?.momentum_score ?? 5), 0) / stocks.length : 5;
  void sectorAvg;

  if (stocks.length === 0) return NextResponse.json({ ok: false, message: '분석 실패' });

  // Save to Supabase
  const date = new Date().toISOString().slice(0, 10);
  const strongBuys = stocks.filter(s => s?.signal === 'STRONG_BUY').map(s => s?.ticker);
  const buys = stocks.filter(s => s?.signal === 'BUY').map(s => s?.ticker);
  const market_context = `자동 크론 분석 — 즉시매수: ${strongBuys.join(', ') || '없음'} | 매수: ${buys.slice(0,5).join(', ') || '없음'}`;

  await saveAnalysisCache({ analysis_date: date, stocks: stocks as Record<string, unknown>[], market_context });

  // KakaoTalk 알림
  const alerts = stocks.filter(s => s?.signal === 'STRONG_BUY' || s?.signal === 'BUY');
  if (alerts.length > 0) {
    const kakaoToken = process.env.KAKAO_ACCESS_TOKEN;
    if (kakaoToken) {
      const today = new Date().toLocaleDateString('ko-KR', { month:'long', day:'numeric', weekday:'short' });
      const msg = `📊 Momentum Signal — ${today}\n\n매수 신호 ${alerts.length}개\n\n` +
        alerts.map(s => `${s?.signal === 'STRONG_BUY' ? '🟢' : '🔵'} ${s?.ticker}: ${s?.momentum_score}/10점 | ${s?.entry_zone ?? '-'}`).join('\n') +
        '\n\n분석 보기 →';
      await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${kakaoToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ template_object: JSON.stringify({
          object_type: 'text', text: msg,
          link: { web_url: process.env.NEXT_PUBLIC_SITE_URL ?? 'https://momentum-trader.vercel.app' },
          button_title: '분석 보기',
        }) }),
      }).catch(() => {});
    }

    // Email fallback
    const alertEmail = process.env.ALERT_EMAIL;
    const resendKey  = process.env.RESEND_API_KEY;
    if (alertEmail && resendKey) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Momentum Signal <onboarding@resend.dev>',
          to: alertEmail,
          subject: `📊 매수 신호 ${alerts.length}개 — ${date}`,
          html: `<pre>${alerts.map(s => `${s?.ticker}: ${s?.signal} ${s?.momentum_score}/10점`).join('\n')}</pre>`,
        }),
      }).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, analyzed: stocks.length, alerts: alerts.length, date });
}
