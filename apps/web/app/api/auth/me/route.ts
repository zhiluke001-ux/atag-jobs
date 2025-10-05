import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { cookies } from 'next/headers';

export const runtime   = 'nodejs';
export const dynamic   = 'force-dynamic';
export const revalidate = 0;

export async function GET(){
  const uid = cookies().get('uid')?.value;
  if (!uid) return NextResponse.json({ user:null });
  const user = await prisma.user.findUnique({ where:{ id:String(uid) } });
  if (!user) return NextResponse.json({ user:null });
  return NextResponse.json({ user:{ id:user.id, name:user.name, email:user.email, role:user.role } });
}
