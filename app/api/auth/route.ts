import { NextRequest, NextResponse } from 'next/server';

const PASSWORD    = process.env.SITE_PASSWORD ?? 'momentum2024';
const COOKIE_NAME = 'mt_auth';

export async function POST(req: NextRequest) {
  const { password } = await req.json();

  if (password !== PASSWORD) {
    return NextResponse.json({ error: '비밀번호 오류' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, PASSWORD, {
    httpOnly: true,
    secure:   true,
    sameSite: 'strict',
    maxAge:   60 * 60 * 24 * 30, // 30일
    path:     '/',
  });
  return res;
}

// 로그아웃
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete('mt_auth');
  return res;
}

