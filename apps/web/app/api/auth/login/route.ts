import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ensureCsrf } from '@/lib/csrf';

export const runtime   = 'nodejs';
export const dynamic   = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: Request){
  const { email } = await req.json();
  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error:'invalid_email' }, { status:400 });
  }

  // Simple role mapping for quick testing; adjust as you like.
  let role:'PART_TIMER'|'PM'|'ADMIN' = 'PART_TIMER';
  if (email.toLowerCase().startsWith('pm@')) role = 'PM';
  if (email.toLowerCase().startsWith('admin@')) role = 'ADMIN';

  let user = await prisma.user.findUnique({ where:{ email: email.toLowerCase() } });
  if (!user){
    user = await prisma.user.create({
      data: { email: email.toLowerCase(), name: email.split('@')[0], role }
    });
  }

  // set uid cookie + ensure CSRF cookie exists
  ensureCsrf();
  const res = NextResponse.json({ ok:true, user:{ id:user.id, name:user.name, email:user.email, role:user.role } });
  res.cookies.set('uid', user.id, { httpOnly:true, secure:true, sameSite:'lax', path:'/' });
  return res;
}
