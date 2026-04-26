import { NextRequest, NextResponse } from 'next/server';

const PASSWORD = process.env.SITE_PASSWORD ?? 'momentum2024';
const COOKIE_NAME = 'mt_auth';

export function middleware(req: NextRequest) {
  // API 경로는 패스
  if (req.nextUrl.pathname.startsWith('/api/')) return NextResponse.next();

  // 로그인 페이지는 패스
  if (req.nextUrl.pathname === '/login') return NextResponse.next();

  // 쿠키 확인
  const auth = req.cookies.get(COOKIE_NAME);
  if (auth?.value === PASSWORD) return NextResponse.next();

  // 미인증 → 로그인 페이지로
  const loginUrl = new URL('/login', req.url);
  loginUrl.searchParams.set('redirect', req.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

