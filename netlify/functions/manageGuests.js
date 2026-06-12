const { google } = require("googleapis");
const crypto = require("crypto");

const SHEET_NAME = "Sheet1";

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function isAuthorized(event) {
  const configuredPassword = process.env.ADMIN_PASSWORD || "";
  const suppliedPassword = (event.headers.authorization || "").replace(/^Bearer\s+/i, "");

  if (!configuredPassword || !suppliedPassword) {
    return false;
  }

  const configured = Buffer.from(configuredPassword);
  const supplied = Buffer.from(suppliedPassword);

  return configured.length === supplied.length && crypto.timingSafeEqual(configured, supplied);
}

function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeName(value) {
  return String(value || "").trim();
}

function generateInvitationCode(existingCodes) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  for (let attempt = 0; attempt < 50; attempt++) {
    const randomBytes = crypto.randomBytes(6);
    const suffix = Array.from(
      randomBytes,
      (byte) => alphabet[byte % alphabet.length]
    ).join("");
    const code = `INV${suffix}`;

    if (!existingCodes.has(code)) {
      return code;
    }
  }

  throw new Error("Could not generate a unique invitation code.");
}

async function getSheetRows(sheets) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${SHEET_NAME}!A:C`,
  });

  return response.data.values || [];
}

async function getSheetId(sheets) {
  const response = await sheets.spreadsheets.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    fields: "sheets.properties",
  });

  const sheet = response.data.sheets.find(
    (item) => item.properties.title === SHEET_NAME
  );

  if (!sheet) {
    throw new Error(`Sheet "${SHEET_NAME}" was not found.`);
  }

  return sheet.properties.sheetId;
}

exports.handler = async (event) => {
  if (!isAuthorized(event)) {
    return json(401, { error: "Invalid admin password." });
  }

  try {
    const sheets = getSheetsClient();

    if (event.httpMethod === "GET") {
      const rows = await getSheetRows(sheets);
      const guests = rows.slice(1).map((row, index) => ({
        row: index + 2,
        code: normalizeCode(row[0]),
        name: normalizeName(row[1]),
        status: normalizeName(row[2]) || "Pending",
      })).filter((guest) => guest.code || guest.name);

      return json(200, { guests });
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const names = Array.isArray(body.names)
        ? body.names.map(normalizeName).filter(Boolean)
        : [];

      if (names.length === 0) {
        return json(400, { error: "At least one guest name is required." });
      }

      const rows = await getSheetRows(sheets);
      const existingCodes = new Set(
        rows.slice(1).map((row) => normalizeCode(row[0])).filter(Boolean)
      );
      const code = generateInvitationCode(existingCodes);

      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: `${SHEET_NAME}!A:C`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: {
          values: names.map((name) => [code, name, "Pending"]),
        },
      });

      return json(201, { success: true, code });
    }

    if (event.httpMethod === "PUT") {
      const body = JSON.parse(event.body || "{}");
      const row = Number(body.row);
      const code = normalizeCode(body.code);
      const name = normalizeName(body.name);
      const status = normalizeName(body.status) || "Pending";

      if (!Number.isInteger(row) || row < 2 || !code || !name) {
        return json(400, { error: "Valid row, code, and guest name are required." });
      }

      await sheets.spreadsheets.values.update({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: `${SHEET_NAME}!A${row}:C${row}`,
        valueInputOption: "RAW",
        requestBody: {
          values: [[code, name, status]],
        },
      });

      return json(200, { success: true });
    }

    if (event.httpMethod === "DELETE") {
      const body = JSON.parse(event.body || "{}");
      const row = Number(body.row);

      if (!Number.isInteger(row) || row < 2) {
        return json(400, { error: "A valid guest row is required." });
      }

      const sheetId = await getSheetId(sheets);

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        requestBody: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId,
                dimension: "ROWS",
                startIndex: row - 1,
                endIndex: row,
              },
            },
          }],
        },
      });

      return json(200, { success: true });
    }

    return json(405, { error: "Method not allowed." });
  } catch (error) {
    return json(500, { error: error.message });
  }
};
