// app/api/jobs/[id]/export.csv/route.ts
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { computePayPreview } from "@/lib/pay";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const job = await prisma.job.findUnique({
    where: { id: params.id },
    include: {
      assignments: { include: { user: true, scans: true } },
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

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

  for (const assignment of job.assignments) {
    const pay = computePayPreview(job, assignment, assignment.scans);

    const firstIn = assignment.scans.find(
      (s) => s.action === "IN" && s.result === "success"
    )?.tsUtc;
    const lastOut = assignment.scans
      .filter((s) => s.action === "OUT" && s.result === "success")
      .sort((a, b) => +a.tsUtc - +b.tsUtc)
      .at(-1)?.tsUtc;

    const row = [
      assignment.user.name,
      assignment.user.email,
      assignment.transport,
      firstIn ? new Date(firstIn).toISOString() : "",
      lastOut ? new Date(lastOut).toISOString() : "",
      pay.hours.base,
      pay.hours.ot,
      pay.hours.payable,
      pay.money.basePay,
      pay.money.otPay,
      pay.money.transportAllowance,
      pay.money.total,
    ];
    lines.push(row.join(","));
  }

  return new NextResponse(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="job-${job.id}-pay.csv"`,
    },
  });
}
