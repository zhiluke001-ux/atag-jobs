import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const jobs = await prisma.job.findMany({
    where: { status: 'PUBLISHED' },
    orderBy: [{ date:'asc' }, { callTimeUtc:'asc' }],
    select: { id:true, title:true, venue:true, jobType:true, callTimeUtc:true, endTimeUtc:true, status:true }
  });
  return NextResponse.json(jobs);
}
