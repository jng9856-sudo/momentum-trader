// lib/kis-trade.ts — 한국투자증권 주문 API

const KIS_APP_KEY    = process.env.KIS_APP_KEY!;
const KIS_APP_SECRET = process.env.KIS_APP_SECRET!;
const BASE_URL       = 'https://openapi.koreainvestment.com:9443';

const ACCOUNT_NO   = process.env.KIS_ACCOUNT_NO!;
const ACCOUNT_PROD = process.env.KIS_ACCOUNT_PROD ?? '01';

// ── 모의투자 여부 ─────────────────────────────────────────────────────────────
export const IS_PAPER = process.env.KIS_PAPER_TRADING !== 'false';
const API_BASE = IS_PAPER
  ? 'https://openapivts.koreainvestment.com:29443'
  : BASE_URL;

// ── 거래소 코드 매핑 ──────────────────────────────────────────────────────────
const NYSE_TICKERS = new Set([
  'TSM','V','MA','JPM','WMT','JNJ','PG','CVX','XOM','BAC',
  'DIS','KO','PFE','MRK','ABT','IBM','GS','MS','CAT','HON',
  'MMM','GE','F','GM','BA','UNH','HD','MCD','NKE','T',
]);
const AMEX_TICKERS = new Set(['SPY','QQQ','IWM','DIA','GLD','SLV','USO','TLT','HYG']);

export function getExchangeCode(ticker: string): 'NASD' | 'NYSE' | 'AMEX' {
  if (NYSE_TICKERS.has(ticker)) return 'NYSE';
  if (AMEX_TICKERS.has(ticker)) return 'AMEX';
  return 'NASD';
}

// ── TR_ID (실전 / 모의) ───────────────────────────────────────────────────────
const TR = {
  US_BUY:     IS_PAPER ? 'VTTT1002U' : 'TTTT1002U',
  US_SELL:    IS_PAPER ? 'VTTT1006U' : 'TTTT1006U',
  US_BALANCE: IS_PAPER ? 'VTTS3012R' : 'TTTS3012R',
};

// ── Access Token ──────────────────────────────────────────────────────────────
let _token: { value: string; exp: number } | null = null;

async function getToken(): Promise<string | null> {
  if (_token && Date.now() < _token.exp) return _token.value;
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
    if (!res.ok) return null;
    const data = await res.json();
    _token = { value: data.access_token, exp: Date.now() + 23 * 3600 * 1000 };
    return _token.value;
  } catch { return null; }
}

async function makeHeaders(trId: string): Promise<Record<string, string> | null> {
  const token = await getToken();
  if (!token) return null;
  return {
    'content-type':  'application/json; charset=utf-8',
    'authorization': `Bearer ${token}`,
    'appkey':        KIS_APP_KEY,
    'appsecret':     KIS_APP_SECRET,
    'tr_id':         trId,
    'custtype':      'P',
  };
}

// ── 인터페이스 ────────────────────────────────────────────────────────────────
export interface OrderResult {
  success:  boolean;
  ordNo:    string | null;
  ticker:   string;
  side:     'BUY' | 'SELL';
  qty:      number;
  price:    number;
  exchange: string;
  isPaper:  boolean;
  error?:   string;
}

export interface BalanceItem {
  ticker:    string;
  name:      string;
  qty:       number;
  avgPrice:  number;
  curPrice:  number;
  evalAmt:   number;
  pnl:       number;
  pnlPct:    number;
  exchange:  string;
}

export interface BalanceResult {
  items:        BalanceItem[];
  totalEval:    number;   // 총 평가금액 (USD)
  totalBuy:     number;   // 총 매입금액 (USD)
  totalPnl:     number;   // 총 손익 (USD)
  totalPnlPct:  number;   // 총 수익률 (%)
  cashUSD:      number;   // 가용 USD 현금
  totalAssetUSD: number;  // 총 자산 (현금 + 평가)
  isPaper:      boolean;
}

