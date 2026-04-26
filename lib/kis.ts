// 한국투자증권 OpenAPI 클라이언트
// 실시간 시세 (지연 없음) - 미장 + 국장

const KIS_APP_KEY    = process.env.KIS_APP_KEY!;
const KIS_APP_SECRET = process.env.KIS_APP_SECRET!;
const BASE_URL       = 'https://openapi.koreainvestment.com:9443';

// ── Access Token 발급 (24시간 유효) ──────────────────────────────────────────
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  if (!KIS_APP_KEY || !KIS_APP_SECRET) return null;
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;

  try {
    const res = await fetch(`${BASE_URL}/oauth2/tokenP`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type:   'client_credentials',
        appkey:       KIS_APP_KEY,
        appsecret:    KIS_APP_SECRET,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    cachedToken = {
      token:     data.access_token,
      expiresAt: Date.now() + 23 * 60 * 60 * 1000, // 23시간
    };
    return cachedToken.token;
  } catch { return null; }
}

// ── 미국 주식 실시간 현재가 ────────────────────────────────────────────────────
export async function getUSStockPrice(ticker: string): Promise<{
  ticker:    string;
  price:     number;
  change:    number;
  changePct: number;
  high:      number;
  low:       number;
  open:      number;
  volume:    number;
  isRealtime: boolean;
} | null> {
  const token = await getAccessToken();
  if (!token) return null;

  try {
    const res = await fetch(
      `${BASE_URL}/uapi/overseas-price/v1/quotations/price?AUTH=&EXCD=NAS&SYMB=${ticker}`,
      {
        headers: {
          'content-type':  'application/json',
          'authorization': `Bearer ${token}`,
          'appkey':        KIS_APP_KEY,
          'appsecret':     KIS_APP_SECRET,
          'tr_id':         'HHDFS00000300',
        },
        next: { revalidate: 0 },
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const o = data.output;
    if (!o) return null;

    const price     = parseFloat(o.last ?? o.base ?? '0');
    const prevClose = parseFloat(o.base ?? '0');
    const change    = price - prevClose;
    const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;

    return {
      ticker, price,
      change:    Math.round(change * 100) / 100,
      changePct: Math.round(changePct * 100) / 100,
      high:      parseFloat(o.high ?? '0'),
      low:       parseFloat(o.low  ?? '0'),
      open:      parseFloat(o.open ?? '0'),
      volume:    parseInt(o.tvol   ?? '0'),
      isRealtime: true,
    };
  } catch { return null; }
}

// ── 국내 주식 실시간 현재가 ────────────────────────────────────────────────────
export async function getKRStockPrice(code: string): Promise<{
  code:      string;
  name:      string;
  price:     number;
  change:    number;
  changePct: number;
  high:      number;
  low:       number;
  open:      number;
  volume:    number;
  isRealtime: boolean;
} | null> {
  const token = await getAccessToken();
  if (!token) return null;

  try {
    const res = await fetch(
      `${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-price?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${code}`,
      {
        headers: {
          'content-type':  'application/json',
          'authorization': `Bearer ${token}`,
          'appkey':        KIS_APP_KEY,
          'appsecret':     KIS_APP_SECRET,
          'tr_id':         'FHKST01010100',
        },
        next: { revalidate: 0 },
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const o = data.output;
    if (!o) return null;

    const price     = parseInt(o.stck_prpr ?? '0');
    const change    = parseInt(o.prdy_vrss ?? '0');
    const changePct = parseFloat(o.prdy_ctrt ?? '0');

    return {
      code, name: o.hts_kor_isnm ?? code,
      price, change, changePct,
      high:   parseInt(o.stck_hgpr ?? '0'),
      low:    parseInt(o.stck_lwpr ?? '0'),
      open:   parseInt(o.stck_oprc ?? '0'),
      volume: parseInt(o.acml_vol  ?? '0'),
      isRealtime: true,
    };
  } catch { return null; }
}

// ── 여러 미국 종목 동시 조회 ──────────────────────────────────────────────────
export async function getMultipleUSPrices(tickers: string[]) {
  const results = await Promise.all(tickers.map(t => getUSStockPrice(t)));
  const map: Record<string, NonNullable<Awaited<ReturnType<typeof getUSStockPrice>>>> = {};
  for (let i = 0; i < tickers.length; i++) {
    if (results[i]) map[tickers[i]] = results[i]!;
  }
  return map;
}

// ── 거래소 코드 변환 (Yahoo .KS → KIS 코드) ──────────────────────────────────
export function toKISCode(yahooTicker: string): string {
  // 005930.KS → 005930
  return yahooTicker.replace(/\.(KS|KQ)$/, '');
}

export function isKRStock(ticker: string): boolean {
  return ticker.endsWith('.KS') || ticker.endsWith('.KQ') || /^\d{6}$/.test(ticker);
}

