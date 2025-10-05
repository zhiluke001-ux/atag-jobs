import { NextResponse } from 'next/server';
import { verifyCsrf } from '@/lib/csrf';
import { headers } from 'next/headers';

export const runtime   = 'nodejs';
export const dynamic   = 'force-dynamic';
export const revalidate = 0;

export async function POST(){
  const h = headers();
  const ok = verifyCsrf(h.get('x-csrf-token'));
  if (!ok) return NextResponse.json({ error:'bad_csrf' }, { status:403 });

  const res = NextResponse.json({ ok:true });
  res.cookies.set('uid','', { path:'/', maxAge:0 });
  return res;
}
