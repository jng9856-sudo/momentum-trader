import { NextResponse } from 'next/server';
import { getPortfolio } from '@/lib/supabase';

export async function GET() {
  try {
    const portfolio = await getPortfolio();
    if (!portfolio || !portfolio.results || portfolio.results.length === 0) {
      return NextResponse.json({ error: '분석 데이터 없음' }, { status: 404 });
    }

    const results = portfolio.results as Array<{
      ticker: string;
      action: string;
      pnlPct: number;
      pnlAbs: number;
      avgPrice: number;
      shares: number;
      currentPrice: number;
      sellSignals: Array<{ text: string; severity: string }>;
    }>;

    // 총 손익 계산
    const totalCost    = results.reduce((a, r) => a + (r.avgPrice * (r.shares ?? 0)), 0);
    const totalCurrent = results.reduce((a, r) => a + (r.currentPrice * (r.shares ?? 0)), 0);
    const totalPnl     = totalCurrent - totalCost;
    const totalPnlPct  = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

    // 매도 신호 종목
    const sellAlerts = results
      .filter(r => r.action === '즉시매도' || r.action === '매도')
      .map(r => ({ ticker: r.ticker, action: r.action, pnlPct: r.pnlPct }));

    // 종목별 요약
    const holdings = results.map(r => ({
      ticker:   r.ticker,
      action:   r.action,
      pnlPct:   r.pnlPct,
      pnlAbs:   r.pnlAbs,
      shares:   r.shares,
    }));

    return NextResponse.json({
      summary: {
        totalPnl:    Math.round(totalPnl),
        totalPnlPct: Math.round(totalPnlPct * 100) / 100,
        totalCost:   Math.round(totalCost),
        totalCurrent: Math.round(totalCurrent),
        count:       results.length,
      },
      sellAlerts,
      holdings,
      analyzedAt: portfolio.analyzed_at ?? null,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
