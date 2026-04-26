import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

// ── Types ────────────────────────────────────────────────────────────────────
export interface DBAnalysisCache {
  id?: number;
  analysis_date: string;       // YYYY-MM-DD
  stocks: Record<string, unknown>[];
  market_context: string;
  analyzed_at?: string;
}

export interface DBWatchlist {
  id?: number;
  tickers: string[];
  updated_at?: string;
}

export interface DBPortfolio {
  id?: number;
  holdings: { ticker: string; avgPrice: number; shares: number }[];
  results?: Record<string, unknown>[] | null;
  analyzed_at?: string | null;
  updated_at?: string;
}

// ── Analysis Cache ────────────────────────────────────────────────────────────
export async function getAnalysisCache(date: string): Promise<DBAnalysisCache | null> {
  const { data, error } = await supabase
    .from('analysis_cache')
    .select('*')
    .eq('analysis_date', date)
    .single();
  if (error || !data) return null;
  return data as DBAnalysisCache;
}

export async function saveAnalysisCache(payload: DBAnalysisCache): Promise<boolean> {
  const { error } = await supabase
    .from('analysis_cache')
    .upsert({ ...payload, analyzed_at: new Date().toISOString() }, { onConflict: 'analysis_date' });
  return !error;
}

// ── Watchlist ─────────────────────────────────────────────────────────────────
export async function getWatchlist(): Promise<string[]> {
  const { data } = await supabase
    .from('user_watchlist')
    .select('tickers')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();
  return (data as DBWatchlist | null)?.tickers ?? [];
}

export async function saveWatchlist(tickers: string[]): Promise<boolean> {
  // Always upsert row id=1
  const { error } = await supabase
    .from('user_watchlist')
    .upsert({ id: 1, tickers, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  return !error;
}

// ── Portfolio ─────────────────────────────────────────────────────────────────
export async function getPortfolio(): Promise<DBPortfolio | null> {
  const { data } = await supabase
    .from('user_portfolio')
    .select('*')
    .eq('id', 1)
    .single();
  return (data as DBPortfolio | null);
}

export async function savePortfolio(payload: Partial<DBPortfolio>): Promise<boolean> {
  const { error } = await supabase
    .from('user_portfolio')
    .upsert({ id: 1, ...payload, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  return !error;
}

