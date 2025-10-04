// apps/web/app/api/jobs/[id]/sheets/create/route.ts
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import sheets from "@/lib/sheets";

export const runtime = "nodejs";

// Creates a new Google Sheet for the job (Attendance/Summary/Payout)
// and stores spreadsheetId as job.sheetId.
// If the job already has a sheet, we just ensure tabs and return it.
export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const job = await prisma.job.findUnique({ where: { id: params.id } });
  if (!job) {
    return NextResponse.json({ error: "job_not_found" }, { status: 404 });
  }

  // If already has a sheet, ensure tabs and return
  if (job.sheetId) {
    await sheets.ensureTabs(job.sheetId);
    return NextResponse.json({
      ok: true,
      sheetId: job.sheetId,
      already: true,
    });
  }

  // Create a new sheet
  const dateStr = new Date(job.date).toISOString().slice(0, 10);
  const title = `ATAG - ${job.title} (${dateStr})`;

  const spreadsheetId = await sheets.createJobSheet(title);

  // Persist sheetId on Job
  await prisma.job.update({
    where: { id: job.id },
    data: { sheetId: spreadsheetId },
  });

  return NextResponse.json({
    ok: true,
    sheetId: spreadsheetId,
    already: false,
  });
}
