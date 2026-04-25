'use client';
import { useState, KeyboardEvent } from 'react';

interface Props {
  watchlist:   string[];
  onAdd:       (ticker: string) => void;
  onRemove:    (ticker: string) => void;
  maxTickers?: number;
}

export default function WatchlistManager({ watchlist, onAdd, onRemove, maxTickers = 1000 }: Props) {
  const [input,    setInput]    = useState('');
  const [open,     setOpen]     = useState(false);
  const [confirm,  setConfirm]  = useState(false);

  function handleAdd() {
    const val = input.trim().toUpperCase().replace(/[^A-Z.]/g, '');
    if (val && !watchlist.includes(val) && watchlist.length < maxTickers) {
      onAdd(val);
      setInput('');
    }
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleAdd();
  }

  function handleDeleteAll() {
    if (!confirm) { setConfirm(true); return; }
    watchlist.forEach(t => onRemove(t));
    setConfirm(false);
  }

  return (
    <div className="mb-6 border border-zinc-800 rounded-xl overflow-hidden">

      {/* Header row — always visible */}
      <div className="flex items-center justify-between px-4 py-3 bg-zinc-900/60">
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-zinc-600 uppercase tracking-widest">
            관심 종목
          </span>
          <span className="text-xs font-mono text-zinc-400">
            {watchlist.length.toLocaleString()} / {maxTickers.toLocaleString()}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {watchlist.length > 0 && (
            <button
              onClick={handleDeleteAll}
              onBlur={() => setConfirm(false)}
              className={`text-xs px-3 py-1 rounded-md border transition-colors
                ${confirm
                  ? 'border-red-700 bg-red-950 text-red-400'
                  : 'border-zinc-700 text-zinc-500 hover:text-red-400 hover:border-red-800'
                }`}
            >
              {confirm ? '정말 삭제?' : '전체 삭제'}
            </button>
          )}
          <button
            onClick={() => setOpen(o => !o)}
            className="flex items-center gap-1.5 text-xs px-3 py-1 border border-zinc-700 text-zinc-400 rounded-md hover:text-zinc-200 hover:border-zinc-500 transition-colors"
          >
            {open ? '접기 ▲' : '펼치기 ▼'}
          </button>
        </div>
      </div>

      {/* Collapsible body */}
      {open && (
        <div className="px-4 pb-4 pt-3 bg-zinc-900/20">
          <div className="flex flex-wrap gap-2 mb-3 max-h-48 overflow-y-auto pr-1">
            {watchlist.map(t => (
              <div key={t} className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 border border-zinc-700 rounded-lg text-sm font-medium text-zinc-200">
                {t}
                <button
                  onClick={() => onRemove(t)}
                  className="text-zinc-600 hover:text-red-400 transition-colors text-xs leading-none ml-0.5"
                >
                  ✕
                </button>
              </div>
            ))}
            {watchlist.length === 0 && (
              <p className="text-xs text-zinc-600 py-2">종목이 없습니다. 아래에서 추가하세요.</p>
            )}
          </div>
          <div className="flex gap-2 items-center pt-2 border-t border-zinc-800">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value.toUpperCase())}
              onKeyDown={handleKey}
              placeholder="티커 입력 (예: NVDA)"
              maxLength={8}
              className="bg-zinc-900 border border-zinc-700 text-zinc-100 text-sm px-3 py-2 rounded-lg w-40 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 font-mono"
            />
            <button
              onClick={handleAdd}
              disabled={watchlist.length >= maxTickers}
              className="text-sm px-4 py-2 bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg hover:bg-zinc-700 hover:text-zinc-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              + 추가
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
