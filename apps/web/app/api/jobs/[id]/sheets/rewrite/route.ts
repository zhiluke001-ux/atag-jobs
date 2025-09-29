import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { computePay } from "../../../../../lib/pay";
import { google } from "googleapis";

export const runtime = "nodejs";

function sheets() {
  const email = process.env.GS_SA_EMAIL;
  const keyB64 = process.env.GS_SA_KEY_B64;
  if (!email || !keyB64) throw new Error("sheets_not_configured");
  const key = Buffer.from(keyB64, "base64").toString("utf8");
  const jwt = new google.auth.JWT(email, undefined, key, ["https://www.googleapis.com/auth/spreadsheets"]);
  return google.sheets({ version: "v4", auth: jwt });
}

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const job = await prisma.job.findUnique({ where: { id: params.id } });
  if (!job?.sheetId) return NextResponse.json({ error: "no_sheet_for_job" }, { status: 400 });

  const { rows } = await computePay(params.id);
  const s = sheets();

  // Payout tab
  const payout = rows.map(r => [
    r.name, r.email, r.transport,
    r.firstInUtc ? new Date(r.firstInUtc).toISOString() : "",
    r.lastOutUtc ? new Date(r.lastOutUtc).toISOString() : "",
    r.baseHours, r.otHours, r.payableHours, r.basePay, r.otPay, r.transportAllowance, r.totalPay
  ]);

  await s.spreadsheets.values.clear({ spreadsheetId: job.sheetId, range: "Payout!A2:Z9999" });
  if (payout.length) {
    await s.spreadsheets.values.update({
      spreadsheetId: job.sheetId,
      range: "Payout!A2",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: payout }
    });
  }

  const headcount = rows.length;
  const unique = rows.filter(r => r.firstInUtc).length;
  const late = await prisma.meritLog.count({ where: { jobId: params.id, kind: "LATE" } });
  const noShow = await prisma.meritLog.count({ where: { jobId: params.id, kind: "NO_SHOW" } });
  const totalHours = Number(rows.reduce((s,v)=>s+v.payableHours,0).toFixed(2));
  const totalWage  = Number(rows.reduce((s,v)=>s+v.totalPay,0).toFixed(2));

  await s.spreadsheets.values.update({
    spreadsheetId: job.sheetId, range: "Summary!A2",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[headcount, unique, late, noShow, totalHours, totalWage]] }
  });

  return NextResponse.json({ ok: true, headcount, unique, late, noShow, totalHours, totalWage });
}
