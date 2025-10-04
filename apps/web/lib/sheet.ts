// apps/web/lib/sheet.ts
import { google } from 'googleapis';

/**
 * Google Sheets client (service account)
 */
function getSheets() {
  const email = process.env.GS_SA_EMAIL;
  const key = (process.env.GS_SA_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!email || !key) {
    throw new Error('Missing GS_SA_EMAIL or GS_SA_PRIVATE_KEY env');
  }

  const auth = new google.auth.JWT(
    email,
    undefined,
    key,
    ['https://www.googleapis.com/auth/spreadsheets']
  );

  return google.sheets({ version: 'v4', auth });
}

const TAB_ATT = 'Attendance Log';
const TAB_SUM = 'Summary';
const TAB_PAY = 'Payout';

async function listSheetTitles(spreadsheetId: string) {
  const sheets = getSheets();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  return (meta.data.sheets || []).map(s => s.properties?.title || '');
}

async function addSheetIfMissing(spreadsheetId: string, title: string) {
  const sheets = getSheets();
  const existing = await listSheetTitles(spreadsheetId);
  if (existing.includes(title)) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        { addSheet: { properties: { title } } }
      ]
    }
  });
}

/**
 * Ensure core tabs exist + write headers if empty.
 */
export async function ensureTabs(spreadsheetId: string) {
  const sheets = getSheets();

  // Ensure the three tabs exist
  await addSheetIfMissing(spreadsheetId, TAB_ATT);
  await addSheetIfMissing(spreadsheetId, TAB_SUM);
  await addSheetIfMissing(spreadsheetId, TAB_PAY);

  // Write headers if first row is empty
  const headers: Record<string, string[]> = {
    [TAB_ATT]: [
      'Timestamp (UTC)','User Name','User Email','Role','Action',
      'Transport','PM Device','Session','TokenJTI','Result','Notes'
    ],
    [TAB_SUM]: [
      'Metric','Value'
    ],
    [TAB_PAY]: [
      'Name','Email','Transport','First IN','Last OUT',
      'Base Hours','OT Hours','Payable Hours',
      'Base Pay','OT Pay','Transport Allow.','Total Pay'
    ]
  };

  for (const [tab, hdr] of Object.entries(headers)) {
    const read = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tab}!A1:A1`
    });
    const hasHeader = Array.isArray(read.data.values) && read.data.values.length > 0;
    if (!hasHeader) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tab}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [hdr] }
      });
    }
  }
}

/**
 * Create a new spreadsheet and prepare tabs/headers.
 * Returns the spreadsheetId.
 */
export async function createJobSheet(title: string): Promise<string> {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title }
    }
  });
  const spreadsheetId = res.data.spreadsheetId!;
  await ensureTabs(spreadsheetId);
  return spreadsheetId;
}

/**
 * Append one attendance row to Attendance Log.
 * Pass spreadsheetId and a single row array of strings/numbers.
 */
export async function appendAttendanceRow(
  spreadsheetId: string,
  row: (string | number)[]
) {
  const sheets = getSheets();
  await ensureTabs(spreadsheetId);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${TAB_ATT}!A1:Z1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] }
  });
}

/**
 * Rewrite the entire Payout tab with provided rows (keeps header).
 * rows should NOT include the header — we preserve it.
 */
export async function rewritePayoutTab(
  spreadsheetId: string,
  rows: (string | number)[][]
) {
  const sheets = getSheets();
  await ensureTabs(spreadsheetId);

  // Clear below header
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${TAB_PAY}!A2:Z10000`
  });

  if (rows.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${TAB_PAY}!A2`,
      valueInputOption: 'RAW',
      requestBody: { values: rows }
    });
  }
}

export default {
  getSheets,
  ensureTabs,
  createJobSheet,
  appendAttendanceRow,
  rewritePayoutTab
};
