import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(_: Request, { params }: { params:{ id:string } }) {
  const rows = await prisma.assignment.findMany({
    where: { jobId: params.id },
    select: { id:true, status:true }
  });
  return NextResponse.json(rows);
}
