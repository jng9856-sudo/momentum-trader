import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Momentum Trader — 모멘텀 매수/매도 신호',
  description: 'AI 기반 반도체·테크 주식 모멘텀 매매 신호 분석기',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-bg-base text-zinc-100">{children}</body>
    </html>
  );
}
