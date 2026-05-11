import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function today() { return new Date().toISOString().slice(0, 10); }

export async function GET(req: NextRequest) {
  const sb   = getClient();
  const type = req.nextUrl.searchParams.get('type');
  const date = req.nextUrl.searchParams.get('date') ?? today();

  if (!sb) return NextResponse.json({ error: 'Supabase not configured', url: !!process.env.NEXT_PUBLIC_SUPABASE_URL, key: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY }, { status: 500 });

  if (type === 'analysis') {
    const { data, error } = await sb.from('analysis_cache').select('*').eq('analysis_date', date).single();
    if (error || !data) return NextResponse.json({ empty: true, error: error?.message });
    return NextResponse.json(data);
  }
  if (type === 'watchlist') {
    const { data, error } = await sb.from('user_watchlist').select('tickers, favorites').eq('id', 1).single();
    if (error || !data) return NextResponse.json({ tickers: [], error: error?.message });
    return NextResponse.json({ tickers: data.tickers ?? [] });
  }
  if (type === 'portfolio') {
    const { data, error } = await sb.from('user_portfolio').select('*').eq('id', 1).single();
    if (error || !data) return NextResponse.json({ empty: true, error: error?.message });
    return NextResponse.json(data);
  }
  if (type === 'test') {
    const { data, error } = await sb.from('user_watchlist').select('*');
    return NextResponse.json({ data, error: error?.message, count: data?.length });
  }
  return NextResponse.json({ error: 'type required' }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const sb = getClient();
  if (!sb) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

  const body = await req.json();
  const { type } = body;

  if (type === 'analysis') {
    const { error } = await sb.from('analysis_cache').upsert({
      analysis_date: body.date ?? today(),
      stocks: body.stocks,
      market_context: body.market_context,
      analyzed_at: new Date().toISOString(),
    }, { onConflict: 'analysis_date' });
    return NextResponse.json({ ok: !error, error: error?.message });
  }
  if (type === 'watchlist') {
    const { error } = await sb.from('user_watchlist').upsert({
      id: 1, tickers: body.tickers,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    return NextResponse.json({ ok: !error, error: error?.message });
  }
  if (type === 'portfolio') {
    const { error } = await sb.from('user_portfolio').upsert({
      id: 1, holdings: body.holdings,
      results: body.results ?? null,
      analyzed_at: body.analyzed_at ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    return NextResponse.json({ ok: !error, error: error?.message });
  }
  return NextResponse.json({ error: 'type required' }, { status: 400 });
}
