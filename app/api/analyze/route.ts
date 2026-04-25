import { NextRequest, NextResponse } from 'next/server';

interface YahooQuote {
  ticker: string;
  price: number;
  change1d: number;
  ytdReturn: number;
  ma50: number;
  ma200: number;
  high52w: number;
  low52w: number;
  aboveMa50: boolean;
  distFromHigh: number;
}

async function fetchYahooData(ticker: string): Promise<YahooQuote | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1y`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return null;
    const data = await res.json();

    const closes: number[] = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const timestamps: number[] = data?.chart?.result?.[0]?.timestamps ?? [];
    if (closes.length < 50) return null;

    const validCloses = closes.filter((c: number) => c != null && !isNaN(c));
    const price = validCloses[validCloses.length - 1];
    const prev = validCloses[validCloses.length - 2];
    const change1d = prev ? ((price - prev) / prev) * 100 : 0;

    // YTD: find first trading day of this year
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1).getTime() / 1000;
    let ytdStartIdx = 0;
    for (let i = 0; i < timestamps.length; i++) {
      if (timestamps[i] >= yearStart) { ytdStartIdx = i; break; }
    }
    const ytdStartPrice = validCloses[ytdStartIdx] ?? validCloses[0];
    const ytdReturn = ((price - ytdStartPrice) / ytdStartPrice) * 100;

    // 50-day & 200-day MA
    const last50 = validCloses.slice(-50);
    const last200 = validCloses.slice(-200);
    const ma50 = last50.reduce((a: number, b: number) => a + b, 0) / last50.length;
    const ma200 = last200.length >= 200
      ? last200.reduce((a: number, b: number) => a + b, 0) / last200.length
      : ma50;

    const high52w = Math.max(...validCloses);
    const low52w = Math.min(...validCloses);
    const distFromHigh = ((price - high52w) / high52w) * 100;

    return {
      ticker,
      price: Math.round(price * 100) / 100,
      change1d: Math.round(change1d * 10) / 10,
      ytdReturn: Math.round(ytdReturn * 10) / 10,
      ma50: Math.round(ma50 * 100) / 100,
      ma200: Math.round(ma200 * 100) / 100,
      high52w: Math.round(high52w * 100) / 100,
      low52w: Math.round(low52w * 100) / 100,
      aboveMa50: price > ma50,
      distFromHigh: Math.round(distFromHigh * 10) / 10,
    };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
  }

  let tickers: string[];
  try {
    const body = await req.json();
    tickers = body.tickers;
    if (!Array.isArray(tickers) || tickers.length === 0) throw new Error('invalid');
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Fetch real-time data from Yahoo Finance (no API key needed)
  const stockData = await Promise.all(tickers.map(fetchYahooData));
  const validData = stockData.filter((d): d is YahooQuote => d !== null);

  if (validData.length === 0) {
    return NextResponse.json({ error: '주가 데이터를 가져올 수 없습니다. 잠시 후 다시 시도해주세요.' }, { status: 500 });
  }

  // Also fetch SPY for relative strength comparison
  const spyData = await fetchYahooData('SPY');
  const spyYtd = spyData?.ytdReturn ?? 0;

  const dataStr = validData.map(d => `
${d.ticker}:
  현재가: $${d.price}
  전일 대비: ${d.change1d}%
  YTD 수익률: ${d.ytdReturn}% (S&P500 YTD: ${spyYtd.toFixed(1)}%)
  S&P500 대비 초과 수익: ${(d.ytdReturn - spyYtd).toFixed(1)}%
  50일 이동평균: $${d.ma50} → 현재가 50일선 ${d.aboveMa50 ? '위' : '아래'}
  200일 이동평균: $${d.ma200}
  52주 최고가: $${d.high52w} (현재 고점 대비 ${d.distFromHigh}%)
  52주 최저가: $${d.low52w}
`).join('\n');

  const today = new Date().toLocaleDateString('ko-KR');
  const prompt = `You are an expert stock momentum analyst using CAN SLIM / IBD strategy.
Today is ${today}. Here is real-time market data fetched from Yahoo Finance:

${dataStr}

Based on this data, analyze each stock:
- BUY: strong RS vs S&P500 (positive excess return), price above MA50, constructive price action near highs
- SELL: negative RS, price below MA50, extended downtrend
- HOLD: mixed signals

For chart patterns, infer from: distance from 52w high (within 5-15% = potential base), above/below MAs, momentum.

Return ONLY raw JSON. No markdown. No backticks. Start with { end with }:
{"stocks":[{"ticker":"AMD","signal":"BUY","confidence":"HIGH","momentum_score":8,"rs_vs_index":"STRONG","rs_vs_sector":"STRONG","ma50_status":"ABOVE","pattern":"BREAKOUT","volume_confirmation":true,"entry_zone":"$120-$125","key_support":"$115","key_resistance":"$135","stop_loss":"$113","summary":"한국어 2-3문장 분석.","caution":null}],"market_context":"한국어 반도체 시장 컨텍스트 2-3문장."}

signal:"BUY"|"SELL"|"HOLD" confidence:"HIGH"|"MEDIUM"|"LOW" rs_vs_index:"STRONG"|"NEUTRAL"|"WEAK" rs_vs_sector:"STRONG"|"NEUTRAL"|"WEAK" ma50_status:"ABOVE"|"AT"|"BELOW" pattern:"CUP"|"W_BASE"|"BREAKOUT"|"DOWNTREND"|"NONE"`;

  const models = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-flash-latest'];

  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 4000 },
          }),
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        console.error(`Model ${model} failed:`, errText);
        continue;
      }

      const data = await res.json();
      const text = (data.candidates?.[0]?.content?.parts ?? [])
        .filter((p: { text?: string }) => p.text)
        .map((p: { text: string }) => p.text)
        .join('');

      if (!text) continue;

      let raw = text.trim().replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const js = raw.indexOf('{'), je = raw.lastIndexOf('}');
      if (js === -1 || je === -1) continue;

      const parsed = JSON.parse(raw.substring(js, je + 1));
      parsed.analyzed_at = new Date().toISOString();
      // Attach real price data for display
      parsed.priceData = validData;
      parsed.spyYtd = spyYtd;

      return NextResponse.json(parsed);
    } catch (e) {
      console.error(`Model ${model} error:`, e);
      continue;
    }
  }

  return NextResponse.json(
    { error: 'Gemini 분석 실패. API Key를 확인하거나 잠시 후 다시 시도해주세요.' },
    { status: 500 }
  );
}
