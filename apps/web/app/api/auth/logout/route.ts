import { NextResponse } from 'next/server';
import { verifyCsrf } from '@/lib/csrf';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: Request) {
  const csrf = req.headers.get('x-csrf-token');
  if (!verifyCsrf(csrf)) return NextResponse.json({ error:'csrf_invalid' }, { status:403 });
  cookies().delete('uid');
  return NextResponse.json({ ok:true });
}
