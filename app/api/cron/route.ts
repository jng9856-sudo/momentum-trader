import { NextRequest, NextResponse } from 'next/server';

// Vercel Cron: 매일 오전 7시 (KST = UTC 22:00 전날)
// vercel.json 에 설정 필요

const DEFAULT_WATCHLIST = ['AMD','MRVL','AVGO','MU','NVDA','ARM','TSM','INTC'];

function calcMA(closes: number[], period: number): number {
  const sl = closes.slice(-period);
  return sl.length < period ? NaN : sl.reduce((a, b) => a + b, 0) / period;
}

async function fetchAndAnalyze(ticker: string): Promise<{ ticker: string; vcpScore: number; pivotBroken: boolean; pivotPrice: number | null; volumeRatio: number; distFromHigh: number } | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1y`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const closes:  number[] = (result.indicators?.quote?.[0]?.close  ?? []).filter((c: number) => c != null && !isNaN(c));
    const volumes: number[] = (result.indicators?.quote?.[0]?.volume ?? []).filter((v: number) => v != null && !isNaN(v));
    if (closes.length < 60) return null;

    const price = closes[closes.length - 1];
    const high52w = Math.max(...closes.slice(-252));
    const distFromHigh = ((price - high52w) / high52w) * 100;
    const ma20 = calcMA(closes, 20), ma50 = calcMA(closes, 50);

    // Simple VCP score
    const WEEK = 5;
    const weeks: { high: number; low: number; avgVol: number }[] = [];
    for (let i = closes.length - 60; i < closes.length; i += WEEK) {
      const sl = closes.slice(i, i+WEEK), vsl = volumes.slice(i, i+WEEK).filter(v => v > 0);
      weeks.push({ high: Math.max(...sl), low: Math.min(...sl), avgVol: vsl.length ? vsl.reduce((a,b)=>a+b,0)/vsl.length : 0 });
    }

    const pullbacks: number[] = [];
    for (let i = 1; i < weeks.length; i++) {
      const pb = ((weeks[i-1].high - weeks[i].low) / weeks[i-1].high) * 100;
      if (pb > 0) pullbacks.push(pb);
    }

    let contractions = 0;
    for (let i = 1; i < pullbacks.length; i++) {
      if (pullbacks[i] < pullbacks[i-1] * 0.85) contractions++;
    }

    const lastPB = pullbacks[pullbacks.length-1] ?? 0;
    const overallVol = weeks.map(w => w.avgVol).reduce((a,b)=>a+b,0) / weeks.length;
    const lowVol = Math.min(...weeks.slice(-3).map(w => w.avgVol)) < overallVol * 0.7;

    let vcpScore = 0;
    if (distFromHigh > -5) vcpScore += 25;
    else if (distFromHigh > -10) vcpScore += 10;
    if (weeks.length >= 6) vcpScore += 20;
    if (lowVol) vcpScore += 20;
    vcpScore += Math.min(20, contractions * 7);
    if (lastPB <= 2) vcpScore += 15; else if (lastPB <= 4) vcpScore += 10;

    const pivotPrice = Math.max(...weeks.map(w => w.high));
    const pivotBroken = price > pivotPrice;
    const avgVol20 = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
    const volumeRatio = avgVol20 > 0 ? volumes[volumes.length-1] / avgVol20 : 1;

    return {
      ticker, vcpScore: Math.min(100, vcpScore), pivotBroken,
      pivotPrice: Math.round(pivotPrice * 100) / 100,
      volumeRatio: Math.round(volumeRatio * 100) / 100,
      distFromHigh: Math.round(distFromHigh * 10) / 10,
    };
  } catch { return null; }
}

async function sendKakaoMessage(accessToken: string, message: string): Promise<boolean> {
  try {
    const res = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        template_object: JSON.stringify({
          object_type: 'text',
          text: message,
          link: { web_url: process.env.NEXT_PUBLIC_SITE_URL ?? 'https://momentum-trader.vercel.app' },
          button_title: '분석 보기',
        }),
      }),
    });
    return res.ok;
  } catch { return false; }
}

async function sendEmail(to: string, subject: string, body: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Momentum Signal <alerts@momentum-trader.com>',
        to, subject,
        html: body.replace(/\n/g, '<br>'),
      }),
    });
    return res.ok;
  } catch { return false; }
}

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const watchlistStr = process.env.ALERT_WATCHLIST ?? DEFAULT_WATCHLIST.join(',');
  const tickers = watchlistStr.split(',').map(t => t.trim()).filter(Boolean);

  const results = await Promise.all(tickers.map(fetchAndAnalyze));
  const valid = results.filter(Boolean);

  // Filter: VCP ≥ 60 and pivot broken with volume
  const alerts = valid.filter(s =>
    s && s.vcpScore >= 60 &&
    (s.pivotBroken && s.volumeRatio >= 1.3 || s.distFromHigh > -3)
  );

  if (alerts.length === 0) {
    return NextResponse.json({ message: '알림 조건 충족 종목 없음', checked: tickers.length });
  }

  const today = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
  const lines = alerts.map(s => {
    if (!s) return '';
    const status = s.pivotBroken ? `✅ 피봇 돌파 (거래량 ${s.volumeRatio}x)` : `⏳ 피봇 대기`;
    return `${s.ticker}: VCP ${s.vcpScore}점 | 피봇가 $${s.pivotPrice} | ${status} | 고점 대비 ${s.distFromHigh}%`;
  }).join('\n');

  const message = `📊 Momentum Signal — ${today}\n\n매수 신호 종목 (${alerts.length}개)\n\n${lines}\n\n전체 분석 보기`;

  let notified = false;

  // KakaoTalk
  const kakaoToken = process.env.KAKAO_ACCESS_TOKEN;
  if (kakaoToken) {
    notified = await sendKakaoMessage(kakaoToken, message);
  }

  // Email fallback
  const alertEmail = process.env.ALERT_EMAIL;
  if (alertEmail && !notified) {
    await sendEmail(alertEmail, `📊 매수 신호 ${alerts.length}개 — ${today}`, message);
  }

  return NextResponse.json({ alerts: alerts.length, tickers: alerts.map(s => s?.ticker), notified });
}

