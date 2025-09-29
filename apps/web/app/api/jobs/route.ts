import { NextResponse } from "next/server";
import { prisma } from "../../lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const jobs = await prisma.job.findMany({ where: { status: "PUBLISHED" }, orderBy: { createdAt: "desc" } });
  return NextResponse.json(jobs);
}
