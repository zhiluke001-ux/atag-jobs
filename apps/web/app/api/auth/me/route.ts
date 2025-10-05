import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import prisma from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const uid = cookies().get('uid')?.value;
  if (!uid) return NextResponse.json({ user:null });
  const user = await prisma.user.findUnique({
    where:{ id: uid },
    select:{ id:true, email:true, name:true, role:true }
  });
  return NextResponse.json({ user });
}
