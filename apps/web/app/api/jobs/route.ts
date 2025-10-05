// apps/web/app/api/jobs/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    // Adjust fields/where to match your schema
    const jobs = await prisma.job.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: { callTimeUtc: 'asc' },
      take: 100,
    });
    return NextResponse.json(jobs, { status: 200 });
  } catch (e) {
    console.error('GET /api/jobs error', e);
    // ⛔️ Don’t swallow DB errors. Return 500 so you can see the real issue.
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
}
