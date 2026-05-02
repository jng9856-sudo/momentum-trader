import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
             ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !key) {
      return NextResponse.json({ error: 'Supabase 환경변수 없음' }, { status: 500 });
    }

    const sb = createClient(url, key);

    const { data, error } = await sb
      .from('user_portfolio')
      .select('*')
      .eq('id', 1)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: '포트폴리오 없음', detail: error?.message }, { status: 404 });
    }

    const results = data.results as Array<{
      ticker: string;
      action: string;
      pnlPct: number;
      pnlAbs: number;
      avgPrice: number;
      shares: number;
      currentPrice: number;
      sellSignals: Array<{ text: string; severity: string }>;
    }> | null;

    if (!results || results.length === 0) {
      return NextResponse.json({ error: '분석 데이터 없음 — 포트폴리오 재분석 필요' }, { status: 404 });
    }

    const totalCost     = results.reduce((a, r) => a + (r.avgPrice * (r.shares ?? 0)), 0);
    const totalCurrent  = results.reduce((a, r) => a + (r.currentPrice * (r.shares ?? 0)), 0);
    const totalPnl      = totalCurrent - totalCost;
    const totalPnlPct   = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

    const sellAlerts = results
      .filter(r => r.action === '즉시매도' || r.action === '매도')
      .map(r => ({ ticker: r.ticker, action: r.action, pnlPct: r.pnlPct }));

    const holdings = results.map(r => ({
      ticker:  r.ticker,
      action:  r.action,
      pnlPct:  r.pnlPct,
      pnlAbs:  r.pnlAbs,
      shares:  r.shares,
    }));

    return NextResponse.json({
      summary: {
        totalPnl:     Math.round(totalPnl),
        totalPnlPct:  Math.round(totalPnlPct * 100) / 100,
        totalCost:    Math.round(totalCost),
        totalCurrent: Math.round(totalCurrent),
        count:        results.length,
      },
      sellAlerts,
      holdings,
      analyzedAt: data.analyzed_at ?? null,
    });

  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
