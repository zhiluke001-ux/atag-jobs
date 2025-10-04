import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { computePay } from "@/lib/pay";

export const runtime = "nodejs";

export async function GET(
  _: Request,
  { params }: { params: { id: string } }
) {
  try {
    // Fetch job with assignments + user info + scans separately
    const job = await prisma.job.findUnique({
      where: { id: params.id },
      include: {
        assignments: {
          include: { user: true }, // ✅ user info inside assignment
        },
        scans: true, // ✅ all scan records for the job
      },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Compute pay rows
    const { rows } = await computePay(params.id);

    // CSV header
    const header = [
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
    const lines = [header.join(",")];

    // Build CSV from rows
    for (const r of rows) {
      lines.push([
        r.user.name,
        r.user.email,
        r.transport,
        r.firstIn ?? "",
        r.lastOut ?? "",
        r.hours.base,
        r.hours.ot,
        r.hours.payable,
        r.money.base,
        r.money.ot,
        r.money.transport,
        r.money.total,
      ].join(","));
    }

    // Return CSV response
    return new NextResponse(lines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="job-${params.id}-export.csv"`,
      },
    });
  } catch (err) {
    console.error("Export CSV error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
