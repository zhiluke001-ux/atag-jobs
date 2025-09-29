import { NextResponse } from "next/server";
import { computePay } from "../../../../../lib/pay";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const { job, rows } = await computePay(params.id);
  const header = ['Name','Email','Transport','First IN','Last OUT','Base Hours','OT Hours','Payable Hours','Base Pay','OT Pay','Transport Allow.','Total Pay'];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([
      `"${r.name}"`,`"${r.email}"`,r.transport,
      r.firstInUtc ? new Date(r.firstInUtc).toISOString() : "",
      r.lastOutUtc ? new Date(r.lastOutUtc).toISOString() : "",
      r.baseHours, r.otHours, r.payableHours, r.basePay, r.otPay, r.transportAllowance, r.totalPay
    ].join(","));
  }
  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="payout_${job?.title || params.id}.csv"`
    }
  });
}
