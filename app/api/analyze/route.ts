import { NextRequest, NextResponse } from 'next/server';

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

  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const prompt = `You are an expert stock momentum analyst using the CAN SLIM / IBD momentum strategy.

Today is ${today}. Search Google for current stock prices, YTD performance, and recent technical data for these tickers: ${tickers.join(', ')}.

Analysis criteria:
1. RELATIVE STRENGTH vs S&P500: Is the stock outperforming the index YTD?
2. RELATIVE STRENGTH vs SECTOR: Is it a leader within semiconductors/tech sector?
3. MA50 STATUS: Is price above, at, or below the 50-day moving average?
4. CHART PATTERN: Cup&Handle, W-base, Breakout, Downtrend, or None?
5. VOLUME: Volume confirmation on breakout days?

BUY signal requires: strong RS + above MA50 + constructive base pattern
SELL/HOLD signal: weak RS vs sector, failing moving averages, downtrend

IMPORTANT: Return ONLY a raw JSON object. No markdown. No backticks. No explanation text before or after. Just the JSON.

Required format:
{"stocks":[{"ticker":"AMD","signal":"BUY","confidence":"HIGH","momentum_score":8,"rs_vs_index":"STRONG","rs_vs_sector":"STRONG","ma50_status":"ABOVE","pattern":"BREAKOUT","volume_confirmation":true,"entry_zone":"$120-$125","key_support":"$115","key_resistance":"$135","stop_loss":"$113","summary":"한국어로 2-3문장 분석 요약.","caution":null}],"market_context":"한국어로 반도체 시장 전반 컨텍스트 2-3문장."}

signal: "BUY" | "SELL" | "HOLD"
confidence: "HIGH" | "MEDIUM" | "LOW"
rs_vs_index: "STRONG" | "NEUTRAL" | "WEAK"
rs_vs_sector: "STRONG" | "NEUTRAL" | "WEAK"
ma50_status: "ABOVE" | "AT" | "BELOW"
pattern: "CUP" | "W_BASE" | "BREAKOUT" | "DOWNTREND" | "NONE"`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 4000,
          },
        }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      console.error('Gemini API error:', err);
      return NextResponse.json({ error: 'Gemini API error', detail: err }, { status: 500 });
    }

    const data = await res.json();

    // Extract text from all parts (Gemini may split across parts)
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .filter((p: { text?: string }) => p.text)
      .map((p: { text: string }) => p.text)
      .join('');

    if (!text) {
      return NextResponse.json({ error: '응답 텍스트 없음', raw: JSON.stringify(data).slice(0, 300) }, { status: 500 });
    }

    // Strip any accidental markdown fences
    let raw = text.trim().replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) {
      return NextResponse.json({ error: 'JSON 파싱 실패', raw: raw.slice(0, 300) }, { status: 500 });
    }

    const parsed = JSON.parse(raw.substring(jsonStart, jsonEnd + 1));
    parsed.analyzed_at = new Date().toISOString();

    return NextResponse.json(parsed);
  } catch (err) {
    console.error('Route error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
