// app/api/trade/route.ts — 주문 실행 API (안전장치 포함)

import { NextRequest, NextResponse } from 'next/server';
import { buyUSStock, sellUSStock, getUSBalance, IS_PAPER } from '@/lib/kis-trade';

// ── 안전 한도 (환경변수로 조정 가능) ─────────────────────────────────────────
const MAX_SINGLE_ORDER_USD = Number(process.env.MAX_ORDER_USD  ?? 2000);  // 1회 최대 주문금액
const MAX_DAILY_ORDERS     = Number(process.env.MAX_DAILY_ORDERS ?? 5);   // 일일 최대 주문 횟수
const AUTO_TRADE_ENABLED   = process.env.AUTO_TRADE_ENABLED === 'true';   // 자동매매 활성화 스위치

// ── 일별 주문 카운터 (서버 메모리, 재시작 시 초기화됨) ────────────────────────
const dailyOrderLog: { date: string; count: number; orders: unknown[] } = {
  date:   new Date().toISOString().slice(0, 10),
  count:  0,
  orders: [],
};

function resetIfNewDay() {
  const today = new Date().toISOString().slice(0, 10);
  if (dailyOrderLog.date !== today) {
    dailyOrderLog.date   = today;
    dailyOrderLog.count  = 0;
    dailyOrderLog.orders = [];
  }
}

// ── POST /api/trade ──────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, ticker, qty, price, source } = body;

    // ── 기본 검증 ─────────────────────────────────────────────────────────────
    if (!action || !ticker || !qty) {
      return NextResponse.json({ error: 'action, ticker, qty 필수' }, { status: 400 });
    }
    if (!['BUY', 'SELL'].includes(action)) {
      return NextResponse.json({ error: 'action은 BUY 또는 SELL' }, { status: 400 });
    }
    if (Number(qty) <= 0 || Number(qty) > 9999) {
      return NextResponse.json({ error: '수량이 유효하지 않습니다.' }, { status: 400 });
    }

    // ── 자동매매 활성화 체크 ──────────────────────────────────────────────────
    if (!AUTO_TRADE_ENABLED && source === 'AUTO') {
      return NextResponse.json({
        error: '자동매매가 비활성화 상태입니다. 환경변수 AUTO_TRADE_ENABLED=true 로 설정하세요.',
        isPaper: IS_PAPER,
      }, { status: 403 });
    }

    // ── 일별 한도 체크 ────────────────────────────────────────────────────────
    resetIfNewDay();
    if (dailyOrderLog.count >= MAX_DAILY_ORDERS) {
      return NextResponse.json({
        error: `일일 최대 주문 횟수(${MAX_DAILY_ORDERS}회) 초과`,
        todayOrders: dailyOrderLog.count,
      }, { status: 429 });
    }

    // ── 주문금액 한도 체크 (매수 시에만) ─────────────────────────────────────
    if (action === 'BUY') {
      const bal = await getUSBalance();
      if (!bal) {
        return NextResponse.json({ error: '잔고 조회 실패' }, { status: 500 });
      }

      // 현재가 × 수량이 한도 초과 여부
      const orderAmt = (price > 0 ? price : 0) * Number(qty);
      if (orderAmt > MAX_SINGLE_ORDER_USD && price > 0) {
        return NextResponse.json({
          error: `1회 주문 한도 초과: $${orderAmt.toFixed(0)} > $${MAX_SINGLE_ORDER_USD}`,
          maxOrderUSD: MAX_SINGLE_ORDER_USD,
        }, { status: 400 });
      }

      // 현금 부족 체크
      if (bal.cashUSD < orderAmt && orderAmt > 0) {
        return NextResponse.json({
          error: `현금 부족: 가용 $${bal.cashUSD} < 주문금액 $${orderAmt.toFixed(0)}`,
          cashUSD: bal.cashUSD,
        }, { status: 400 });
      }
    }

    // ── 주문 실행 ──────────────────────────────────────────────────────────────
    const result = action === 'BUY'
      ? await buyUSStock(ticker, Number(qty), Number(price ?? 0))
      : await sellUSStock(ticker, Number(qty), Number(price ?? 0));

    // ── 주문 로그 ──────────────────────────────────────────────────────────────
    if (result.success) {
      dailyOrderLog.count++;
      dailyOrderLog.orders.push({
        time:    new Date().toISOString(),
        action,
        ticker,
        qty:     Number(qty),
        price:   Number(price ?? 0),
        ordNo:   result.ordNo,
        source:  source ?? 'MANUAL',
        isPaper: IS_PAPER,
      });
    }

    return NextResponse.json({
      ...result,
      isPaper:       IS_PAPER,
      todayOrders:   dailyOrderLog.count,
      maxDailyOrders: MAX_DAILY_ORDERS,
    });

  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// ── GET /api/trade — 오늘 주문 현황 ──────────────────────────────────────────
export async function GET() {
  resetIfNewDay();
  return NextResponse.json({
    isPaper:        IS_PAPER,
    autoEnabled:    AUTO_TRADE_ENABLED,
    todayOrders:    dailyOrderLog.count,
    maxDailyOrders: MAX_DAILY_ORDERS,
    maxOrderUSD:    MAX_SINGLE_ORDER_USD,
    orders:         dailyOrderLog.orders,
  });
}
