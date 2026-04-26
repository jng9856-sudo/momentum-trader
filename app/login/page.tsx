import { Suspense } from 'react';
import LoginForm from './LoginForm';

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-2xl font-semibold text-zinc-100 tracking-tight mb-1">
            MOMENTUM SIGNAL
          </div>
          <div className="text-xs text-zinc-600">AI 기반 모멘텀 매매 신호 분석기</div>
        </div>
        <Suspense fallback={<div className="text-zinc-600 text-sm text-center">로딩 중...</div>}>
          <LoginForm />
        </Suspense>
        <p className="text-[10px] text-zinc-700 text-center mt-4">
          개인 투자 분석 도구 · 비공개 서비스
        </p>
      </div>
    </div>
  );
}
