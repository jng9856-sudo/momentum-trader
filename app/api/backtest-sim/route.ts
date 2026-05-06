import { NextRequest, NextResponse } from 'next/server';
import { runBacktest } from '@/lib/backtest';

export const maxDuration = 60; // Vercel 최대 실행 시간 60초

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      tickers,
      startDate,
      endDate,
      initialCapital = 10000,
      positionSizePct = 0.2,
      maxPositions    = 5,
      atrStopMult     = 2.0,
    } = body;

    if (!Array.isArray(tickers) || tickers.length === 0) {
      return NextResponse.json({ error: '종목을 입력해주세요.' }, { status: 400 });
    }
    if (!startDate || !endDate) {
      return NextResponse.json({ error: '날짜 범위를 입력해주세요.' }, { status: 400 });
    }
    if (tickers.length > 20) {
      return NextResponse.json({ error: '종목은 최대 20개까지 가능합니다.' }, { status: 400 });
    }

    const result = await runBacktest(
      tickers.map((t: string) => t.trim().toUpperCase()),
      startDate,
      endDate,
      Number(initialCapital),
      {
        positionSizePct: Number(positionSizePct),
        maxPositions:    Number(maxPositions),
        atrStopMult:     Number(atrStopMult),
        trailActivatePct: 0.10,
      }
    );

    return NextResponse.json(result);
  } catch (e) {
    console.error('Backtest error:', e);
    return NextResponse.json({ error: '백테스트 실행 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
