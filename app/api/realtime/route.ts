import { NextRequest, NextResponse } from 'next/server';
import { getUSStockPrice, getKRStockPrice, isKRStock, toKISCode } from '@/lib/kis';

export async function GET(req: NextRequest) {
  const tickersParam = req.nextUrl.searchParams.get('tickers');
  if (!tickersParam) return NextResponse.json({ error: 'tickers required' }, { status: 400 });

  const tickers = tickersParam.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);

  // Single ticker
  if (tickers.length === 1) {
    const t = tickers[0];
    const data = isKRStock(t)
      ? await getKRStockPrice(toKISCode(t))
      : await getUSStockPrice(t);
    if (!data) return NextResponse.json({ error: '데이터 없음' }, { status: 404 });
    return NextResponse.json(data);
  }

  // Multiple tickers
  const results = await Promise.all(
    tickers.map(async (t) => {
      const data = isKRStock(t)
        ? await getKRStockPrice(toKISCode(t))
        : await getUSStockPrice(t);
      return data ? { ticker: t, ...data } : null;
    })
  );

  const quotes = results.filter(Boolean);
  return NextResponse.json({ quotes, count: quotes.length });
}
