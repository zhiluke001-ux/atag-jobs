// apps/web/lib/sheets.ts
import { google } from 'googleapis';
import prisma from '@/lib/prisma';

/**
 * Uses a Google Service Account to append a row to the job's dedicated Sheet.
 * Env required:
 *   GS_SA_EMAIL   = <service-account-email>
 *   GS_SA_KEY_B64 = base64-encoded private key (-----BEGIN PRIVATE KEY----- ... END PRIVATE KEY-----)
 */
async function getSheets() {
  const clientEmail = process.env.GS_SA_EMAIL;
  const keyB64 = process.env.GS_SA_KEY_B64;
  if (!clientEmail || !keyB64) {
    // In prod, we just no-op if Sheets isn't configured
    return null as const;
  }
  const privateKey = Buffer.from(keyB64, 'base64').toString('utf8');
  const auth = new google.auth.JWT(clientEmail, undefined, privateKey, [
    'https://www.googleapis.com/auth/spreadsheets',
  ]);
  return google.sheets({ version: 'v4', auth });
}

/**
 * Append an attendance row to the job's sheet.
 * Will silently return if the job has no sheetId or Sheets env not set.
 *
 * values written: [ISO time, IN/OUT, Name, Email, Job Title, Venue, Late Note, PM Device, Session ID, JTI]
 */
export async function appendAttendanceRow(
  jobId: string,
  userId: string,
  scan: {
    tsUtc: Date | string;
    action: 'IN' | 'OUT';
    pmDeviceId: string;
    sessionId: string;
    tokenJti: string;
  },
  late: boolean,
  lateMins: number
) {
  // fetch job & user
  const [job, user] = await Promise.all([
    prisma.job.findUnique({ where: { id: jobId } }),
    prisma.user.findUnique({ where: { id: userId } }),
  ]);

  // no sheet configured for this job or missing env → skip
  if (!job?.sheetId) return;

  const sheets = await getSheets();
  if (!sheets) return;

  const iso = new Date(scan.tsUtc).toISOString();
  const values = [
    [
      iso,
      scan.action,
      user?.name ?? userId,
      user?.email ?? '',
      job?.title ?? jobId,
      job?.venue ?? '',
      late ? `LATE ${lateMins} min` : '',
      scan.pmDeviceId,
      scan.sessionId,
      scan.tokenJti,
    ],
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: job.sheetId,
    range: 'Attendance!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });
}

/**
 * (Optional) Create a new Google Sheet for a job and store the sheetId on Job.
 * Usage when you add a “Create Job” flow that provisions sheets.
 */
export async function createJobSheet(jobId: string, title: string) {
  const sheets = await getSheets();
  if (!sheets) throw new Error('Google Sheets not configured');

  // Create spreadsheet with useful tabs
  const createResp = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title },
      sheets: [
        { properties: { title: 'Attendance' } },
        { properties: { title: 'Summary' } },
        { properties: { title: 'Payout' } },
      ],
    },
  });

  const sheetId = createResp.data.spreadsheetId!;
  await prisma.job.update({ where: { id: jobId }, data: { sheetId } });
  return sheetId;
}

export default { appendAttendanceRow, createJobSheet };
