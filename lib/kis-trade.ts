// lib/kis-trade.ts — 한국투자증권 주문 API

const KIS_APP_KEY    = process.env.KIS_APP_KEY!;
const KIS_APP_SECRET = process.env.KIS_APP_SECRET!;
const BASE_URL       = 'https://openapi.koreainvestment.com:9443';

// ── 계좌 정보 ────────────────────────────────────────────────────────────────
const ACCOUNT_NO   = process.env.KIS_ACCOUNT_NO!;       // 예: "12345678"
const ACCOUNT_PROD = process.env.KIS_ACCOUNT_PROD ?? '01'; // 예: "01"

// ── 모의투자 여부 (기본값: true → 모의투자) ──────────────────────────────────
export const IS_PAPER = process.env.KIS_PAPER_TRADING !== 'false';

const BASE_URL_PAPER = 'https://openapivts.koreainvestment.com:29443';
const API_BASE = IS_PAPER ? BASE_URL_PAPER : BASE_URL;

// ── 거래소 코드 ───────────────────────────────────────────────────────────────
const NYSE_TICKERS = new Set([
  'TSM','V','MA','JPM','WMT','JNJ','PG','CVX','XOM','BAC',
  'DIS','KO','PFE','MRK','ABT','IBM','GS','MS','CAT','HON',
]);
const AMEX_TICKERS = new Set(['SPY','QQQ','IWM','DIA','GLD','SLV','USO']);

function getExchangeCode(ticker: string): string {
  if (NYSE_TICKERS.has(ticker)) return 'NYSE';
  if (AMEX_TICKERS.has(ticker)) return 'AMEX';
  return 'NASD';
}

// ── TR_ID 매핑 (실전 / 모의) ─────────────────────────────────────────────────
const TR = {
  US_BUY:      IS_PAPER ? 'VTTT1002U' : 'TTTT1002U',
  US_SELL:     IS_PAPER ? 'VTTT1006U' : 'TTTT1006U',
  US_BALANCE:  IS_PAPER ? 'VTTS3012R' : 'TTTS3012R',
  US_ORDERS:   IS_PAPER ? 'VTTS3035R' : 'TTTS3035R',
  KR_BUY:      IS_PAPER ? 'VTTC0802U' : 'TTTC0802U',
  KR_SELL:     IS_PAPER ? 'VTTC0801U' : 'TTTC0801U',
  KR_BALANCE:  IS_PAPER ? 'VTTC8434R' : 'TTTC8434R',
};

// ── Access Token (kis.ts와 공유하지 않고 독립 관리) ──────────────────────────
let _token: { value: string; exp: number } | null = null;

async function getToken(): Promise<string | null> {
  if (_token && Date.now() < _token.exp) return _token.value;
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
    if (!res.ok) return null;
    const data = await res.json();
    _token = { value: data.access_token, exp: Date.now() + 23 * 3600 * 1000 };
    return _token.value;
  } catch { return null; }
}

// ── 공통 헤더 ─────────────────────────────────────────────────────────────────
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
  success:    boolean;
  ordNo:      string | null;
  ticker:     string;
  side:       'BUY' | 'SELL';
  qty:        number;
  price:      number;
  exchange:   string;
  isPaper:    boolean;
  error?:     string;
  raw?:       unknown;
}

export interface BalanceItem {
  ticker:     string;
  name:       string;
  qty:        number;
  avgPrice:   number;
  curPrice:   number;
  evalAmt:    number;
  pnl:        number;
  pnlPct:     number;
  exchange:   string;
}

export interface BalanceResult {
  items:       BalanceItem[];
  totalEval:   number;
  totalBuy:    number;
  totalPnl:    number;
  totalPnlPct: number;
  cashUSD:     number;
  isPaper:     boolean;
}

// ── 미국 주식 매수 ────────────────────────────────────────────────────────────
export async function buyUSStock(
  ticker: string,
  qty:    number,
  price:  number = 0   // 0 = 시장가
): Promise<OrderResult> {
  const headers = await makeHeaders(TR.US_BUY);
  if (!headers) return { success: false, ordNo: null, ticker, side: 'BUY', qty, price, exchange: getExchangeCode(ticker), isPaper: IS_PAPER, error: '토큰 발급 실패' };

  const body = {
    CANO:           ACCOUNT_NO,
    ACNT_PRDT_CD:   ACCOUNT_PROD,
    OVRS_EXCG_CD:   getExchangeCode(ticker),
    PDNO:           ticker,
    ORD_QTY:        String(qty),
    OVRS_ORD_UNPR:  price > 0 ? String(price) : '0',
    ORD_SVR_DVSN_CD: '0',
    ORD_DVSN:       price > 0 ? '00' : '01',  // 00=지정가, 01=시장가
  };

  try {
    const res = await fetch(`${API_BASE}/uapi/overseas-stock/v1/trading/order`, {
      method:  'POST',
      headers,
      body:    JSON.stringify(body),
    });
    const data = await res.json();
    const ok = data?.rt_cd === '0';
    return {
      success:  ok,
      ordNo:    data?.output?.ODNO ?? null,
      ticker, side: 'BUY', qty, price,
      exchange: getExchangeCode(ticker),
      isPaper:  IS_PAPER,
      error:    ok ? undefined : (data?.msg1 ?? '주문 실패'),
      raw:      data,
    };
  } catch (e) {
    return { success: false, ordNo: null, ticker, side: 'BUY', qty, price, exchange: getExchangeCode(ticker), isPaper: IS_PAPER, error: String(e) };
  }
}

