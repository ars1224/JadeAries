const { google } = require("googleapis");

const SHEET_NAME = "Sheet1";

function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

exports.handler = async (event) => {
  try {
    const code = (event.queryStringParameters.code || "").trim().toUpperCase();

    if (!code) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "RSVP code is required." }),
      };
    }

    const sheets = getSheetsClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A:C`,
    });

    const rows = response.data.values || [];
    const guests = rows
      .slice(1)
      .filter((row) => String(row[0] || "").trim().toUpperCase() === code)
      .map((row) => ({
        name: row[1],
        status: row[2] || "Pending",
      }));

    if (guests.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "Invitation code not found." }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ code, guests }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};