// app/api/trade/balance/route.ts

import { NextResponse } from 'next/server';
import { getUSBalance, IS_PAPER } from '@/lib/kis-trade';

export async function GET() {
  try {
    const balance = await getUSBalance();
    if (!balance) {
      return NextResponse.json({ error: '잔고 조회 실패. 계좌번호/API키를 확인하세요.', isPaper: IS_PAPER }, { status: 500 });
    }
    return NextResponse.json(balance);
  } catch (e) {
    return NextResponse.json({ error: String(e), isPaper: IS_PAPER }, { status: 500 });
  }
}
