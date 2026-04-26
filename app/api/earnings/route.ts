import { NextRequest, NextResponse } from 'next/server';

async function fetchEarningsDate(ticker: string): Promise<{
  ticker: string;
  earningsDate: string | null;
  daysUntil: number | null;
  epsEstimate: number | null;
  revenueEstimate: string | null;
  lastEPS: number | null;
} > {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=calendarEvents,earningsTrend`,
      { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }, next: { revalidate: 0 } }
    );
    if (!res.ok) return { ticker, earningsDate: null, daysUntil: null, epsEstimate: null, revenueEstimate: null, lastEPS: null };

    const data = await res.json();
    const cal  = data?.quoteSummary?.result?.[0]?.calendarEvents;
    const trend = data?.quoteSummary?.result?.[0]?.earningsTrend?.trend;

    // Earnings date
    const dates: number[] = cal?.earnings?.earningsDate ?? [];
    const future = dates.filter((d: number) => d * 1000 > Date.now());
    const nextTs = future.length > 0 ? Math.min(...future) : null;

    let earningsDate: string | null = null;
    let daysUntil: number | null = null;

    if (nextTs) {
      const d = new Date(nextTs * 1000);
      earningsDate = d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
      daysUntil = Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    }

    // EPS estimate (next quarter)
    const nextQ = trend?.find((t: { period: string }) => t.period === '0q');
    const epsEstimate    = nextQ?.earningsEstimate?.avg?.raw ?? null;
    const revenueEstimate = nextQ?.revenueEstimate?.avg?.raw
      ? `$${(nextQ.revenueEstimate.avg.raw / 1e9).toFixed(1)}B`
      : null;

    // Last actual EPS
    const lastQ  = trend?.find((t: { period: string }) => t.period === '-1q');
    const lastEPS = lastQ?.actualEarnings?.raw ?? null;

    return { ticker, earningsDate, daysUntil, epsEstimate, revenueEstimate, lastEPS };
  } catch {
    return { ticker, earningsDate: null, daysUntil: null, epsEstimate: null, revenueEstimate: null, lastEPS: null };
  }
}

export async function POST(req: NextRequest) {
  let tickers: string[];
  try {
    const body = await req.json(); tickers = body.tickers;
    if (!Array.isArray(tickers) || tickers.length === 0) throw new Error('invalid');
  } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }

  const results = await Promise.all(tickers.map(fetchEarningsDate));
  return NextResponse.json({ earnings: results });
}
