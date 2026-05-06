// app/api/trade/balance/route.ts
// kis-trade.ts import 없이 완전 독립 실행

import { NextResponse } from 'next/server';

const KIS_APP_KEY    = process.env.KIS_APP_KEY    ?? '';
const KIS_APP_SECRET = process.env.KIS_APP_SECRET ?? '';
const ACCOUNT_NO     = process.env.KIS_ACCOUNT_NO ?? '';
const ACCOUNT_PROD   = process.env.KIS_ACCOUNT_PROD ?? '01';
const IS_PAPER       = process.env.KIS_PAPER_TRADING !== 'false';

const BASE_URL = 'https://openapi.koreainvestment.com:9443';
const API_BASE = IS_PAPER ? 'https://openapivts.koreainvestment.com:29443' : BASE_URL;
const TR_ID    = IS_PAPER ? 'VTTS3012R' : 'TTTS3012R';

// ── 토큰 발급 ─────────────────────────────────────────────────────────────────
async function getToken(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_URL}/oauth2/tokenP`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        appkey:     KIS_APP_KEY,
        appsecret:  KIS_APP_SECRET,
      }),
    });
    const data = await res.json();
    return data.access_token ?? null;
  } catch { return null; }
}

// ── 단일 거래소 잔고 조회 ─────────────────────────────────────────────────────
async function fetchExchange(token: string, excd: string) {
  const params = new URLSearchParams({
    CANO: ACCOUNT_NO, ACNT_PRDT_CD: ACCOUNT_PROD,
    OVRS_EXCG_CD: excd, TR_CRCY_CD: 'USD',
    CTX_AREA_FK200: '', CTX_AREA_NK200: '',
  });
  try {
    const res = await fetch(
      `${API_BASE}/uapi/overseas-stock/v1/trading/inquire-balance?${params}`,
      {
        headers: {
          'content-type':  'application/json; charset=utf-8',
          'authorization': `Bearer ${token}`,
          'appkey':        KIS_APP_KEY,
          'appsecret':     KIS_APP_SECRET,
          'tr_id':         TR_ID,
          'custtype':      'P',
        },
        next: { revalidate: 0 },
      }
    );
    const data = await res.json();
    if (data?.rt_cd !== '0') return null;
    return data;
  } catch { return null; }
}

export async function GET() {
  // 환경변수 체크
  if (!KIS_APP_KEY || !KIS_APP_SECRET || !ACCOUNT_NO) {
    return NextResponse.json({
      error:   '필수 환경변수 누락 (KIS_APP_KEY / KIS_APP_SECRET / KIS_ACCOUNT_NO)',
      isPaper: IS_PAPER,
    }, { status: 500 });
  }

  // 토큰
  const token = await getToken();
  if (!token) {
    return NextResponse.json({
      error:   '토큰 발급 실패 — API키/시크릿 확인',
      isPaper: IS_PAPER,
    }, { status: 500 });
  }

  // 3개 거래소 동시 조회
  const [nasd, nyse, amex] = await Promise.all([
    fetchExchange(token, 'NASD'),
    fetchExchange(token, 'NYSE'),
    fetchExchange(token, 'AMEX'),
  ]);

  if (!nasd && !nyse && !amex) {
    return NextResponse.json({
      error:   'KIS 잔고 API 오류 — 계좌번호/상품코드 확인',
      isPaper: IS_PAPER,
    }, { status: 500 });
  }

  // 보유 종목 합산
  const allItems = [nasd, nyse, amex]
    .filter(Boolean)
    .flatMap((d, idx) => {
      const excds = ['NASD', 'NYSE', 'AMEX'];
      const excd  = excds[idx];
      const list: Record<string, string>[] = d?.output1 ?? [];
      return list.map(o => {
        // 수량: 실전=ovrs_cblc_qty, 모의=cblc_qty
        const qty = parseInt(o.ovrs_cblc_qty ?? o.cblc_qty ?? '0');
        if (qty <= 0) return null;
        const avgPrice = parseFloat(o.pchs_avg_pric ?? '0');
        // 현재가: 여러 필드 시도
        const curPrice = parseFloat(
          o.now_pric2 ?? o.ovrs_now_pric1 ?? o.bass_pric ?? o.pchs_avg_pric ?? '0'
        );
        const evalAmt = (curPrice > 0 ? curPrice : avgPrice) * qty;
        const buyAmt  = avgPrice * qty;
        const pnl     = evalAmt - buyAmt;
        const pnlPct  = buyAmt > 0 ? (pnl / buyAmt) * 100 : 0;
        return {
          ticker:   o.ovrs_pdno      ?? '',
          name:     o.ovrs_item_name ?? '',
          qty,
          avgPrice: Math.round(avgPrice * 100) / 100,
          curPrice: Math.round(curPrice * 100) / 100,
          evalAmt:  Math.round(evalAmt  * 100) / 100,
          pnl:      Math.round(pnl      * 100) / 100,
          pnlPct:   Math.round(pnlPct   * 10)  / 10,
          exchange: excd,
        };
      }).filter(Boolean);
    });

  // 현금: NASD output2 기준
  const out2 = (nasd ?? nyse ?? amex)?.output2?.[0] ?? {};
  const cashUSD = parseFloat(
    out2.frcr_dncl_amt_2   ??
    out2.frcr_evlu_amt      ??
    out2.dncl_amt           ??
    out2.nxdy_frcr_dncl_amt ??
    '0'
  );

  const totalEval     = allItems.reduce((s, i) => s + (i?.evalAmt ?? 0), 0);
  const totalBuy      = allItems.reduce((s, i) => s + ((i?.avgPrice ?? 0) * (i?.qty ?? 0)), 0);
  const totalPnl      = totalEval - totalBuy;
  const totalPnlPct   = totalBuy > 0 ? (totalPnl / totalBuy) * 100 : 0;
  const totalAssetUSD = totalEval + cashUSD;

  return NextResponse.json({
    items:         allItems,
    totalEval:     Math.round(totalEval     * 100) / 100,
    totalBuy:      Math.round(totalBuy      * 100) / 100,
    totalPnl:      Math.round(totalPnl      * 100) / 100,
    totalPnlPct:   Math.round(totalPnlPct   * 10)  / 10,
    cashUSD:       Math.round(cashUSD       * 100) / 100,
    totalAssetUSD: Math.round(totalAssetUSD * 100) / 100,
    isPaper:       IS_PAPER,
  });
}
