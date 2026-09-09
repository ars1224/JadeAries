const {
  adminSessionCookie,
  clearAdminSessionCookie,
  createAdminSession,
  isAdminAuthorized,
  verifyAdminPassword,
} = require("./lib/adminAuth");
const { json, methodNotAllowed } = require("./lib/http");

exports.handler = async (event) => {
  if (event.httpMethod === "GET") {
    return isAdminAuthorized(event)
      ? json(200, { authenticated: true })
      : json(401, { error: "Your admin session has expired." });
  }

  if (event.httpMethod === "DELETE") {
    return json(200, { authenticated: false }, {
      "Set-Cookie": clearAdminSessionCookie(),
    });
  }

  if (event.httpMethod !== "POST") {
    return methodNotAllowed("GET, POST, DELETE");
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Enter the admin password." });
  }

  if (!verifyAdminPassword(body.password)) {
    return json(401, { error: "Invalid admin password." });
  }

  return json(200, { authenticated: true }, {
    "Set-Cookie": adminSessionCookie(createAdminSession()),
  });
};
