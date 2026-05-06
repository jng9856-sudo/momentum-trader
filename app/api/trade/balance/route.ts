// app/api/trade/balance/route.ts

import { NextResponse } from 'next/server';

const KIS_APP_KEY    = process.env.KIS_APP_KEY    ?? '';
const KIS_APP_SECRET = process.env.KIS_APP_SECRET ?? '';
const ACCOUNT_NO     = process.env.KIS_ACCOUNT_NO ?? '';
const ACCOUNT_PROD   = process.env.KIS_ACCOUNT_PROD ?? '01';
const IS_PAPER       = process.env.KIS_PAPER_TRADING !== 'false';

const BASE_URL = 'https://openapi.koreainvestment.com:9443';
const API_BASE = IS_PAPER ? 'https://openapivts.koreainvestment.com:29443' : BASE_URL;

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

function kisHeaders(token: string, trId: string): Record<string, string> {
  return {
    'content-type':  'application/json; charset=utf-8',
    'authorization': `Bearer ${token}`,
    'appkey':        KIS_APP_KEY,
    'appsecret':     KIS_APP_SECRET,
    'tr_id':         trId,
    'custtype':      'P',
  };
}

export async function GET() {
  if (!KIS_APP_KEY || !KIS_APP_SECRET || !ACCOUNT_NO) {
    return NextResponse.json({
      error: '필수 환경변수 누락',
      isPaper: IS_PAPER,
    }, { status: 500 });
  }

  const token = await getToken();
  if (!token) {
    return NextResponse.json({
      error: '토큰 발급 실패 — API키/시크릿 확인',
      isPaper: IS_PAPER,
    }, { status: 500 });
  }

  // ── 1. 보유 종목 조회 (TTTS3012R) ────────────────────────────────────────
  const holdingParams = new URLSearchParams({
    CANO: ACCOUNT_NO, ACNT_PRDT_CD: ACCOUNT_PROD,
    OVRS_EXCG_CD: 'NASD', TR_CRCY_CD: 'USD',
    CTX_AREA_FK200: '', CTX_AREA_NK200: '',
  });

  const holdingRes = await fetch(
    `${API_BASE}/uapi/overseas-stock/v1/trading/inquire-balance?${holdingParams}`,
    { headers: kisHeaders(token, IS_PAPER ? 'VTTS3012R' : 'TTTS3012R'), next: { revalidate: 0 } }
  ).then(r => r.json()).catch(() => null);

  // ── 2. 외화예수금 조회 (TTTS3007R) ───────────────────────────────────────
  const cashParams = new URLSearchParams({
    CANO: ACCOUNT_NO, ACNT_PRDT_CD: ACCOUNT_PROD,
    WCRC_FRCR_DVSN_CD: '02',  // 02=USD
    NATN_CD: '840',            // 840=미국
    TR_MKET_CD: '00',
    INQR_DVSN_CD: '00',
  });

  const cashRes = await fetch(
    `${API_BASE}/uapi/overseas-stock/v1/trading/inquire-present-balance?${cashParams}`,
    { headers: kisHeaders(token, IS_PAPER ? 'VTTS3007R' : 'TTTS3007R'), next: { revalidate: 0 } }
  ).then(r => r.json()).catch(() => null);

  // ── 보유 종목 파싱 ────────────────────────────────────────────────────────
  const items = (holdingRes?.rt_cd === '0' ? holdingRes?.output1 ?? [] : [])
    .map((o: Record<string, string>) => {
      const qty      = parseInt(o.ovrs_cblc_qty ?? o.cblc_qty ?? '0');
      if (qty <= 0) return null;
      const avgPrice = parseFloat(o.pchs_avg_pric ?? '0');
      const curPrice = parseFloat(o.now_pric2 ?? o.ovrs_now_pric1 ?? o.bass_pric ?? '0');
      const evalAmt  = (curPrice > 0 ? curPrice : avgPrice) * qty;
      const pnl      = evalAmt - avgPrice * qty;
      const pnlPct   = avgPrice > 0 ? (pnl / (avgPrice * qty)) * 100 : 0;
      return {
        ticker:   o.ovrs_pdno      ?? '',
        name:     o.ovrs_item_name ?? '',
        qty,
        avgPrice: Math.round(avgPrice * 100) / 100,
        curPrice: Math.round(curPrice * 100) / 100,
        evalAmt:  Math.round(evalAmt  * 100) / 100,
        pnl:      Math.round(pnl      * 100) / 100,
        pnlPct:   Math.round(pnlPct   * 10)  / 10,
        exchange: 'NASD',
      };
    })
    .filter(Boolean);

  // ── 외화예수금 파싱 ───────────────────────────────────────────────────────
  // TTTS3007R output1: 통화별 예수금 리스트
  let cashUSD = 0;
  if (cashRes?.rt_cd === '0') {
    const cashList: Record<string, string>[] = cashRes?.output1 ?? [];
    // USD(통화코드 840 또는 'USD') 찾기
    const usdRow = cashList.find(r =>
      r.crcy_cd === 'USD' || r.natn_cd === '840' || r.wcrc_frcr_dvsn_cd === '02'
    );
    if (usdRow) {
      cashUSD = parseFloat(
        usdRow.frcr_dncl_amt   ??  // 외화예수금
        usdRow.prvs_rcdv_amt   ??  // 전일수령금액
        usdRow.thdt_buy_amt    ??  // 당일매수금액
        usdRow.frcr_evlu_amt2  ??
        '0'
      );
    }
    // output1이 비어있으면 output2에서 시도
    if (cashUSD === 0) {
      const out2 = cashRes?.output2 ?? {};
      cashUSD = parseFloat(
        out2.frcr_dncl_amt_2 ??
        out2.tot_dncl_amt    ??
        '0'
      );
    }
  }

  // holding output2에서도 한번 더 시도 (fallback)
  if (cashUSD === 0 && holdingRes?.rt_cd === '0') {
    const out2 = holdingRes?.output2?.[0] ?? {};
    cashUSD = parseFloat(
      out2.frcr_dncl_amt_2   ??
      out2.frcr_evlu_amt     ??
      out2.dncl_amt          ??
      '0'
    );
  }

  const totalEval     = items.reduce((s: number, i: {evalAmt: number} | null) => s + (i?.evalAmt ?? 0), 0);
  const totalBuy      = items.reduce((s: number, i: {avgPrice: number, qty: number} | null) => s + ((i?.avgPrice ?? 0) * (i?.qty ?? 0)), 0);
  const totalPnl      = totalEval - totalBuy;
  const totalPnlPct   = totalBuy > 0 ? (totalPnl / totalBuy) * 100 : 0;
  const totalAssetUSD = totalEval + cashUSD;

  return NextResponse.json({
    items,
    totalEval:     Math.round(totalEval     * 100) / 100,
    totalBuy:      Math.round(totalBuy      * 100) / 100,
    totalPnl:      Math.round(totalPnl      * 100) / 100,
    totalPnlPct:   Math.round(totalPnlPct   * 10)  / 10,
    cashUSD:       Math.round(cashUSD       * 100) / 100,
    totalAssetUSD: Math.round(totalAssetUSD * 100) / 100,
    isPaper:       IS_PAPER,
    // 디버그: 실제 응답 필드 확인용
    _cashDebug: {
      cashApiRtCd:  cashRes?.rt_cd,
      cashApiMsg:   cashRes?.msg1,
      output1:      cashRes?.output1?.slice(0, 2),
      output2:      cashRes?.output2,
    },
  });
}
