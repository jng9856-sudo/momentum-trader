import { NextRequest, NextResponse } from 'next/server';

async function getYahooPriceForTicker(ticker: string): Promise<{ price: number; changePct: number } | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 0 } }
    );
    if (!res.ok) return null;
    const data   = await res.json();
    const closes: number[] = (data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [])
      .filter((c: number) => c != null && !isNaN(c));
    if (closes.length < 2) return null;
    const price    = closes[closes.length - 1];
    const prev     = closes[closes.length - 2];
    const changePct = ((price - prev) / prev) * 100;
    return { price: Math.round(price * 100) / 100, changePct: Math.round(changePct * 100) / 100 };
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const tickersParam = req.nextUrl.searchParams.get('tickers');
  if (!tickersParam) return NextResponse.json({ error: 'tickers required' }, { status: 400 });

  const tickers = tickersParam.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
  const hasKIS  = !!process.env.KIS_APP_KEY;

  if (hasKIS) {
    // KIS 실시간 사용
    try {
      const { getUSStockPrice, getKRStockPrice, isKRStock, toKISCode } = await import('@/lib/kis');

      if (tickers.length === 1) {
        const t    = tickers[0];
        const data = isKRStock(t) ? await getKRStockPrice(toKISCode(t)) : await getUSStockPrice(t);
        if (data && (data as { price?: number }).price) return NextResponse.json(data);
      } else {
        const results = await Promise.all(
          tickers.map(async t => {
            const d = isKRStock(t) ? await getKRStockPrice(toKISCode(t)) : await getUSStockPrice(t);
            return d ? { ticker: t, ...d } : null;
          })
        );
        const quotes = results.filter(Boolean);
        if (quotes.length > 0) return NextResponse.json({ quotes, count: quotes.length });
      }
    } catch { /* fallthrough to Yahoo */ }
  }

  // Yahoo Finance 폴백 (15분 지연이지만 항상 작동)
  if (tickers.length === 1) {
    const data = await getYahooPriceForTicker(tickers[0]);
    if (!data) return NextResponse.json({ error: '데이터 없음' }, { status: 404 });
    return NextResponse.json({ ticker: tickers[0], ...data, isRealtime: hasKIS });
  }

  const results = await Promise.all(
    tickers.map(async t => {
      const d = await getYahooPriceForTicker(t);
      return d ? { ticker: t, ...d, isRealtime: false } : null;
    })
  );
  const quotes = results.filter(Boolean);
  return NextResponse.json({ quotes, count: quotes.length });
}
