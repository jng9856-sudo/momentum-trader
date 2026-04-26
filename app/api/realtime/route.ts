import { NextRequest, NextResponse } from 'next/server';
import { getMultipleQuotes, getQuote } from '@/lib/finnhub';

// GET /api/realtime?tickers=AMD,NVDA,MRVL
// Returns real-time prices for multiple tickers
export async function GET(req: NextRequest) {
  const tickersParam = req.nextUrl.searchParams.get('tickers');
  if (!tickersParam) return NextResponse.json({ error: 'tickers required' }, { status: 400 });

  const tickers = tickersParam.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);

  if (tickers.length === 1) {
    const quote = await getQuote(tickers[0]);
    if (!quote) return NextResponse.json({ error: '데이터 없음' }, { status: 404 });
    return NextResponse.json({
      ticker: tickers[0],
      price: quote.c,
      change: quote.d,
      changePct: quote.dp,
      high: quote.h,
      low: quote.l,
      open: quote.o,
      prevClose: quote.pc,
      timestamp: new Date(quote.t * 1000).toISOString(),
      isRealtime: true,
    });
  }

  const quotes = await getMultipleQuotes(tickers);
  const result = Object.entries(quotes).map(([ticker, q]) => ({
    ticker,
    price: q.c,
    change: q.d,
    changePct: q.dp,
    high: q.h,
    low: q.l,
    open: q.o,
    prevClose: q.pc,
    timestamp: new Date(q.t * 1000).toISOString(),
    isRealtime: true,
  }));

  return NextResponse.json({ quotes: result, count: result.length });
}

