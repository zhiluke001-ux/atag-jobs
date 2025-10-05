import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import prisma from '@/lib/prisma';

const DEMO: Record<string,{name:string;role:'PART_TIMER'|'PM'|'ADMIN'}> = {
  'alice@example.com': { name:'Alice', role:'PART_TIMER' },
  'pm@example.com':    { name:'Project Manager', role:'PM' },
  'admin@example.com': { name:'Admin', role:'ADMIN' },
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: Request) {
  const { email } = await req.json();
  if (!email) return NextResponse.json({ error:'email_required' }, { status:400 });

  const demo = DEMO[email.toLowerCase()] ?? { name: email.split('@')[0] || 'User', role: 'PART_TIMER' as const };

  const user = await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    update: { name: demo.name, role: demo.role },
    create: { email: email.toLowerCase(), name: demo.name, role: demo.role },
    select: { id:true, email:true, name:true, role:true }
  });

  cookies().set('uid', user.id, { httpOnly:true, sameSite:'lax', path:'/' });
  return NextResponse.json({ ok:true, user });
}
