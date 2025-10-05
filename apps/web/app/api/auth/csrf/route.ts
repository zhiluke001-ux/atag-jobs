import { NextResponse } from 'next/server';
import { ensureCsrf } from '@/lib/csrf';

export const runtime   = 'nodejs';
export const dynamic   = 'force-dynamic';
export const revalidate = 0;

export async function GET(){
  const token = ensureCsrf();
  return NextResponse.json({ token });
}
