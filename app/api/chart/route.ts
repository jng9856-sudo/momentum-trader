import { NextRequest, NextResponse } from 'next/server';

function calcEMA(arr: number[], n: number): number[] {
  const k = 2 / (n + 1);
  let prev = arr[0];
  return arr.map(v => { prev = v * k + prev * (1 - k); return Math.round(prev * 100) / 100; });
}

async function fetchCloses(ticker: string, range = '6mo') {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=${range}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 1800 } }
    );
    if (!res.ok) return null;
    const d = await res.json();
    const result = d?.chart?.result?.[0];
    if (!result) return null;

    const timestamps: number[] = result.timestamp ?? [];
    const closes: number[]     = (result.indicators?.quote?.[0]?.close ?? [])
      .filter((c: number) => c != null && !isNaN(c));

    if (closes.length < 10) return null;

    const ema10  = calcEMA(closes, 10);
    const ema20  = calcEMA(closes, 20);
    const last   = closes[closes.length - 1];
    const prev   = closes[closes.length - 2];
    const todayPct = Math.round(((last - prev) / prev) * 10000) / 100;

    // 추세 판단: EMA 정렬
    const e10 = ema10[ema10.length - 1];
    const e20 = ema20[ema20.length - 1];
    let trend: string;
    if      (last > e10 && e10 > e20)  trend = 'strong_up';
    else if (last > e20)                trend = 'decent_up';
    else if (last < e10 * 0.95)         trend = 'major_down';
    else                                trend = 'down';

    // 마지막 60일치만 반환
    const slice = Math.min(60, closes.length);
    return {
      ticker,
      closes:    closes.slice(-slice),
      ema10:     ema10.slice(-slice),
      ema20:     ema20.slice(-slice),
      last:      Math.round(last * 100) / 100,
      todayPct,
      trend,
      timestamps: timestamps.slice(-slice),
    };
  } catch { return null; }
}

export async function POST(req: NextRequest) {
  try {
    const { tickers, range } = await req.json();
    if (!Array.isArray(tickers) || tickers.length === 0) {
      return NextResponse.json({ error: 'tickers required' }, { status: 400 });
    }
    const results = await Promise.all(tickers.slice(0, 30).map(t => fetchCloses(t, range ?? '6mo')));
    return NextResponse.json({ charts: results.filter(Boolean) });
  } catch {
    return NextResponse.json({ error: 'server error' }, { status: 500 });
  }
}
