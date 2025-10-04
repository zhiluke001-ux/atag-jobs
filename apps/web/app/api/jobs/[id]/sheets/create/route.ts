import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import sheets from "@/lib/sheets";

export const runtime = "nodejs";

// POST /api/jobs/:id/sheets/create
export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const job = await prisma.job.findUnique({ where: { id: params.id } });
  if (!job) return NextResponse.json({ error: "job_not_found" }, { status: 404 });

  // If already has a sheet, just ensure tabs and return
  if (job.sheetId) {
    await sheets.ensureTabs(job.sheetId);
    return NextResponse.json({ ok: true, sheetId: job.sheetId, already: true });
  }

  const sheetId = await sheets.createJobSheet(job.id, job.title);
  await prisma.job.update({ where: { id: job.id }, data: { sheetId } });

  return NextResponse.json({ ok: true, sheetId });
}
