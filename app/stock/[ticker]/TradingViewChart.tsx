
'use client';
import { useEffect, useRef } from 'react';

declare global {
  interface Window { TradingView: { widget: new (config: object) => void }; }
}

export default function TradingViewChart({ ticker }: { ticker: string }) {
  const id  = `tv_${ticker}`;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    let script: HTMLScriptElement | null = null;

    function initWidget() {
      if (!window.TradingView) return;
      ref.current!.innerHTML = '';
      new window.TradingView.widget({
        autosize:     true,
        symbol:       ticker,
        interval:     'D',
        timezone:     'Asia/Seoul',
        theme:        'dark',
        style:        '1',
        locale:       'kr',
        gridColor:    'rgba(255,255,255,0.04)',
        hide_top_toolbar: false,
        hide_legend:  false,
        allow_symbol_change: true,
        save_image:   false,
        studies:      ['RSI@tv-basicstudies', 'MACD@tv-basicstudies', 'BB@tv-basicstudies'],
        container_id: id,
      });
    }

    if (window.TradingView) {
      initWidget();
    } else {
      script = document.createElement('script');
      script.src = 'https://s3.tradingview.com/tv.js';
      script.async = true;
      script.onload = initWidget;
      document.head.appendChild(script);
    }

    return () => {
      if (script && document.head.contains(script)) document.head.removeChild(script);
    };
  }, [ticker, id]);

  return (
    <div className="w-full rounded-xl overflow-hidden border border-zinc-800" style={{ height: 520 }}>
      <div id={id} ref={ref} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
