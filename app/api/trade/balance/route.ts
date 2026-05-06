// app/api/trade/balance/route.ts

import { NextResponse } from 'next/server';

const KIS_APP_KEY    = process.env.KIS_APP_KEY!;
const KIS_APP_SECRET = process.env.KIS_APP_SECRET!;
const ACCOUNT_NO     = process.env.KIS_ACCOUNT_NO!;
const ACCOUNT_PROD   = process.env.KIS_ACCOUNT_PROD ?? '01';
const IS_PAPER       = process.env.KIS_PAPER_TRADING !== 'false';
const BASE_URL       = 'https://openapi.koreainvestment.com:9443';
const API_BASE       = IS_PAPER ? 'https://openapivts.koreainvestment.com:29443' : BASE_URL;

async function getToken(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_URL}/oauth2/tokenP`, {
      method: 'POST',
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

export async function GET() {
  const token = await getToken();
  if (!token) {
    return NextResponse.json({ error: '토큰 발급 실패 — API키/시크릿 확인', isPaper: IS_PAPER }, { status: 500 });
  }

  const TR_ID = IS_PAPER ? 'VTTS3012R' : 'TTTS3012R';

  // NASD, NYSE, AMEX 3개 동시 조회
  const exchanges = ['NASD', 'NYSE', 'AMEX'] as const;
  const results = await Promise.all(exchanges.map(async (excd) => {
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
      return { excd, ok: data?.rt_cd === '0', data };
    } catch (e) {
      return { excd, ok: false, data: { error: String(e) } };
    }
  }));

  // 하나라도 성공했는지 확인
  const successResult = results.find(r => r.ok);
  if (!successResult) {
    return NextResponse.json({
      error:   `KIS API 오류: ${results[0].data?.msg1 ?? results[0].data?.error ?? '알 수 없는 오류'}`,
      rt_cd:   results[0].data?.rt_cd,
      msg1:    results[0].data?.msg1,
      isPaper: IS_PAPER,
      hint:    results[0].data?.rt_cd === '1' ? '계좌번호(CANO) 또는 상품코드(ACNT_PRDT_CD) 오류' : undefined,
    }, { status: 500 });
  }

  // 성공한 응답의 output1 필드명 확인 (디버그용)
  const sampleOutput1 = successResult.data?.output1?.[0] ?? null;
  const output2       = successResult.data?.output2?.[0] ?? {};

  // ── 필드명 자동 감지 파싱 ────────────────────────────────────────────────
  const allItems = results
    .filter(r => r.ok)
    .flatMap(r => {
      const list: Record<string, string>[] = r.data?.output1 ?? [];
      return list.map(o => {
        // 수량 필드: 실전은 ovrs_cblc_qty, 모의는 cblc_qty
        const qty = parseInt(
          o.ovrs_cblc_qty ?? o.cblc_qty ?? '0'
        );
        if (qty <= 0) return null;

        // 평균단가
        const avgPrice = parseFloat(o.pchs_avg_pric ?? '0');

        // 현재가: 여러 필드명 시도
        const curPrice = parseFloat(
          o.now_pric2 ?? o.ovrs_now_pric1 ?? o.bass_pric ?? '0'
        );

        const evalAmt = curPrice > 0 ? curPrice * qty : avgPrice * qty;
        const pnl     = evalAmt - avgPrice * qty;
        const pnlPct  = avgPrice > 0 ? ((curPrice - avgPrice) / avgPrice) * 100 : 0;

        return {
          ticker:   o.ovrs_pdno      ?? o.pdno ?? '',
          name:     o.ovrs_item_name ?? o.prdt_name ?? '',
          qty,
          avgPrice: Math.round(avgPrice * 100) / 100,
          curPrice: Math.round(curPrice * 100) / 100,
          evalAmt:  Math.round(evalAmt  * 100) / 100,
          pnl:      Math.round(pnl      * 100) / 100,
          pnlPct:   Math.round(pnlPct   * 10)  / 10,
          exchange: r.excd,
        };
      }).filter(Boolean);
    });

  // 현금 잔고: 여러 필드명 시도
  const cashUSD = parseFloat(
    output2.frcr_dncl_amt_2   ??
    output2.frcr_evlu_amt      ??
    output2.dncl_amt           ??
    output2.nxdy_frcr_dncl_amt ??
    '0'
  );

  const totalEval    = (allItems as NonNullable<typeof allItems[0]>[]).reduce((s, i) => s + i.evalAmt, 0);
  const totalBuy     = (allItems as NonNullable<typeof allItems[0]>[]).reduce((s, i) => s + i.avgPrice * i.qty, 0);
  const totalPnl     = totalEval - totalBuy;
  const totalPnlPct  = totalBuy > 0 ? (totalPnl / totalBuy) * 100 : 0;
  const totalAssetUSD = totalEval + cashUSD;

  return NextResponse.json({
    items:          allItems,
    totalEval:      Math.round(totalEval     * 100) / 100,
    totalBuy:       Math.round(totalBuy      * 100) / 100,
    totalPnl:       Math.round(totalPnl      * 100) / 100,
    totalPnlPct:    Math.round(totalPnlPct   * 10)  / 10,
    cashUSD:        Math.round(cashUSD       * 100) / 100,
    totalAssetUSD:  Math.round(totalAssetUSD * 100) / 100,
    isPaper:        IS_PAPER,
    // 디버그용 — 실제 필드명 확인
    _debug: {
      output1Sample: sampleOutput1,
      output2Sample: output2,
      output1Fields: sampleOutput1 ? Object.keys(sampleOutput1) : [],
      output2Fields: Object.keys(output2),
    },
  });
}
