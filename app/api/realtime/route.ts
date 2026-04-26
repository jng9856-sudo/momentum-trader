import { NextRequest, NextResponse } from 'next/server';
import { getUSStockPrice, getKRStockPrice, getMultipleUSPrices, isKRStock, toKISCode } from '@/lib/kis';

// GET /api/realtime?tickers=AMD,NVDA,005930.KS
export async function GET(req: NextRequest) {
  const tickersParam = req.nextUrl.searchParams.get('tickers');
  if (!tickersParam) return NextResponse.json({ error: 'tickers required' }, { status: 400 });

  const tickers = tickersParam.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);

  // Single ticker
  if (tickers.length === 1) {
    const t = tickers[0];
    if (isKRStock(t)) {
      const data = await getKRStockPrice(toKISCode(t));
      if (!data) return NextResponse.json({ error: '데이터 없음' }, { status: 404 });
      return NextResponse.json(data);
    } else {
      const data = await getUSStockPrice(t);
      if (!data) return NextResponse.json({ error: '데이터 없음' }, { status: 404 });
      return NextResponse.json(data);
    }
  }

  // Multiple tickers — split KR and US
  const usTickers = tickers.filter(t => !isKRStock(t));
  const krTickers = tickers.filter(t => isKRStock(t));

  const [usQuotes, krResults] = await Promise.all([
    usTickers.length > 0 ? getMultipleUSPrices(usTickers) : Promise.resolve({}),
    Promise.all(krTickers.map(async t => ({ ticker: t, data: await getKRStockPrice(toKISCode(t)) }))),
  ]);

  const quotes = [
    ...Object.entries(usQuotes).map(([ticker, q]) => ({ ticker, ...q })),
    ...krResults.filter(r => r.data).map(r => ({ ticker: r.ticker, ...r.data! })),
  ];

  return NextResponse.json({ quotes, count: quotes.length });
}
