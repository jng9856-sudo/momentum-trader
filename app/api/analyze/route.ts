import { NextRequest, NextResponse } from 'next/server';

const SYSTEM_PROMPT = `You are an expert stock momentum analyst specializing in the CAN SLIM / IBD-style momentum strategy.

Your analysis framework:
1. RELATIVE STRENGTH vs S&P 500: Is the stock outperforming the index over the last 3-12 months?
2. RELATIVE STRENGTH vs SECTOR: Is it the leader within its sector (semiconductors, AI, tech)?
3. MA50 STATUS: Is the stock trading above its 50-day moving average? Has it held or reclaimed it?
4. CHART PATTERN: Are there constructive bases? (Cup & Handle, W-base, Flat base, Breakout from consolidation)
5. VOLUME CONFIRMATION: Is there above-average volume on up days and below-average on down days?
6. MOMENTUM SCORE: Aggregate 1-10 score considering all factors

BUY criteria (ALL required):
- Strong RS vs index AND sector
- Price above 50-day MA (or recently reclaimed it with volume)
- Clean base pattern OR recent breakout not extended >5% from pivot
- Volume confirmation on breakout days

SELL/AVOID criteria (ANY trigger):
- RS weakening vs index or falling behind sector peers
- Failed breakout from pattern
- Price below 50-day MA with declining RS
- ServiceNow-like behavior: rejected at key MAs repeatedly

Use web search to find CURRENT price data, YTD performance, and recent news for each ticker.

IMPORTANT: Return ONLY valid raw JSON. No markdown. No backticks. No explanation text. Just the JSON object.

Required JSON format:
{
  "stocks": [
    {
      "ticker": "AMD",
      "signal": "BUY",
      "confidence": "HIGH",
      "momentum_score": 8,
      "rs_vs_index": "STRONG",
      "rs_vs_sector": "STRONG",
      "ma50_status": "ABOVE",
      "pattern": "BREAKOUT",
      "volume_confirmation": true,
      "entry_zone": "$120-$125",
      "key_support": "$115",
      "key_resistance": "$135",
      "stop_loss": "$113",
      "summary": "한국어로 2-3문장 분석 요약.",
      "caution": "한국어로 주의사항 또는 null"
    }
  ],
  "market_context": "한국어로 현재 반도체/시장 전반의 컨텍스트 2-3문장."
}

signal values: "BUY" | "SELL" | "HOLD"
confidence values: "HIGH" | "MEDIUM" | "LOW"
rs_vs_index values: "STRONG" | "NEUTRAL" | "WEAK"
rs_vs_sector values: "STRONG" | "NEUTRAL" | "WEAK"
ma50_status values: "ABOVE" | "BELOW" | "AT"
pattern values: "CUP" | "W_BASE" | "BREAKOUT" | "DOWNTREND" | "NONE"`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
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

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [
          {
            role: 'user',
            content: `Today is ${today}. Analyze the following stocks for momentum buy/sell signals using current market data: ${tickers.join(', ')}.

Search for each stock's: current price, YTD performance vs S&P 500, recent price action relative to 50-day MA, any recent earnings or news catalysts, and technical pattern formation.

Return ONLY the JSON object described in your instructions. No other text.`,
          },
        ],
      }),
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.text();
      console.error('Anthropic API error:', err);
      return NextResponse.json({ error: 'Anthropic API error', detail: err }, { status: 500 });
    }

    const data = await anthropicRes.json();
    const textBlock = data.content?.find((b: { type: string }) => b.type === 'text') as { text: string } | undefined;
    if (!textBlock) {
      return NextResponse.json({ error: 'No text response from AI' }, { status: 500 });
    }

    let raw = textBlock.text.trim();
    // Strip any accidental markdown fences
    raw = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) {
      return NextResponse.json({ error: 'Could not parse AI response as JSON', raw: raw.slice(0, 200) }, { status: 500 });
    }

    const parsed = JSON.parse(raw.substring(jsonStart, jsonEnd + 1));
    parsed.analyzed_at = new Date().toISOString();

    return NextResponse.json(parsed);
  } catch (err) {
    console.error('Route error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
