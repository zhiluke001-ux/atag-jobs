import { google } from "googleapis";
import { prisma } from "./prisma";

const GS_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

function getSheetsClient() {
  const clientEmail = process.env.GS_SA_EMAIL;
  const privateKeyB64 = process.env.GS_SA_KEY_B64;
  if (!clientEmail || !privateKeyB64) throw new Error("sheets_not_configured");
  const key = Buffer.from(privateKeyB64, "base64").toString("utf8");
  const jwt = new google.auth.JWT(clientEmail, undefined, key, GS_SCOPES);
  return google.sheets({ version: "v4", auth: jwt });
}

export async function createJobSheet(job: any) {
  const sheets = getSheetsClient();
  const title = `ATAG – ${job.title} (${new Date(job.callTimeUtc).toISOString().slice(0,10)})`;
  const resp = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title },
      sheets: [
        { properties: { title: "Attendance" },
          data: [{ rowData: [{ values: ['Timestamp','Name','Email','Role','Action','Transport','Notes','PM Device','Session','JTI'].map(v => ({ userEnteredValue:{ stringValue:String(v) }})) }]}] },
        { properties: { title: "Summary" },
          data: [{ rowData: [{ values: ['Headcount','Unique','Late','No-show','Total Payable Hours','Total Wage'].map(v => ({ userEnteredValue:{ stringValue:String(v) }})) }]}] },
        { properties: { title: "Payout" },
          data: [{ rowData: [{ values: ['Name','Email','Transport','First IN','Last OUT','Base Hours','OT Hours','Payable Hours','Base Pay','OT Pay','Transport Allow.','Total Pay'].map(v => ({ userEnteredValue:{ stringValue:String(v) }})) }]}] }
      ]
    }
  });
  return resp.data.spreadsheetId!;
}

export async function appendAttendanceRow(jobId: string, userId: string, scan: any, late: boolean, lateMins: number) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job?.sheetId) return;

  const sheets = getSheetsClient();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const asn = await prisma.assignment.findFirst({ where: { jobId, userId } });

  const values = [[
    new Date(scan.tsUtc).toISOString(),
    user?.name || userId,
    user?.email || "",
    asn?.roleName || "",
    scan.action,
    asn?.transport || "",
    late ? `LATE ${lateMins} min` : "",
    scan.pmDeviceId,
    scan.sessionId,
    scan.tokenJti
  ]]];

  await sheets.spreadsheets.values.append({
    spreadsheetId: job.sheetId,
    range: "Attendance!A1",
    valueInputOption: "USER_ENTERED",
    requestBody: { values }
  });
}
