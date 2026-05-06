'use client';
import { useState, useEffect, useCallback } from 'react';

interface BalanceItem {
  ticker: string; name: string; qty: number;
  avgPrice: number; curPrice: number;
  evalAmt: number; pnl: number; pnlPct: number;
}
interface Balance {
  items: BalanceItem[]; totalEval: number; totalBuy: number;
  totalPnl: number; totalPnlPct: number; cashUSD: number; isPaper: boolean;
}
interface TradeStatus {
  isPaper: boolean; autoEnabled: boolean;
  todayOrders: number; maxDailyOrders: number; maxOrderUSD: number;
  orders: { time: string; action: string; ticker: string; qty: number; price: number; ordNo: string | null; source: string }[];
}

const pColor = (n: number) => n >= 0 ? 'text-emerald-400' : 'text-red-400';
const fmt2   = (n: number) => n.toFixed(2);

export default function AutoTradePanel() {
  const [balance,     setBalance]     = useState<Balance | null>(null);
  const [tradeStatus, setTradeStatus] = useState<TradeStatus | null>(null);
  const [loadingBal,  setLoadingBal]  = useState(false);
  const [orderTicker, setOrderTicker] = useState('');
  const [orderQty,    setOrderQty]    = useState('');
  const [orderPrice,  setOrderPrice]  = useState('');
  const [orderSide,   setOrderSide]   = useState<'BUY' | 'SELL'>('BUY');
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderResult,  setOrderResult]  = useState<{ success: boolean; message: string } | null>(null);
  const [confirm,     setConfirm]     = useState(false);

  const fetchBalance = useCallback(async () => {
    setLoadingBal(true);
    try {
      const [balRes, statusRes] = await Promise.all([
        fetch('/api/trade/balance'),
        fetch('/api/trade'),
      ]);
      if (balRes.ok)    setBalance(await balRes.json());
      if (statusRes.ok) setTradeStatus(await statusRes.json());
    } finally {
      setLoadingBal(false);
    }
  }, []);

  useEffect(() => { fetchBalance(); }, [fetchBalance]);

  const submitOrder = async () => {
    if (!orderTicker || !orderQty) return;
    setOrderLoading(true); setOrderResult(null);
    try {
      const res = await fetch('/api/trade', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: orderSide,
          ticker: orderTicker.toUpperCase(),
          qty:    Number(orderQty),
          price:  Number(orderPrice || 0),
          source: 'MANUAL',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setOrderResult({ success: true, message: `✓ ${orderSide} 주문 접수 완료 — 주문번호 ${data.ordNo ?? '-'}` });
        setOrderTicker(''); setOrderQty(''); setOrderPrice('');
        setTimeout(fetchBalance, 2000);
      } else {
        setOrderResult({ success: false, message: data.error ?? '주문 실패' });
      }
    } catch (e) {
      setOrderResult({ success: false, message: String(e) });
    } finally {
      setOrderLoading(false); setConfirm(false);
    }
  };

  const isPaper = balance?.isPaper ?? tradeStatus?.isPaper ?? true;

  return (
    <div className="pb-8">

      {/* ── 헤더 ── */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h2 className="text-lg font-bold text-zinc-100">자동매매 연동</h2>
            <span className={`text-[10px] font-bold px-2 py-1 rounded border ${
              isPaper
                ? 'bg-amber-950 text-amber-300 border-amber-700'
                : 'bg-red-950 text-red-300 border-red-700 animate-pulse'
            }`}>
              {isPaper ? '🟡 모의투자' : '🔴 실전투자'}
            </span>
            {tradeStatus?.autoEnabled && (
              <span className="text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-700 px-2 py-1 rounded">
                ⚡ 자동매매 ON
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-500">
            한국투자증권 OpenAPI 연동 · {isPaper ? '실제 체결 없음 (테스트용)' : '실제 계좌 체결 주의'}
          </p>
        </div>
        <button onClick={fetchBalance} disabled={loadingBal}
          className="px-3 py-2 text-xs border border-zinc-700 rounded-lg text-zinc-400 hover:bg-zinc-800 transition-colors shrink-0">
          {loadingBal ? '조회 중…' : '↺ 새로고침'}
        </button>
      </div>

      {/* ── 환경변수 설정 안내 ── */}
      {!balance && !loadingBal && (
        <div className="mb-6 p-4 rounded-xl border border-amber-800 bg-amber-950/20">
          <p className="text-xs text-amber-300 font-semibold mb-2">⚠ 연동 전 Vercel 환경변수 설정 필요</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] font-mono text-zinc-400">
            {[
              ['KIS_APP_KEY',          '한국투자증권 앱키'],
              ['KIS_APP_SECRET',       '한국투자증권 시크릿'],
              ['KIS_ACCOUNT_NO',       '계좌번호 앞 8자리'],
              ['KIS_ACCOUNT_PROD',     '계좌번호 뒤 2자리 (보통 01)'],
              ['KIS_PAPER_TRADING',    'true=모의 / false=실전 (기본: true)'],
              ['AUTO_TRADE_ENABLED',   'true=자동매매 활성화 (기본: false)'],
              ['MAX_ORDER_USD',        '1회 최대 주문금액 (기본: 2000)'],
              ['MAX_DAILY_ORDERS',     '일일 최대 주문횟수 (기본: 5)'],
            ].map(([key, desc]) => (
              <div key={key} className="flex gap-2 items-start">
                <span className="text-emerald-400 shrink-0">{key}</span>
                <span className="text-zinc-600">{desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 안전장치 현황 ── */}
      {tradeStatus && (
        <div className="mb-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">오늘 주문</div>
            <div className={`text-xl font-bold font-mono ${tradeStatus.todayOrders >= tradeStatus.maxDailyOrders ? 'text-red-400' : 'text-zinc-100'}`}>
              {tradeStatus.todayOrders} / {tradeStatus.maxDailyOrders}
            </div>
            <div className="text-[10px] text-zinc-600 mt-1">일일 한도</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">1회 한도</div>
            <div className="text-xl font-bold font-mono text-zinc-100">${tradeStatus.maxOrderUSD.toLocaleString()}</div>
            <div className="text-[10px] text-zinc-600 mt-1">MAX_ORDER_USD</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">자동매매</div>
            <div className={`text-xl font-bold ${tradeStatus.autoEnabled ? 'text-emerald-400' : 'text-zinc-600'}`}>
              {tradeStatus.autoEnabled ? 'ON' : 'OFF'}
            </div>
            <div className="text-[10px] text-zinc-600 mt-1">AUTO_TRADE_ENABLED</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">모드</div>
            <div className={`text-xl font-bold ${isPaper ? 'text-amber-400' : 'text-red-400'}`}>
              {isPaper ? '모의' : '실전'}
            </div>
            <div className="text-[10px] text-zinc-600 mt-1">KIS_PAPER_TRADING</div>
          </div>
        </div>
      )}

      {/* ── 잔고 현황 ── */}
      {balance && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-widest mb-3">계좌 현황</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">평가금액</div>
              <div className="text-lg font-bold font-mono text-zinc-100">${balance.totalEval.toLocaleString()}</div>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">매입금액</div>
              <div className="text-lg font-bold font-mono text-zinc-100">${balance.totalBuy.toLocaleString()}</div>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">평가손익</div>
              <div className={`text-lg font-bold font-mono ${pColor(balance.totalPnl)}`}>
                {balance.totalPnl >= 0 ? '+' : ''}${balance.totalPnl.toLocaleString()}
                <span className="text-sm ml-1">({balance.totalPnlPct >= 0 ? '+' : ''}{fmt2(balance.totalPnlPct)}%)</span>
              </div>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">가용 현금 (USD)</div>
              <div className="text-lg font-bold font-mono text-emerald-400">${balance.cashUSD.toLocaleString()}</div>
            </div>
          </div>

          {/* 보유 종목 */}
          {balance.items.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-zinc-800">
              <table className="w-full text-xs">
                <thead className="bg-zinc-900 border-b border-zinc-800">
                  <tr>
                    {['종목', '수량', '평균단가', '현재가', '평가금액', '손익', '수익률'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] text-zinc-500 uppercase tracking-widest whitespace-nowrap">{h}</th>
                    ))}
                    <th className="px-3 py-2 text-left text-[10px] text-zinc-500 uppercase tracking-widest">액션</th>
                  </tr>
                </thead>
                <tbody>
                  {balance.items.map(item => (
                    <tr key={item.ticker} className="border-b border-zinc-900 hover:bg-zinc-900/40">
                      <td className="px-3 py-2 font-bold text-zinc-100">{item.ticker}</td>
                      <td className="px-3 py-2 text-zinc-300 font-mono">{item.qty}</td>
                      <td className="px-3 py-2 text-zinc-400 font-mono">${fmt2(item.avgPrice)}</td>
                      <td className="px-3 py-2 text-zinc-300 font-mono">${fmt2(item.curPrice)}</td>
                      <td className="px-3 py-2 text-zinc-300 font-mono">${item.evalAmt.toLocaleString()}</td>
                      <td className={`px-3 py-2 font-mono ${pColor(item.pnl)}`}>{item.pnl >= 0 ? '+' : ''}${fmt2(item.pnl)}</td>
                      <td className={`px-3 py-2 font-mono font-bold ${pColor(item.pnlPct)}`}>{item.pnlPct >= 0 ? '+' : ''}{fmt2(item.pnlPct)}%</td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => { setOrderTicker(item.ticker); setOrderQty(String(item.qty)); setOrderSide('SELL'); setOrderPrice('0'); }}
                          className="text-[9px] px-2 py-1 rounded border border-red-800 text-red-400 hover:bg-red-950 transition-colors"
                        >
                          매도
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/30 text-center text-zinc-600 text-sm">
              보유 종목 없음
            </div>
          )}
        </div>
      )}

      {/* ── 수동 주문 ── */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-widest mb-3">수동 주문</h3>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
            <div>
              <label className="block text-[10px] text-zinc-500 uppercase tracking-widest mb-1.5">종목 (티커)</label>
              <input value={orderTicker} onChange={e => setOrderTicker(e.target.value.toUpperCase())}
                placeholder="NVDA"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 font-mono focus:outline-none focus:border-emerald-600"
              />
            </div>
            <div>
              <label className="block text-[10px] text-zinc-500 uppercase tracking-widest mb-1.5">수량</label>
              <input type="number" value={orderQty} onChange={e => setOrderQty(e.target.value)}
                placeholder="1"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 font-mono focus:outline-none focus:border-emerald-600"
              />
            </div>
            <div>
              <label className="block text-[10px] text-zinc-500 uppercase tracking-widest mb-1.5">지정가 (0=시장가)</label>
              <input type="number" value={orderPrice} onChange={e => setOrderPrice(e.target.value)}
                placeholder="0"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 font-mono focus:outline-none focus:border-emerald-600"
              />
            </div>
            <div>
              <label className="block text-[10px] text-zinc-500 uppercase tracking-widest mb-1.5">매수/매도</label>
              <div className="flex gap-2">
                <button onClick={() => setOrderSide('BUY')}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-colors ${orderSide === 'BUY' ? 'bg-emerald-900 border-emerald-600 text-emerald-300' : 'bg-zinc-800 border-zinc-700 text-zinc-500'}`}>
                  매수
                </button>
                <button onClick={() => setOrderSide('SELL')}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-colors ${orderSide === 'SELL' ? 'bg-red-900 border-red-600 text-red-300' : 'bg-zinc-800 border-zinc-700 text-zinc-500'}`}>
                  매도
                </button>
              </div>
            </div>
          </div>

          {/* 주문 확인 단계 */}
          {!confirm ? (
            <button
              onClick={() => { if (orderTicker && orderQty) setConfirm(true); }}
              disabled={!orderTicker || !orderQty}
              className="px-6 py-2.5 bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-100 font-semibold rounded-lg transition-colors text-sm"
            >
              주문 검토 →
            </button>
          ) : (
            <div className={`p-4 rounded-xl border mb-3 ${isPaper ? 'border-amber-800 bg-amber-950/20' : 'border-red-700 bg-red-950/30'}`}>
              <p className={`text-sm font-bold mb-3 ${isPaper ? 'text-amber-300' : 'text-red-300'}`}>
                {isPaper ? '🟡 모의투자 주문 확인' : '🔴 실전 주문 확인 — 실제 체결됩니다!'}
              </p>
              <p className="text-xs text-zinc-300 mb-4">
                <span className={`font-bold ${orderSide === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>{orderSide === 'BUY' ? '매수' : '매도'}</span>
                {' '}{orderTicker} {orderQty}주 @ {Number(orderPrice) > 0 ? `$${orderPrice}` : '시장가'}
              </p>
              <div className="flex gap-2">
                <button onClick={submitOrder} disabled={orderLoading}
                  className={`px-5 py-2 text-sm font-bold rounded-lg transition-colors ${orderSide === 'BUY' ? 'bg-emerald-700 hover:bg-emerald-600 text-white' : 'bg-red-700 hover:bg-red-600 text-white'} disabled:opacity-50`}>
                  {orderLoading ? '주문 중…' : '확인 — 주문 실행'}
                </button>
                <button onClick={() => setConfirm(false)}
                  className="px-5 py-2 text-sm border border-zinc-700 text-zinc-400 rounded-lg hover:bg-zinc-800 transition-colors">
                  취소
                </button>
              </div>
            </div>
          )}

          {orderResult && (
            <div className={`mt-3 p-3 rounded-lg border text-sm ${orderResult.success ? 'border-emerald-800 bg-emerald-950/20 text-emerald-300' : 'border-red-800 bg-red-950/20 text-red-400'}`}>
              {orderResult.message}
            </div>
          )}
        </div>
      </div>

      {/* ── 오늘 주문 내역 ── */}
      {tradeStatus && tradeStatus.orders.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-widest mb-3">
            오늘 주문 내역 ({tradeStatus.orders.length}건)
          </h3>
          <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full text-xs">
              <thead className="bg-zinc-900 border-b border-zinc-800">
                <tr>
                  {['시간', '구분', '종목', '수량', '가격', '주문번호', '출처'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-[10px] text-zinc-500 uppercase tracking-widest whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...tradeStatus.orders].reverse().map((o, i) => (
                  <tr key={i} className="border-b border-zinc-900">
                    <td className="px-3 py-2 text-zinc-500 font-mono">{new Date(o.time).toLocaleTimeString('ko-KR')}</td>
                    <td className={`px-3 py-2 font-bold ${o.action === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>{o.action === 'BUY' ? '매수' : '매도'}</td>
                    <td className="px-3 py-2 font-bold text-zinc-100">{o.ticker}</td>
                    <td className="px-3 py-2 text-zinc-300 font-mono">{o.qty}주</td>
                    <td className="px-3 py-2 text-zinc-400 font-mono">{o.price > 0 ? `$${o.price}` : '시장가'}</td>
                    <td className="px-3 py-2 text-zinc-600 font-mono">{o.ordNo ?? '-'}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded border ${o.source === 'AUTO' ? 'bg-violet-950 text-violet-400 border-violet-800' : 'bg-zinc-900 text-zinc-500 border-zinc-800'}`}>
                        {o.source}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 자동매매 활성화 안내 ── */}
      <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/30 text-[10px] text-zinc-600 leading-relaxed">
        <p className="font-semibold text-zinc-500 mb-2">자동매매 활성화 순서</p>
        <p>1. 먼저 모의투자(KIS_PAPER_TRADING=true)로 충분히 테스트</p>
        <p>2. 백테스트로 전략 승률·손익비 검증 완료 후</p>
        <p>3. KIS_PAPER_TRADING=false + AUTO_TRADE_ENABLED=true 로 전환</p>
        <p>4. MAX_ORDER_USD · MAX_DAILY_ORDERS 한도를 보수적으로 설정</p>
        <p className="mt-2 text-red-700">⚠ 실전 전환 후 첫 1주일은 반드시 소액으로 운용하세요.</p>
      </div>
    </div>
  );
}