// ── 단일 거래소 잔고 조회 ─────────────────────────────────────────────────────
async function fetchBalanceByExchange(
  exchCd: 'NASD' | 'NYSE' | 'AMEX'
): Promise<{ items: BalanceItem[]; cashUSD: number; totalEval: number; totalBuy: number } | null> {
  const headers = await makeHeaders(TR.US_BALANCE);
  if (!headers) return null;

  const params = new URLSearchParams({
    CANO:           ACCOUNT_NO,
    ACNT_PRDT_CD:   ACCOUNT_PROD,
    OVRS_EXCG_CD:   exchCd,
    TR_CRCY_CD:     'USD',
    CTX_AREA_FK200: '',
    CTX_AREA_NK200: '',
  });

  try {
    const res = await fetch(
      `${API_BASE}/uapi/overseas-stock/v1/trading/inquire-balance?${params}`,
      { headers, next: { revalidate: 0 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.rt_cd !== '0') return null;

    const output1: Record<string, string>[] = data?.output1 ?? [];
    const output2: Record<string, string>  = data?.output2?.[0] ?? {};

    const items: BalanceItem[] = output1
      .map(o => {
        const avgPrice = parseFloat(o.pchs_avg_pric ?? '0');
        const curPrice = parseFloat(o.now_pric2     ?? o.ovrs_now_pric1 ?? '0');
        const qty      = parseInt(o.cblc_qty        ?? '0');
        if (qty <= 0) return null;
        const evalAmt = curPrice * qty;
        const pnl     = evalAmt - avgPrice * qty;
        const pnlPct  = avgPrice > 0 ? ((curPrice - avgPrice) / avgPrice) * 100 : 0;
        return {
          ticker:   o.ovrs_pdno       ?? '',
          name:     o.ovrs_item_name  ?? '',
          qty,
          avgPrice: Math.round(avgPrice * 100) / 100,
          curPrice: Math.round(curPrice * 100) / 100,
          evalAmt:  Math.round(evalAmt  * 100) / 100,
          pnl:      Math.round(pnl      * 100) / 100,
          pnlPct:   Math.round(pnlPct   * 10)  / 10,
          exchange: exchCd,
        } as BalanceItem;
      })
      .filter((i): i is BalanceItem => i !== null);

    // 현금·총액은 NASD 응답 output2 기준 (가장 포괄적)
    const cashUSD  = parseFloat(output2.frcr_dncl_amt_2   ?? output2.frcr_evlu_amt ?? '0');
    const totalEval = parseFloat(output2.tot_evlu_pfls_amt ?? output2.ovrs_tot_pfls ?? '0');
    const totalBuy  = parseFloat(output2.pchs_amt_smtl     ?? '0');

    return { items, cashUSD, totalEval, totalBuy };
  } catch { return null; }
}

// ── 전체 잔고 조회 (NASD + NYSE + AMEX 합산) ─────────────────────────────────
export async function getUSBalance(): Promise<BalanceResult | null> {
  const [nasd, nyse, amex] = await Promise.all([
    fetchBalanceByExchange('NASD'),
    fetchBalanceByExchange('NYSE'),
    fetchBalanceByExchange('AMEX'),
  ]);

  // 최소한 하나라도 성공해야 반환
  if (!nasd && !nyse && !amex) return null;

  // 전체 보유 종목 합산 (중복 제거)
  const allItems: BalanceItem[] = [
    ...(nasd?.items ?? []),
    ...(nyse?.items ?? []),
    ...(amex?.items ?? []),
  ];

  // 현금은 NASD 응답 기준 (가장 신뢰도 높음)
  const cashUSD  = nasd?.cashUSD  ?? nyse?.cashUSD  ?? amex?.cashUSD  ?? 0;

  // 총 평가금액 = 보유 종목 평가액 합산
  const totalEval = allItems.reduce((s, i) => s + i.evalAmt, 0);
  const totalBuy  = allItems.reduce((s, i) => s + i.avgPrice * i.qty, 0);
  const totalPnl  = totalEval - totalBuy;
  const totalPnlPct = totalBuy > 0 ? (totalPnl / totalBuy) * 100 : 0;
  const totalAssetUSD = totalEval + cashUSD;

  return {
    items:         allItems,
    totalEval:     Math.round(totalEval    * 100) / 100,
    totalBuy:      Math.round(totalBuy     * 100) / 100,
    totalPnl:      Math.round(totalPnl     * 100) / 100,
    totalPnlPct:   Math.round(totalPnlPct  * 10)  / 10,
    cashUSD:       Math.round(cashUSD      * 100) / 100,
    totalAssetUSD: Math.round(totalAssetUSD * 100) / 100,
    isPaper:       IS_PAPER,
  };
}

// ── 보유 티커 목록 ────────────────────────────────────────────────────────────
export async function getHeldTickers(): Promise<string[]> {
  const bal = await getUSBalance();
  return bal?.items.map(i => i.ticker) ?? [];
}

// ── 미국 주식 매수 ────────────────────────────────────────────────────────────
export async function buyUSStock(
  ticker: string,
  qty:    number,
  price:  number = 0
): Promise<OrderResult> {
  const headers = await makeHeaders(TR.US_BUY);
  const excd    = getExchangeCode(ticker);
  if (!headers) return { success: false, ordNo: null, ticker, side: 'BUY', qty, price, exchange: excd, isPaper: IS_PAPER, error: '토큰 발급 실패' };

  const body = {
    CANO:            ACCOUNT_NO,
    ACNT_PRDT_CD:    ACCOUNT_PROD,
    OVRS_EXCG_CD:    excd,
    PDNO:            ticker,
    ORD_QTY:         String(qty),
    OVRS_ORD_UNPR:   price > 0 ? String(price) : '0',
    ORD_SVR_DVSN_CD: '0',
    ORD_DVSN:        price > 0 ? '00' : '01',
  };

  try {
    const res  = await fetch(`${API_BASE}/uapi/overseas-stock/v1/trading/order`, {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    const data = await res.json();
    const ok   = data?.rt_cd === '0';
    return {
      success:  ok,
      ordNo:    data?.output?.ODNO ?? null,
      ticker, side: 'BUY', qty, price, exchange: excd, isPaper: IS_PAPER,
      error:    ok ? undefined : (data?.msg1 ?? '주문 실패'),
    };
  } catch (e) {
    return { success: false, ordNo: null, ticker, side: 'BUY', qty, price, exchange: excd, isPaper: IS_PAPER, error: String(e) };
  }
}

// ── 미국 주식 매도 ────────────────────────────────────────────────────────────
export async function sellUSStock(
  ticker: string,
  qty:    number,
  price:  number = 0
): Promise<OrderResult> {
  const headers = await makeHeaders(TR.US_SELL);
  const excd    = getExchangeCode(ticker);
  if (!headers) return { success: false, ordNo: null, ticker, side: 'SELL', qty, price, exchange: excd, isPaper: IS_PAPER, error: '토큰 발급 실패' };

  const body = {
    CANO:            ACCOUNT_NO,
    ACNT_PRDT_CD:    ACCOUNT_PROD,
    OVRS_EXCG_CD:    excd,
    PDNO:            ticker,
    ORD_QTY:         String(qty),
    OVRS_ORD_UNPR:   price > 0 ? String(price) : '0',
    ORD_SVR_DVSN_CD: '0',
    ORD_DVSN:        price > 0 ? '00' : '01',
  };

  try {
    const res  = await fetch(`${API_BASE}/uapi/overseas-stock/v1/trading/order`, {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    const data = await res.json();
    const ok   = data?.rt_cd === '0';
    return {
      success:  ok,
      ordNo:    data?.output?.ODNO ?? null,
      ticker, side: 'SELL', qty, price, exchange: excd, isPaper: IS_PAPER,
      error:    ok ? undefined : (data?.msg1 ?? '주문 실패'),
    };
  } catch (e) {
    return { success: false, ordNo: null, ticker, side: 'SELL', qty, price, exchange: excd, isPaper: IS_PAPER, error: String(e) };
  }
}
