// apps/web/app/api/auth/login/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = (body?.email || '').toString().trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: 'email_required' }, { status: 400 });
    }

    // Create or find user
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.create({ data: { email } });
    }

    const res = NextResponse.json({ id: user.id, email: user.email }, { status: 200 });
    // Set session cookie (simple uid cookie). In production you should use a proper signed token.
    res.cookies.set('uid', user.id, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30d
    });
    return res;
  } catch (e) {
    console.error('POST /api/auth/login error', e);
    return NextResponse.json({ error: 'login_failed' }, { status: 500 });
  }
}
