import { NextRequest, NextResponse } from 'next/server';
import {
  getAnalysisCache, saveAnalysisCache,
  getWatchlist, saveWatchlist,
  getPortfolio, savePortfolio,
} from '@/lib/supabase';

function today() { return new Date().toISOString().slice(0, 10); }

// GET /api/db?type=analysis|watchlist|portfolio
export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get('type');
  const date = req.nextUrl.searchParams.get('date') ?? today();

  if (type === 'analysis') {
    const data = await getAnalysisCache(date);
    return NextResponse.json(data ?? { empty: true });
  }
  if (type === 'watchlist') {
    const tickers = await getWatchlist();
    return NextResponse.json({ tickers });
  }
  if (type === 'portfolio') {
    const data = await getPortfolio();
    return NextResponse.json(data ?? { empty: true });
  }
  return NextResponse.json({ error: 'type required' }, { status: 400 });
}

// POST /api/db
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { type } = body;

  if (type === 'analysis') {
    const ok = await saveAnalysisCache({
      analysis_date: body.date ?? today(),
      stocks: body.stocks,
      market_context: body.market_context,
    });
    return NextResponse.json({ ok });
  }
  if (type === 'watchlist') {
    const ok = await saveWatchlist(body.tickers);
    return NextResponse.json({ ok });
  }
  if (type === 'portfolio') {
    const ok = await savePortfolio({
      holdings: body.holdings,
      results: body.results ?? null,
      analyzed_at: body.analyzed_at ?? null,
    });
    return NextResponse.json({ ok });
  }
  return NextResponse.json({ error: 'type required' }, { status: 400 });
}

