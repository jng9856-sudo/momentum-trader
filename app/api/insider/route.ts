import { NextRequest, NextResponse } from 'next/server';

interface InsiderTransaction {
  filingDate: string;
  insiderName: string;
  title: string;
  transactionType: string;
  shares: number;
  price: number | null;
  totalValue: number | null;
  isBuy: boolean;
}

interface InsiderSummary {
  ticker: string;
  transactions: InsiderTransaction[];
  recentBuys: number;
  recentSells: number;
  netShares: number;
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  detail: string;
}

// SEC EDGAR CIK lookup
async function getCIK(ticker: string): Promise<string | null> {
  try {
    const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
      headers: { 'User-Agent': 'MomentumTrader research@example.com' },
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const entry = Object.values(data).find(
      (v: unknown) => (v as { ticker: string }).ticker === ticker.toUpperCase()
    ) as { cik_str: number } | undefined;
    if (!entry) return null;
    return String(entry.cik_str).padStart(10, '0');
  } catch { return null; }
}

// Get recent Form 4 filings
async function getForm4(cik: string): Promise<InsiderTransaction[]> {
  try {
    const res = await fetch(
      `https://data.sec.gov/submissions/CIK${cik}.json`,
      { headers: { 'User-Agent': 'MomentumTrader research@example.com' }, next: { revalidate: 3600 } }
    );
    if (!res.ok) return [];
    const data = await res.json();

    const filings = data.filings?.recent;
    if (!filings) return [];

    const { form, filingDate, primaryDocument, reportingOwner } = filings;
    const transactions: InsiderTransaction[] = [];

    // Find Form 4 filings in the last 90 days
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;

    for (let i = 0; i < form.length; i++) {
      if (form[i] !== '4') continue;
      const dateStr = filingDate[i];
      if (!dateStr || new Date(dateStr).getTime() < cutoff) continue;

      // Parse the filing XML to get transaction details
      const accNo = data.filings.recent.accessionNumber?.[i]?.replace(/-/g, '');
      const doc   = primaryDocument?.[i];
      if (!accNo || !doc) continue;

      try {
        const xmlRes = await fetch(
          `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/` +
          `${accNo}/${doc}`,
          { headers: { 'User-Agent': 'MomentumTrader research@example.com' } }
        );
        if (!xmlRes.ok) continue;
        const xml = await xmlRes.text();

        // Extract key fields from XML
        const getTag = (tag: string) => {
          const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
          return m ? m[1].trim() : null;
        };

        const transCode = getTag('transactionCode');
        // P = Purchase, S = Sale, A = Award (ignore awards)
        if (!transCode || !['P', 'S'].includes(transCode)) continue;

        const sharesStr = getTag('transactionShares') ?? getTag('sharesOwnedFollowingTransaction');
        const priceStr  = getTag('transactionPricePerShare');
        const shares    = sharesStr ? Math.abs(parseFloat(sharesStr)) : 0;
        const price     = priceStr  ? parseFloat(priceStr) : null;

        const nameMatch = xml.match(/<rptOwnerName>([^<]*)<\/rptOwnerName>/i);
        const roleMatch = xml.match(/<officerTitle>([^<]*)<\/officerTitle>/i);

        const ownerName = nameMatch?.[1]?.trim() ?? reportingOwner?.[i] ?? 'Unknown';
        const ownerRole = roleMatch?.[1]?.trim() ?? 'Insider';
        const isBuy     = transCode === 'P';

        transactions.push({
          filingDate: dateStr,
          insiderName: ownerName,
          title: ownerRole,
          transactionType: isBuy ? '매수' : '매도',
          shares: Math.round(shares),
          price,
          totalValue: price && shares ? Math.round(price * shares) : null,
          isBuy,
        });

        if (transactions.length >= 10) break; // Limit to recent 10
      } catch { continue; }
    }

    return transactions.sort((a, b) => new Date(b.filingDate).getTime() - new Date(a.filingDate).getTime());
  } catch { return []; }
}

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get('ticker')?.toUpperCase();
  if (!ticker) return NextResponse.json({ error: 'ticker required' }, { status: 400 });

  const cik = await getCIK(ticker);
  if (!cik) return NextResponse.json({ ticker, transactions: [], signal: 'NEUTRAL', detail: 'CIK 조회 실패', recentBuys: 0, recentSells: 0, netShares: 0 });

  const transactions = await getForm4(cik);

  const recentBuys  = transactions.filter(t => t.isBuy).length;
  const recentSells = transactions.filter(t => !t.isBuy).length;
  const buyShares   = transactions.filter(t => t.isBuy).reduce((a, t) => a + t.shares, 0);
  const sellShares  = transactions.filter(t => !t.isBuy).reduce((a, t) => a + t.shares, 0);
  const netShares   = buyShares - sellShares;

  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  let detail: string;

  if (transactions.length === 0) {
    signal = 'NEUTRAL';
    detail = '최근 90일 내부자 거래 없음';
  } else if (recentBuys > recentSells * 2) {
    signal = 'BULLISH';
    detail = `내부자 ${recentBuys}건 매수 — 강한 내부자 매집 신호`;
  } else if (recentSells > recentBuys * 2) {
    signal = 'BEARISH';
    detail = `내부자 ${recentSells}건 매도 — 내부자 분산 신호`;
  } else {
    signal = 'NEUTRAL';
    detail = `매수 ${recentBuys}건 / 매도 ${recentSells}건 — 혼조세`;
  }

  const result: InsiderSummary = { ticker, transactions, recentBuys, recentSells, netShares, signal, detail };
  return NextResponse.json(result);
}

