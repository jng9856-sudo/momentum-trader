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

  const prompt = `You are an expert stock momentum analyst using CAN SLIM / IBD strategy.

Today is ${today}. Analyze these semiconductor/tech stocks: ${tickers.join(', ')}.

Evaluate each on: RS vs S&P500 (YTD), RS within semiconductor sector, 50-day MA position, chart pattern, volume.
BUY = strong RS + above MA50 + constructive pattern. SELL = weak RS + failing MA50 + downtrend.

Return ONLY raw JSON starting with { and ending with }. No markdown. No backticks. No other text.

{"stocks":[{"ticker":"AMD","signal":"BUY","confidence":"HIGH","momentum_score":8,"rs_vs_index":"STRONG","rs_vs_sector":"STRONG","ma50_status":"ABOVE","pattern":"BREAKOUT","volume_confirmation":true,"entry_zone":"$120-$125","key_support":"$115","key_resistance":"$135","stop_loss":"$113","summary":"한국어 2-3문장 분석.","caution":null}],"market_context":"한국어 시장 컨텍스트 2-3문장."}`;

  const models = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-flash-latest'];

  for (const model of models) {
    for (const withSearch of [true, false]) {
      try {
        const body: Record<string, unknown> = {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 4000 },
        };
        if (withSearch) body.tools = [{ googleSearch: {} }];

        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        );

        if (!res.ok) continue;

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
        return NextResponse.json(parsed);
      } catch { continue; }
    }
  }

  return NextResponse.json({ error: 'Gemini API 호출 실패. API Key와 할당량을 확인해주세요.' }, { status: 500 });
}
