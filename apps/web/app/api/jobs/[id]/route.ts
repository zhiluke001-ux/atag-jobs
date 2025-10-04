export const runtime   = 'nodejs';
export const dynamic   = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from '@/lib/prisma';

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const job = await prisma.job.findUnique({ where: { id: params.id } });
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(job);
}
