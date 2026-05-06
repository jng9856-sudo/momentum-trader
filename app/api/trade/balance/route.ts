// app/api/trade/balance/route.ts

import { NextResponse } from 'next/server';

const KIS_APP_KEY    = process.env.KIS_APP_KEY!;
const KIS_APP_SECRET = process.env.KIS_APP_SECRET!;
const ACCOUNT_NO     = process.env.KIS_ACCOUNT_NO!;
const ACCOUNT_PROD   = process.env.KIS_ACCOUNT_PROD ?? '01';
const IS_PAPER       = process.env.KIS_PAPER_TRADING !== 'false';

const BASE_URL  = 'https://openapi.koreainvestment.com:9443';
const API_BASE  = IS_PAPER ? 'https://openapivts.koreainvestment.com:29443' : BASE_URL;

async function getToken(): Promise<{ token: string | null; error: string | null }> {
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
    if (!res.ok || !data.access_token) {
      return { token: null, error: `토큰 발급 실패: ${data.msg1 ?? data.error_description ?? res.status}` };
    }
    return { token: data.access_token, error: null };
  } catch (e) {
    return { token: null, error: `토큰 요청 오류: ${String(e)}` };
  }
}

export async function GET() {
  // ── 환경변수 체크 ────────────────────────────────────────────────────────
  const envCheck = {
    KIS_APP_KEY:    KIS_APP_KEY    ? `✓ (${KIS_APP_KEY.slice(0, 4)}***)` : '✕ 없음',
    KIS_APP_SECRET: KIS_APP_SECRET ? '✓ (설정됨)' : '✕ 없음',
    KIS_ACCOUNT_NO: ACCOUNT_NO     ? `✓ ${ACCOUNT_NO}` : '✕ 없음',
    KIS_ACCOUNT_PROD: `✓ ${ACCOUNT_PROD}`,
    KIS_PAPER_TRADING: IS_PAPER ? '모의투자' : '실전투자',
    API_BASE,
  };

  if (!KIS_APP_KEY || !KIS_APP_SECRET || !ACCOUNT_NO) {
    return NextResponse.json({
      error: '필수 환경변수 누락',
      envCheck,
      isPaper: IS_PAPER,
    }, { status: 500 });
  }

  // ── 토큰 발급 ─────────────────────────────────────────────────────────────
  const { token, error: tokenError } = await getToken();
  if (!token) {
    return NextResponse.json({
      error: tokenError ?? '토큰 발급 실패',
      envCheck,
      isPaper: IS_PAPER,
      hint: 'API키/시크릿이 실전용인지 확인하세요. 모의투자용 키로는 실전 API 호출 불가.',
    }, { status: 500 });
  }

  // ── NASD 잔고 조회 ────────────────────────────────────────────────────────
  const TR_ID = IS_PAPER ? 'VTTS3012R' : 'TTTS3012R';
  const params = new URLSearchParams({
    CANO:           ACCOUNT_NO,
    ACNT_PRDT_CD:   ACCOUNT_PROD,
    OVRS_EXCG_CD:   'NASD',
    TR_CRCY_CD:     'USD',
    CTX_AREA_FK200: '',
    CTX_AREA_NK200: '',
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

    // API 오류 응답
    if (data?.rt_cd !== '0') {
      return NextResponse.json({
        error:   `KIS API 오류: ${data?.msg1 ?? '알 수 없는 오류'} (rt_cd: ${data?.rt_cd})`,
        envCheck,
        isPaper: IS_PAPER,
        rawResponse: data,
        hint: data?.rt_cd === '1' ? '계좌번호 또는 상품코드를 확인하세요.' : undefined,
      }, { status: 500 });
    }

    // 성공: 전체 거래소 조회 및 합산
    const { getUSBalance, IS_PAPER: isp } = await import('@/lib/kis-trade');
    const balance = await getUSBalance();

    if (!balance) {
      return NextResponse.json({
        error: '잔고 파싱 실패',
        envCheck,
        isPaper: IS_PAPER,
        nasdRaw: data?.output2?.[0],
      }, { status: 500 });
    }

    return NextResponse.json({ ...balance, isPaper: isp, envCheck });

  } catch (e) {
    return NextResponse.json({
      error:   `네트워크 오류: ${String(e)}`,
      envCheck,
      isPaper: IS_PAPER,
    }, { status: 500 });
  }
}
