// apps/web/app/api/auth/me/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';

export async function GET() {
  try {
    const uid = cookies().get('uid')?.value;
    if (!uid) return NextResponse.json(null, { status: 200 });

    const user = await prisma.user.findUnique({
      where: { id: uid },
      select: { id: true, email: true },
    });

    return NextResponse.json(user ?? null, { status: 200 });
  } catch (e) {
    console.error('GET /api/auth/me error', e);
    return NextResponse.json(null, { status: 200 });
  }
}
