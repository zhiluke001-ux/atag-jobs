import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { computePayFromScans } from "@/lib/pay";
import sheets from "@/lib/sheets"; // <-- default import (not `{ sheets }`)

export const runtime = "nodejs";

// POST /api/jobs/:id/sheets/rewrite
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const job = await prisma.job.findUnique({
    where: { id: params.id },
  });

  if (!job) {
    return NextResponse.json({ error: "job_not_found" }, { status: 404 });
  }
  if (!job.sheetId) {
    return NextResponse.json({ error: "no_sheet_for_job" }, { status: 400 });
  }

  // Grab approved assignments (with user)
  const assignments = await prisma.assignment.findMany({
    where: { jobId: job.id, status: "APPROVED" },
    include: { user: true },
  });

  // Build payout rows (Name, Email, Transport, First IN, Last OUT, Base Hrs, OT Hrs, Payable Hrs, Base Pay, OT Pay, Transport Allow., Total)
  const rows: (string | number)[][] = [];
  for (const a of assignments) {
    const scans = await prisma.scan.findMany({
      where: { jobId: job.id, userId: a.userId, result: "success" },
      orderBy: { tsUtc: "asc" },
    });
    const pay = computePayFromScans(job as any, scans as any, a.transport);

    const firstIn = pay.window.start ? new Date(pay.window.start) : null;
    const lastOut = pay.window.end ? new Date(pay.window.end) : null;

    rows.push([
      a.user?.name ?? a.userId,
      a.user?.email ?? "",
      a.transport,
      firstIn ? firstIn.toISOString() : "",
      lastOut ? lastOut.toISOString() : "",
      pay.hours.base,
      pay.hours.ot,
      pay.hours.payable,
      pay.money.basePay,
      pay.money.otPay,
      pay.money.transportAllowance,
      pay.money.total,
    ]);
  }

  // Write only the Payout tab to avoid type coupling with extra helpers.
  const s = sheets();
  await s.ensureTabs(job.sheetId);
  await s.rewritePayoutTab(job.sheetId, rows);

  // (Optional) You can also update Summary here if your lib/sheets provides it:
  // await s.rewriteSummaryTab(job.sheetId, { headcount: rows.length, total: rows.reduce((acc, r) => acc + Number(r[11] || 0), 0) });

  return NextResponse.json({ ok: true, wrote: rows.length });
}
