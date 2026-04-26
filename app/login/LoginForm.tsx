'use client';

import { useState, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function LoginForm() {
  const router   = useRouter();
  const params   = useSearchParams();
  const redirect = params.get('redirect') ?? '/';
  const [pw,      setPw]      = useState('');
  const [err,     setErr]     = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true); setErr('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) {
        router.push(redirect);
        router.refresh();
      } else {
        setErr('비밀번호가 올바르지 않습니다.');
        setPw('');
      }
    } catch {
      setErr('오류가 발생했습니다. 다시 시도해주세요.');
    }
    setLoading(false);
  }

  return (
    <div className="bg-bg-card border border-zinc-800 rounded-2xl p-6">
      <div className="text-sm font-medium text-zinc-300 mb-4 text-center">
        접근하려면 비밀번호를 입력하세요
      </div>
      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <input
            type="password"
            value={pw}
            onChange={e => setPw(e.target.value)}
            placeholder="비밀번호"
            autoFocus
            required
            className="w-full bg-zinc-900 border border-zinc-700 text-zinc-100 text-sm px-4 py-3 rounded-xl placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 font-mono tracking-widest"
          />
        </div>
        {err && (
          <div className="mb-4 p-3 bg-red-950 border border-red-800 rounded-lg text-xs text-red-300 text-center">
            {err}
          </div>
        )}
        <button
          type="submit"
          disabled={loading || !pw}
          className={`w-full py-3 text-sm font-semibold rounded-xl border transition-all
            ${loading || !pw
              ? 'bg-zinc-900 border-zinc-700 text-zinc-500 cursor-not-allowed'
              : 'bg-emerald-500 border-emerald-400 text-black hover:bg-emerald-400 active:scale-95'}`}
        >
          {loading ? '확인 중...' : '입장하기 →'}
        </button>
      </form>
    </div>
  );
}

