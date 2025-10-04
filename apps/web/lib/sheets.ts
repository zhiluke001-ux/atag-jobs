// apps/web/lib/sheets.ts
import { google } from 'googleapis';
import prisma from '@/lib/prisma';


const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

function getJwt() {
  const clientEmail = process.env.GS_SA_EMAIL;
  const keyB64 = process.env.GS_SA_KEY_B64;
  if (!clientEmail || !keyB64) {
    throw new Error("Google Sheets env not set (GS_SA_EMAIL / GS_SA_KEY_B64).");
  }
  const privateKey = Buffer.from(keyB64, "base64").toString("utf8");
  return new google.auth.JWT(clientEmail, undefined, privateKey, SCOPES);
}

function sheetsApi() {
  const auth = getJwt();
  return google.sheets({ version: "v4", auth });
}

async function ensureTabs(spreadsheetId: string) {
  const s = sheetsApi();
  const meta = await s.spreadsheets.get({ spreadsheetId });
  const tabs = (meta.data.sheets || []).map((sh) => sh.properties?.title);

  const needed = ["Attendance", "Summary", "Payout"].filter(
    (t) => !tabs.includes(t)
  );
  if (!needed.length) return;

  await s.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: needed.map((title) => ({
        addSheet: { properties: { title } },
      })),
    },
  });

  // Headers for Attendance + Payout
  await s.spreadsheets.values.update({
    spreadsheetId,
    range: "Attendance!A1",
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        "Timestamp", "Action", "Name", "Email", "Role",
        "Job Title", "Venue", "Late/Notes", "PM Device", "Session", "JTI"
      ]]
    }
  });

  await s.spreadsheets.values.update({
    spreadsheetId,
    range: "Payout!A1",
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        "Name","Email","Transport","First IN","Last OUT",
        "Base Hours","OT Hours","Payable Hours",
        "Base Pay","OT Pay","Transport Allow.","Total"
      ]]
    }
  });
}

async function createJobSheet(jobId: string, title: string) {
  const s = sheetsApi();
  const resp = await s.spreadsheets.create({
    requestBody: {
      properties: { title: `ATAG – ${title}` },
      sheets: [
        { properties: { title: "Attendance" } },
        { properties: { title: "Summary" } },
        { properties: { title: "Payout" } },
      ],
    },
  });
  const spreadsheetId = resp.data.spreadsheetId!;
  await ensureTabs(spreadsheetId);
  return spreadsheetId;
}

async function appendAttendanceRow(
  spreadsheetId: string,
  row: (string | number)[]
) {
  const s = sheetsApi();
  await s.spreadsheets.values.append({
    spreadsheetId,
    range: "Attendance!A1",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });
}

async function rewritePayoutTab(
  spreadsheetId: string,
  rows: (string | number)[][]
) {
  const s = sheetsApi();

  // Clear old rows below header
  await s.spreadsheets.values.clear({
    spreadsheetId,
    range: "Payout!A2:Z9999",
  });

  if (rows.length === 0) return;

  await s.spreadsheets.values.update({
    spreadsheetId,
    range: "Payout!A2",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: rows },
  });
}

export default {
  ensureTabs,
  createJobSheet,
  appendAttendanceRow,
  rewritePayoutTab,
};

// also expose named exports for existing imports that do destructuring
export { ensureTabs, createJobSheet, appendAttendanceRow, rewritePayoutTab };
