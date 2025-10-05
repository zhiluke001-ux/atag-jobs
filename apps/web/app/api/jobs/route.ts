import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const runtime   = 'nodejs';
export const dynamic   = 'force-dynamic';
export const revalidate = 0;

export async function GET(){
  try{
    const jobs = await prisma.job.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: { callTimeUtc: 'asc' },
      select: {
        id:true, title:true, venue:true, jobType:true,
        callTimeUtc:true, endTimeUtc:true, status:true
      }
    });
    return NextResponse.json(jobs);
  }catch(e:any){
    // Log on server; keep client clean
    console.error('GET /api/jobs error', e);
    return NextResponse.json([], { status:200 }); // empty list instead of 500
  }
}
