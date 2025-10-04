import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { computePayFromScans } from "@/lib/pay";
import { sheets } from "@/lib/sheets";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    // 1) Load job (with assignments + all scans for this job)
    const job = await prisma.job.findUnique({
      where: { id: params.id },
      include: {
        assignments: { include: { user: true } },
        scans: true,
      },
    });

    if (!job) {
      return NextResponse.json({ error: "job_not_found" }, { status: 404 });
    }
    if (!job.sheetId) {
      return NextResponse.json({ error: "no_sheet_for_job" }, { status: 400 });
    }

    // 2) Build payout rows (one row per approved assignment)
    const payoutHeader = [
      "Name",
      "Email",
      "Transport",
      "First IN",
      "Last OUT",
      "Base Hours",
      "OT Hours",
      "Payable Hours",
      "Base Pay",
      "OT Pay",
      "Transport Allow.",
      "Total Pay",
    ];

    const payoutRows: (string | number)[][] = [];
    let sumBase = 0;
    let sumOT = 0;
    let sumTrans = 0;
    let sumTotal = 0;

    for (const a of job.assignments) {
      // (If you only want APPROVED folks, uncomment below)
      // if (a.status !== "APPROVED") continue;

      const scans = job.scans.filter((s) => s.userId === a.userId);
      const pay = computePayFromScans(job, scans, a.transport);

      // Track totals
      sumBase += pay.money.basePay;
      sumOT += pay.money.otPay;
      sumTrans += pay.money.transportAllowance;
      sumTotal += pay.money.total;

      payoutRows.push([
        a.user.name,
        a.user.email,
        a.transport,
        pay.window.start ?? "",
        pay.window.end ?? "",
        pay.hours.base,
        pay.hours.ot,
        pay.hours.payable,
        pay.money.basePay,
        pay.money.otPay,
        pay.money.transportAllowance,
        pay.money.total,
      ]);
    }

    // 3) Summary tab values
    const headcount = job.assignments.length;
    const uniqueParticipants = new Set(job.assignments.map((a) => a.userId)).size;

    const summaryValues = [
      ["Job Title", job.title],
      ["Venue", job.venue],
      ["Call Time (UTC)", job.callTimeUtc.toISOString()],
      ["End Time (UTC)", job.endTimeUtc ? job.endTimeUtc.toISOString() : ""],
      ["Headcount (assignments)", headcount],
      ["Unique Participants", uniqueParticipants],
      ["Base Pay Total (RM)", round2(sumBase)],
      ["OT Pay Total (RM)", round2(sumOT)],
      ["Transport Allow. Total (RM)", round2(sumTrans)],
      ["Grand Total (RM)", round2(sumTotal)],
    ];

    // 4) Push to Google Sheets
    const s = sheets();

    // Ensure Payout tab has header + rows
    await s.spreadsheets.values.update({
      spreadsheetId: job.sheetId,
      range: "Payout!A1",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [payoutHeader, ...payoutRows] },
    });

    // Write Summary tab
    await s.spreadsheets.values.update({
      spreadsheetId: job.sheetId,
      range: "Summary!A1",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: summaryValues },
    });

    return NextResponse.json({
      ok: true,
      wrote: {
        payoutRows: payoutRows.length,
        summaryLines: summaryValues.length,
      },
    });
  } catch (err) {
    console.error("sheets/rewrite error:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

/* local helper */
function round2(n: number) {
  return Math.round(n * 100) / 100;
}
