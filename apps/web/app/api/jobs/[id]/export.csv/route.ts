import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { computePayFromScans } from "@/lib/pay";

export const runtime = "nodejs";

export async function GET(
  _: Request,
  { params }: { params: { id: string } }
) {
  try {
    // Fetch job with assignments + scans
    const job = await prisma.job.findUnique({
      where: { id: params.id },
      include: {
        assignments: { include: { user: true } },
        scans: true,
      },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

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

    // Loop assignments (each worker)
    for (const assignment of job.assignments) {
      const user = assignment.user;

      // Get this user’s scans
      const scans = job.scans.filter((s) => s.userId === user.id);

      // Compute pay
      const pay = computePayFromScans(job, scans, assignment.transport);

      lines.push(
        [
          user.name,
          user.email,
          assignment.transport,
          pay.window.start ?? "",
          pay.window.end ?? "",
          pay.hours.base,
          pay.hours.ot,
          pay.hours.payable,
          pay.money.basePay,
          pay.money.otPay,
          pay.money.transportAllowance,
          pay.money.total,
        ].join(",")
      );
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
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
