'use client';

import { useState, KeyboardEvent } from 'react';

interface Props {
  watchlist: string[];
  onAdd:    (ticker: string) => void;
  onRemove: (ticker: string) => void;
}

export default function WatchlistManager({ watchlist, onAdd, onRemove }: Props) {
  const [input, setInput] = useState('');

  function handleAdd() {
    const val = input.trim().toUpperCase().replace(/[^A-Z]/g, '');
    if (val && !watchlist.includes(val) && watchlist.length < 12) {
      onAdd(val);
      setInput('');
    }
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleAdd();
  }

  return (
    <div className="mb-6">
      <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-3">관심 종목 ({watchlist.length}/12)</div>
      <div className="flex flex-wrap gap-2 mb-3">
        {watchlist.map(t => (
          <div
            key={t}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 border border-zinc-700 rounded-lg text-sm font-medium text-zinc-200"
          >
            {t}
            <button
              onClick={() => onRemove(t)}
              className="text-zinc-600 hover:text-red-400 transition-colors text-xs leading-none ml-0.5"
              aria-label={`Remove ${t}`}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2 items-center">
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
          disabled={watchlist.length >= 12}
          className="text-sm px-4 py-2 bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg hover:bg-zinc-700 hover:text-zinc-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          + 추가
        </button>
      </div>
    </div>
  );
}
