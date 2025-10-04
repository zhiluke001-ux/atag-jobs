// apps/web/lib/sheets.ts
import { google } from "googleapis";

/**
 * Auth – uses service account envs you already configured on Vercel:
 *   GS_SA_EMAIL     = atag-966@atag-jobs.iam.gserviceaccount.com
 *   GS_SA_KEY_B64   = base64 of the service account private key (including header/footer)
 */
function getSheetsClient() {
  const clientEmail = process.env.GS_SA_EMAIL;
  const keyB64 = process.env.GS_SA_KEY_B64;

  if (!clientEmail || !keyB64) {
    throw new Error("Google Sheets service account envs missing (GS_SA_EMAIL / GS_SA_KEY_B64).");
  }

  const privateKey = Buffer.from(keyB64, "base64").toString("utf8");

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

/** ---------- Public API (used by your routes) ---------- */

/** Append one row to Attendance tab.  */
export async function appendAttendanceRow(
  spreadsheetId: string,
  row: (string | number)[]
) {
  try {
    const sheets = getSheetsClient();
    await ensureTabs(spreadsheetId, sheets);
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Attendance!A1",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [row] },
    });
  } catch {
    // Swallow errors so attendance flow never breaks.
  }
}

/** Ensure all tabs exist with headers. Safe to call repeatedly. */
export async function ensureTabs(
  spreadsheetId: string,
  sheets = getSheetsClient()
) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const titles = new Set((meta.data.sheets || []).map(s => s.properties?.title));

  const want = ["Attendance", "Summary", "Payout"];
  const missing = want.filter(t => !titles.has(t));

  if (missing.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: missing.map(title => ({ addSheet: { properties: { title } } })),
      },
    });
  }

  // Ensure headers (idempotent updates)
  await setHeaders(sheets, spreadsheetId, "Attendance!A1:K1", [
    "Timestamp",
    "Action",
    "Name",
    "Email",
    "Role",
    "Job Title",
    "Venue",
    "Notes",
    "PM Device",
    "Session",
    "JTI",
  ]);

  await setHeaders(sheets, spreadsheetId, "Summary!A1:F1", [
    "Headcount",
    "Unique Participants",
    "Late Count",
    "No-Show Count",
    "Total Payable Hours",
    "Total Wages (RM)",
  ]);

  await setHeaders(sheets, spreadsheetId, "Payout!A1:L1", [
    "Name",
    "Email",
    "Transport",
    "First IN",
    "Last OUT",
    "Base Hours",
    "OT Hours",
    "Payable Hours",
    "Base Pay (RM)",
    "OT Pay (RM)",
    "Transport Allow. (RM)",
    "Total Pay (RM)",
  ]);
}

/** Create a new spreadsheet with the 3 tabs, returns sheetId (spreadsheetId). */
export async function createJobSheet(title: string): Promise<string> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title },
      sheets: [
        { properties: { title: "Attendance" } },
        { properties: { title: "Summary" } },
        { properties: { title: "Payout" } },
      ],
    },
  });

  const spreadsheetId = res.data.spreadsheetId!;
  // set headers
  await ensureTabs(spreadsheetId, sheets);
  return spreadsheetId;
}

/** Overwrite the Payout tab (header + rows). */
export async function rewritePayoutTab(
  spreadsheetId: string,
  rows: (string | number)[][]
) {
  const sheets = getSheetsClient();
  await ensureTabs(spreadsheetId, sheets);

  // Clear then write
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: "Payout!A1:Z9999",
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Payout!A1",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          "Name",
          "Email",
          "Transport",
          "First IN",
          "Last OUT",
          "Base Hours",
          "OT Hours",
          "Payable Hours",
          "Base Pay (RM)",
          "OT Pay (RM)",
          "Transport Allow. (RM)",
          "Total Pay (RM)",
        ],
        ...rows,
      ],
    },
  });
}

/** ---------- Internal helpers ---------- */

async function setHeaders(
  sheets: ReturnType<typeof getSheetsClient>,
  spreadsheetId: string,
  range: string,
  headers: string[]
) {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [headers] },
  });
}

const api = { appendAttendanceRow, ensureTabs, createJobSheet, rewritePayoutTab };
export default api;
