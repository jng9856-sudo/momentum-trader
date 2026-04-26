import { NextResponse } from 'next/server';

const SECTORS = [
  // 메인 섹터 ETF
  { ticker: 'XLK',  name: '기술',        group: 'main' },
  { ticker: 'XLC',  name: '통신',        group: 'main' },
  { ticker: 'XLF',  name: '금융',        group: 'main' },
  { ticker: 'XLE',  name: '에너지',      group: 'main' },
  { ticker: 'XLV',  name: '헬스케어',    group: 'main' },
  { ticker: 'XLY',  name: '경기소비재',  group: 'main' },
  { ticker: 'XLI',  name: '산업재',      group: 'main' },
  { ticker: 'XLB',  name: '소재',        group: 'main' },
  { ticker: 'XLP',  name: '필수소비재',  group: 'main' },
  { ticker: 'XLRE', name: '부동산',      group: 'main' },
  { ticker: 'XLU',  name: '유틸리티',    group: 'main' },
  // 주요 테마 ETF
  { ticker: 'SOXX', name: '반도체',      group: 'theme' },
  { ticker: 'ARKK', name: 'AI/혁신',     group: 'theme' },
  { ticker: 'CIBR', name: '사이버보안',  group: 'theme' },
  { ticker: 'CLOUD',name: '클라우드',    group: 'theme' },
  { ticker: 'BOTZ', name: '로보틱스',    group: 'theme' },
  { ticker: 'LIT',  name: '배터리',      group: 'theme' },
  { ticker: 'ICLN', name: '청정에너지',  group: 'theme' },
  { ticker: 'GDX',  name: '금광',        group: 'theme' },
  { ticker: 'IBB',  name: '바이오',      group: 'theme' },
  // 지수
  { ticker: 'SPY',  name: 'S&P500',      group: 'index' },
  { ticker: 'QQQ',  name: '나스닥',      group: 'index' },
  { ticker: 'IWM',  name: '러셀2000',    group: 'index' },
];

async function fetchSectorData(ticker: string) {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=3mo`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 3600 } }
    );
    if (!res.ok) return null;
    const data   = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const timestamps: number[] = result.timestamp ?? [];
    const closes: number[]     = result.indicators?.quote?.[0]?.close ?? [];
    const volumes: number[]    = result.indicators?.quote?.[0]?.volume ?? [];

    const valid = closes.map((c: number, i: number) => ({
      c, v: volumes[i] ?? 0, t: timestamps[i] ?? 0,
    })).filter(x => x.c != null && !isNaN(x.c));

    if (valid.length < 5) return null;

    const price  = valid[valid.length - 1].c;
    const prev   = valid[valid.length - 2].c;
    const change1d = ((price - prev) / prev) * 100;

    // 1W
    const w1  = valid[Math.max(0, valid.length - 5)].c;
    const ret1w = ((price - w1) / w1) * 100;

    // 1M
    const m1  = valid[Math.max(0, valid.length - 21)].c;
    const ret1m = ((price - m1) / m1) * 100;

    // 3M
    const m3  = valid[0].c;
    const ret3m = ((price - m3) / m3) * 100;

    // YTD
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1).getTime() / 1000;
    const ytdIdx    = valid.findIndex(x => x.t >= yearStart);
    const ytdBase   = valid[ytdIdx >= 0 ? ytdIdx : 0].c;
    const retYtd    = ((price - ytdBase) / ytdBase) * 100;

    // Volume ratio
    const avgVol = valid.slice(-21, -1).map(x => x.v).reduce((a, b) => a + b, 0) / 20;
    const volRatio = avgVol > 0 ? valid[valid.length-1].v / avgVol : 1;

    const r = (n: number) => Math.round(n * 100) / 100;

    return {
      ticker, price: r(price),
      change1d: r(change1d), ret1w: r(ret1w),
      ret1m: r(ret1m), ret3m: r(ret3m), retYtd: r(retYtd),
      volRatio: r(volRatio),
    };
  } catch { return null; }
}

function heatColor(pct: number): string {
  // Strong green > +3%, green > +1%, neutral -1~+1%, red < -1%, strong red < -3%
  if (pct >= 5)  return '#064e3b'; // deep green
  if (pct >= 3)  return '#065f46';
  if (pct >= 1)  return '#166534';
  if (pct >= 0)  return '#14532d';
  if (pct >= -1) return '#7f1d1d';
  if (pct >= -3) return '#991b1b';
  return '#450a0a'; // deep red
}

function textColor(pct: number): string {
  if (pct >= 1)  return '#86efac';
  if (pct >= 0)  return '#4ade80';
  if (pct >= -1) return '#fca5a5';
  return '#f87171';
}

export async function GET() {
  const results = await Promise.all(
    SECTORS.map(async (s) => {
      const d = await fetchSectorData(s.ticker);
      return d ? { ...s, ...d, heatColor: heatColor(d.ret1m), textColor: textColor(d.ret1m) } : null;
    })
  );

  const valid = results.filter(Boolean);
  const analyzed_at = new Date().toISOString();

  // Rotation signal: find top 3 and bottom 3 by 1M return
  const sorted = [...valid].sort((a, b) => (b?.ret1m ?? 0) - (a?.ret1m ?? 0));
  const leaders  = sorted.slice(0, 3).map(s => s?.name);
  const laggards = sorted.slice(-3).map(s => s?.name);

  return NextResponse.json({ sectors: valid, leaders, laggards, analyzed_at });
}

