// Finnhub 실시간 시세 클라이언트
const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
const BASE = 'https://finnhub.io/api/v1';

interface FinnhubQuote {
  c:  number;  // 현재가
  d:  number;  // 전일 대비 변동
  dp: number;  // 전일 대비 %
  h:  number;  // 당일 고가
  l:  number;  // 당일 저가
  o:  number;  // 당일 시가
  pc: number;  // 전일 종가
  t:  number;  // 타임스탬프
}

interface FinnhubCandle {
  c: number[];  // 종가 배열
  h: number[];  // 고가 배열
  l: number[];  // 저가 배열
  o: number[];  // 시가 배열
  v: number[];  // 거래량 배열
  t: number[];  // 타임스탬프 배열
  s: string;    // 상태 ('ok' | 'no_data')
}

// 실시간 현재가 (지연 없음)
export async function getQuote(ticker: string): Promise<FinnhubQuote | null> {
  if (!FINNHUB_KEY) return null;
  try {
    const res = await fetch(`${BASE}/quote?symbol=${ticker}&token=${FINNHUB_KEY}`, {
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.c ? data as FinnhubQuote : null;
  } catch { return null; }
}

// 일봉 OHLCV 데이터 (최대 1년)
export async function getCandles(ticker: string, days = 365): Promise<FinnhubCandle | null> {
  if (!FINNHUB_KEY) return null;
  try {
    const to   = Math.floor(Date.now() / 1000);
    const from = to - days * 24 * 60 * 60;
    const res  = await fetch(
      `${BASE}/stock/candle?symbol=${ticker}&resolution=D&from=${from}&to=${to}&token=${FINNHUB_KEY}`,
      { next: { revalidate: 3600 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.s === 'ok' ? data as FinnhubCandle : null;
  } catch { return null; }
}

// 종목 기본 정보
export async function getProfile(ticker: string): Promise<{ name: string; exchange: string; industry: string; marketCap: number } | null> {
  if (!FINNHUB_KEY) return null;
  try {
    const res = await fetch(`${BASE}/stock/profile2?symbol=${ticker}&token=${FINNHUB_KEY}`, {
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    const d = await res.json();
    return { name: d.name, exchange: d.exchange, industry: d.finnhubIndustry, marketCap: d.marketCapitalization };
  } catch { return null; }
}

// 여러 종목 실시간 시세 한번에
export async function getMultipleQuotes(tickers: string[]): Promise<Record<string, FinnhubQuote>> {
  const results = await Promise.all(
    tickers.map(async t => ({ ticker: t, quote: await getQuote(t) }))
  );
  const map: Record<string, FinnhubQuote> = {};
  for (const { ticker, quote } of results) {
    if (quote) map[ticker] = quote;
  }
  return map;
}
// ETF 전용 하드코딩 맵 (Finnhub이 null 반환하는 종목들)
const ETF_INDUSTRY_MAP: Record<string, string> = {
  ARKX: 'ETF-Space',
  ARKG: 'ETF-Genomics',
  ARKK: 'ETF-Innovation',
  ARKW: 'ETF-Internet',
  ARKF: 'ETF-Fintech',
  ARKO: 'ETF-Autonomous',
  PL:   'Space-Data',      // Planet Labs (ETF 아니지만 분류 어려움)
  IONQ: 'Quantum Computing',
  MSTR: 'Crypto-Finance',
};

export async function getProfile(ticker: string) {
  // ETF 맵 먼저 확인 → Finnhub 호출 불필요
  if (ETF_INDUSTRY_MAP[ticker]) {
    return {
      name: ticker,
      exchange: 'NASDAQ',
      industry: ETF_INDUSTRY_MAP[ticker],  // 직접 주입
      marketCap: 0
    };
  }

  // 기존 Finnhub 호출
  const res = await fetch(`${BASE}/stock/profile2?symbol=${ticker}&token=${FINNHUB_KEY}`, ...);
  const d = await res.json();

  return {
    name:      d.name     ?? ticker,
    exchange:  d.exchange ?? '',
    industry:  d.finnhubIndustry || 'Unknown',  // null 방어
    marketCap: d.marketCapitalization ?? 0
  };
}
