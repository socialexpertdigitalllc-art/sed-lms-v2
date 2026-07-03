import { google } from "googleapis";

// Read a sheet tab's rows via the reused service account. Row 0 = headers.
export async function readSheet(sheetId: string, tab: string): Promise<string[][]> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Sheets import not configured (missing GOOGLE_SERVICE_ACCOUNT_JSON).");
  const creds = JSON.parse(raw) as { client_email: string; private_key: string };

  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${tab}`,
    valueRenderOption: "FORMATTED_VALUE",
  });
  return (res.data.values ?? []).map((r) => r.map((c) => (c == null ? "" : String(c))));
}
