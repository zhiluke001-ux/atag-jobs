// apps/web/lib/sheets.ts
import { google } from "googleapis";

/**
 * Append a single row to the "Attendance" sheet.
 * Expects:
 *   row = [
 *     ISO timestamp, "IN"/"OUT", name, email, role, jobTitle, venue,
 *     notes, pmDeviceId, sessionId, tokenJti
 *   ]
 */
export async function appendAttendanceRow(
  spreadsheetId: string,
  row: (string | number)[]
) {
  const clientEmail = process.env.GS_SA_EMAIL;
  const keyB64 = process.env.GS_SA_KEY_B64;

  if (!clientEmail || !keyB64) {
    // no credentials configured → silently skip (don’t break scans)
    return;
  }

  const privateKey = Buffer.from(keyB64, "base64").toString("utf8");

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  // Ensure the sheet/tab exists; if not, create it once.
  await ensureAttendanceTab(sheets, spreadsheetId);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "Attendance!A1",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });
}

/** Ensure an "Attendance" tab exists. Creates it if missing. */
async function ensureAttendanceTab(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string
) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const hasAttendance = (meta.data.sheets || []).some(
    (s) => s.properties?.title === "Attendance"
  );

  if (!hasAttendance) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: { title: "Attendance" },
            },
          },
        ],
      },
    });

    // add a header row (optional)
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "Attendance!A1:K1",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [
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
          ],
        ],
      },
    });
  }
}

export default { appendAttendanceRow };
