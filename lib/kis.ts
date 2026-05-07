// 한국투자증권 OpenAPI 클라이언트
// 실시간 시세 (지연 없음) - 미장 + 국장

const KIS_APP_KEY    = process.env.KIS_APP_KEY!;
const KIS_APP_SECRET = process.env.KIS_APP_SECRET!;
const BASE_URL       = 'https://openapi.koreainvestment.com:9443';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// ── 거래소 코드 매핑 ──────────────────────────────────────────────────────────
const NYSE_TICKERS = new Set([
  'TSM', 'V', 'MA', 'JPM', 'WMT', 'JNJ', 'PG', 'CVX', 'XOM', 'BAC',
  'DIS', 'KO', 'PFE', 'MRK', 'ABT', 'IBM', 'GS', 'MS', 'CAT', 'HON',
  'MMM', 'GE', 'F', 'GM', 'BA', 'UNH', 'HD', 'MCD', 'NKE', 'T',
]);
const AMEX_TICKERS = new Set(['SPY', 'QQQ', 'IWM', 'DIA', 'GLD', 'SLV', 'USO']);

function getExchangeCode(ticker: string): 'NAS' | 'NYS' | 'AMS' {
  if (NYSE_TICKERS.has(ticker)) return 'NYS';
  if (AMEX_TICKERS.has(ticker)) return 'AMS';
  return 'NAS';
}

// ── 현재 미국 장 세션 판단 (KST 기준) ────────────────────────────────────────
export function getUSMarketSession(): 'REGULAR' | 'PRE' | 'AFTER' | 'CLOSED' {
  const now = new Date();
  const ny = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = ny.getDay();
  const t = ny.getHours() * 60 + ny.getMinutes();

  if (day === 0 || day === 6) return 'CLOSED';

  if (t >= 4 * 60 && t < 9 * 60 + 30)  return 'PRE';
  if (t >= 9 * 60 + 30 && t < 16 * 60) return 'REGULAR';
  if (t >= 16 * 60 && t < 20 * 60)     return 'AFTER';
  return 'CLOSED';
}

// ── Access Token 발급 (24시간 유효) ──────────────────────────────────────────
// 인메모리 캐시: 동일 프로세스 내 재사용 (서버리스에서는 Supabase가 주 캐시)
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  if (!KIS_APP_KEY || !KIS_APP_SECRET) return null;

  // 1순위: 인메모리 캐시 (프로세스 재사용 시)
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  // 2순위: Supabase DB 캐시
  // ── [핵심 수정] expires_at 서버사이드 필터 추가 → 만료 토큰 조회 방지 ──
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const now = Date.now();
      // expires_at=gt.{now} 필터: DB에서 유효한 토큰만 반환
      const dbRes = await fetch(
        `${SUPABASE_URL}/rest/v1/kis_token?id=eq.singleton&expires_at=gt.${now}&select=token,expires_at`,
        {
          headers: {
            'apikey':        SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
          },
          // DB 응답 자체는 캐싱하지 않음
          cache: 'no-store',
        }
      );
      if (dbRes.ok) {
        const rows = await dbRes.json();
        const row = rows?.[0];
        if (row?.token && row?.expires_at) {
          // expires_at이 문자열로 올 경우 대비해 숫자 변환
          const expiresAt = typeof row.expires_at === 'number'
            ? row.expires_at
            : parseInt(String(row.expires_at), 10);

          if (expiresAt > now) {
            // 인메모리에도 저장해두어 동일 프로세스 내 재사용
            cachedToken = { token: row.token, expiresAt };
            return cachedToken.token;
          }
        }
      }
    } catch {
      // Supabase 실패 시 재발급으로 fallback
    }
  }

  // 3순위: KIS API 재발급 (여기까지 오면 문자 발송됨)
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

    const data      = await res.json();
    const expiresAt = Date.now() + 23 * 60 * 60 * 1000; // 23시간 후
    cachedToken     = { token: data.access_token, expiresAt };

    // Supabase에 저장 (upsert)
    if (SUPABASE_URL && SUPABASE_KEY) {
      try {
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
            expires_at: expiresAt,  // 밀리초 숫자로 저장
          }),
        });
      } catch {
        // Supabase 저장 실패해도 토큰은 사용 가능
      }
    }

    return data.access_token;
  } catch { return null; }
}

// ── 미국 주식 실시간 현재가 ────────────────────────────────────────────────────
export async function getUSStockPrice(ticker: string): Promise<{
  ticker:       string;
  price:        number;
  change:       number;
  changePct:    number;
  high:         number;
  low:          number;
  open:         number;
  volume:       number;
  isRealtime:   boolean;
  marketSession: 'REGULAR' | 'PRE' | 'AFTER' | 'CLOSED';
  extPrice:     number | null;
  extChange:    number | null;
  extChangePct: number | null;
} | null> {
  const token = await getAccessToken();
  if (!token) return null;

  const excd = getExchangeCode(ticker);

  try {
    const res = await fetch(
      `${BASE_URL}/uapi/overseas-price/v1/quotations/price?AUTH=&EXCD=${excd}&SYMB=${ticker}`,
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

    const extPrice    = parseFloat(o.t_xprc ?? '0');
    const extDif      = parseFloat(o.t_xdif ?? '0');
    const extRat      = parseFloat(o.t_xrat ?? '0');
    const hasExtPrice = extPrice > 0;

    const marketSession = getUSMarketSession();

    const effectiveChange =
      hasExtPrice && marketSession !== 'REGULAR'
        ? extDif
        : price - prevClose;
    const effectiveChangePct =
      hasExtPrice && marketSession !== 'REGULAR'
        ? extRat
        : prevClose > 0 ? (effectiveChange / prevClose) * 100 : 0;

    return {
      ticker,
      price,
      change:       Math.round(effectiveChange * 100) / 100,
      changePct:    Math.round(effectiveChangePct * 100) / 100,
      high:         parseFloat(o.high ?? '0'),
      low:          parseFloat(o.low  ?? '0'),
      open:         parseFloat(o.open ?? '0'),
      volume:       parseInt(o.tvol   ?? '0'),
      isRealtime:   true,
      marketSession,
      extPrice:     hasExtPrice ? extPrice : null,
      extChange:    hasExtPrice ? Math.round(extDif * 100) / 100 : null,
      extChangePct: hasExtPrice ? Math.round(extRat * 100) / 100 : null,
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

    return {
      code,
      name:      o.hts_kor_isnm ?? code,
      price:     parseInt(o.stck_prpr ?? '0'),
      change:    parseInt(o.prdy_vrss ?? '0'),
      changePct: parseFloat(o.prdy_ctrt ?? '0'),
      high:      parseInt(o.stck_hgpr ?? '0'),
      low:       parseInt(o.stck_lwpr ?? '0'),
      open:      parseInt(o.stck_oprc ?? '0'),
      volume:    parseInt(o.acml_vol  ?? '0'),
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

// ── 거래소 코드 변환 ──────────────────────────────────────────────────────────
export function toKISCode(yahooTicker: string): string {
  return yahooTicker.replace(/\.(KS|KQ)$/, '');
}

export function isKRStock(ticker: string): boolean {
  return ticker.endsWith('.KS') || ticker.endsWith('.KQ') || /^\d{6}$/.test(ticker);
}