// ── 미국 주식 매도 ────────────────────────────────────────────────────────────
export async function sellUSStock(
  ticker: string,
  qty:    number,
  price:  number = 0
): Promise<OrderResult> {
  const headers = await makeHeaders(TR.US_SELL);
  if (!headers) return { success: false, ordNo: null, ticker, side: 'SELL', qty, price, exchange: getExchangeCode(ticker), isPaper: IS_PAPER, error: '토큰 발급 실패' };

  const body = {
    CANO:           ACCOUNT_NO,
    ACNT_PRDT_CD:   ACCOUNT_PROD,
    OVRS_EXCG_CD:   getExchangeCode(ticker),
    PDNO:           ticker,
    ORD_QTY:        String(qty),
    OVRS_ORD_UNPR:  price > 0 ? String(price) : '0',
    ORD_SVR_DVSN_CD: '0',
    ORD_DVSN:       price > 0 ? '00' : '01',
  };

  try {
    const res = await fetch(`${API_BASE}/uapi/overseas-stock/v1/trading/order`, {
      method:  'POST',
      headers,
      body:    JSON.stringify(body),
    });
    const data = await res.json();
    const ok = data?.rt_cd === '0';
    return {
      success:  ok,
      ordNo:    data?.output?.ODNO ?? null,
      ticker, side: 'SELL', qty, price,
      exchange: getExchangeCode(ticker),
      isPaper:  IS_PAPER,
      error:    ok ? undefined : (data?.msg1 ?? '주문 실패'),
      raw:      data,
    };
  } catch (e) {
    return { success: false, ordNo: null, ticker, side: 'SELL', qty, price, exchange: getExchangeCode(ticker), isPaper: IS_PAPER, error: String(e) };
  }
}

// ── 미국 주식 잔고 조회 ──────────────────────────────────────────────────────
export async function getUSBalance(): Promise<BalanceResult | null> {
  const headers = await makeHeaders(TR.US_BALANCE);
  if (!headers) return null;

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
      { headers }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.rt_cd !== '0') return null;

    const output1: unknown[] = data?.output1 ?? [];
    const output2 = data?.output2?.[0] ?? {};

    const items: BalanceItem[] = (output1 as Record<string, string>[]).map(o => {
      const avgPrice = parseFloat(o.pchs_avg_pric ?? '0');
      const curPrice = parseFloat(o.now_pric2     ?? '0');
      const qty      = parseInt(o.cblc_qty        ?? '0');
      const evalAmt  = curPrice * qty;
      const pnl      = evalAmt - avgPrice * qty;
      const pnlPct   = avgPrice > 0 ? ((curPrice - avgPrice) / avgPrice) * 100 : 0;
      return {
        ticker:   o.ovrs_pdno   ?? '',
        name:     o.ovrs_item_name ?? '',
        qty,
        avgPrice: Math.round(avgPrice * 100) / 100,
        curPrice: Math.round(curPrice * 100) / 100,
        evalAmt:  Math.round(evalAmt  * 100) / 100,
        pnl:      Math.round(pnl      * 100) / 100,
        pnlPct:   Math.round(pnlPct   * 10)  / 10,
        exchange: o.ovrs_excg_cd ?? 'NASD',
      };
    }).filter(i => i.qty > 0);

    const totalEval   = parseFloat((output2 as Record<string, string>).tot_evlu_pfls_amt ?? '0');
    const totalBuy    = parseFloat((output2 as Record<string, string>).pchs_amt_smtl     ?? '0');
    const totalPnl    = totalEval - totalBuy;
    const totalPnlPct = totalBuy > 0 ? (totalPnl / totalBuy) * 100 : 0;
    const cashUSD     = parseFloat((output2 as Record<string, string>).frcr_dncl_amt_2   ?? '0');

    return {
      items,
      totalEval:   Math.round(totalEval   * 100) / 100,
      totalBuy:    Math.round(totalBuy    * 100) / 100,
      totalPnl:    Math.round(totalPnl    * 100) / 100,
      totalPnlPct: Math.round(totalPnlPct * 10)  / 10,
      cashUSD:     Math.round(cashUSD     * 100) / 100,
      isPaper:     IS_PAPER,
    };
  } catch { return null; }
}

// ── 포지션 보유 여부 확인 ─────────────────────────────────────────────────────
export async function getHeldTickers(): Promise<string[]> {
  const bal = await getUSBalance();
  return bal?.items.map(i => i.ticker) ?? [];
}
