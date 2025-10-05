import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import prisma from '@/lib/prisma';

const DEMO: Record<string, { name: string; role: 'PART_TIMER' | 'PM' | 'ADMIN' }> = {
  'alice@example.com': { name: 'Alice',            role: 'PART_TIMER' },
  'pm@example.com':    { name: 'Project Manager',  role: 'PM' },
  'admin@example.com': { name: 'Admin',            role: 'ADMIN' },
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const emailRaw = (body?.email ?? '') as string;
    const email = emailRaw.toLowerCase().trim();

    if (!email) {
      return NextResponse.json({ error: 'email_required' }, { status: 400 });
    }

    const demo = DEMO[email] ?? {
      name: email.split('@')[0] || 'User',
      role: 'PART_TIMER' as const,
    };

    const user = await prisma.user.upsert({
      where: { email },
      update: { name: demo.name, role: demo.role },
      create: { email, name: demo.name, role: demo.role },
      select: { id: true, email: true, name: true, role: true },
    });

    // HttpOnly cookie for session
    cookies().set('uid', user.id, { httpOnly: true, sameSite: 'lax', path: '/' });

    return NextResponse.json({ ok: true, user });
  } catch (err) {
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
