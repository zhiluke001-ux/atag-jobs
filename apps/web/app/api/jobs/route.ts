// apps/web/app/api/jobs/route.ts
export const runtime   = 'nodejs';
export const dynamic   = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET() {
  try {
    const jobs = await prisma.job.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(jobs);
  } catch (e: any) {
    return NextResponse.json({ error: 'db_error', detail: String(e?.message || e) }, { status: 500 });
  }
}
