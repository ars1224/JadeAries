const crypto = require("crypto");

function isAdminAuthorized(event) {
  const configuredPassword = process.env.ADMIN_PASSWORD || "";
  const authorization = event.headers?.authorization || event.headers?.Authorization || "";
  const suppliedPassword = authorization.replace(/^Bearer\s+/i, "");

  if (!configuredPassword || !suppliedPassword) {
    return false;
  }

  const configured = Buffer.from(configuredPassword);
  const supplied = Buffer.from(suppliedPassword);
  return configured.length === supplied.length && crypto.timingSafeEqual(configured, supplied);
}

module.exports = { isAdminAuthorized };
