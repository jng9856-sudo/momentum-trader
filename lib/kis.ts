// 한국투자증권 OpenAPI 클라이언트
// 실시간 시세 (지연 없음) - 미장 + 국장

const KIS_APP_KEY    = process.env.KIS_APP_KEY!;
const KIS_APP_SECRET = process.env.KIS_APP_SECRET!;
const BASE_URL       = 'https://openapi.koreainvestment.com:9443';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// ── Access Token 발급 (24시간 유효) ──────────────────────────────────────────
// Vercel 서버리스는 인스턴스가 매 요청마다 초기화되므로
// 메모리 캐시만으로는 토큰이 계속 재발급됨 → Supabase에 영속 저장

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  if (!KIS_APP_KEY || !KIS_APP_SECRET) return null;

  // 1. 메모리 캐시 먼저 확인 (같은 인스턴스 내 재요청 최적화)
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  // 2. Supabase에서 저장된 토큰 확인 (인스턴스 간 공유)
  try {
    const dbRes = await fetch(
      `${SUPABASE_URL}/rest/v1/kis_token?id=eq.singleton&select=token,expires_at`,
      {
        headers: {
          'apikey':        SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
      }
    );
    if (dbRes.ok) {
      const rows = await dbRes.json();
      if (rows?.[0] && rows[0].expires_at > Date.now()) {
        // DB 토큰 유효 → 메모리에도 세팅 후 반환
        cachedToken = { token: rows[0].token, expiresAt: rows[0].expires_at };
        return cachedToken.token;
      }
    }
  } catch { /* DB 조회 실패 시 새로 발급으로 fallback */ }

  // 3. 만료됐거나 없으면 KIS에서 새로 발급
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
    const expiresAt = Date.now() + 23 * 60 * 60 * 1000; // 23시간

    // 메모리 캐시 업데이트
    cachedToken = { token: data.access_token, expiresAt };

    // Supabase에 upsert 저장 (다음 인스턴스에서 재사용)
    await fetch(`${SUPABASE_URL}/rest/v1/kis_token`, {
      method: 'POST',
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        id:         'singleton',
        token:      data.access_token,
        expires_at: expiresAt,
      }),
    });

    return data.access_token;
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
