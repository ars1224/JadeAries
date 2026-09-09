const crypto = require("crypto");

const COOKIE_NAME = "wedding_admin_session";
const SESSION_LIFETIME_SECONDS = 8 * 60 * 60;

function configuredPassword() {
  const password = String(process.env.ADMIN_PASSWORD || "");
  if (!password) {
    throw new Error("ADMIN_PASSWORD is not configured.");
  }
  return password;
}

function safeEqual(left, right) {
  const leftDigest = crypto.createHash("sha256").update(String(left || "")).digest();
  const rightDigest = crypto.createHash("sha256").update(String(right || "")).digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

function verifyAdminPassword(password) {
  try {
    return safeEqual(configuredPassword(), password);
  } catch {
    return false;
  }
}

function signingKey() {
  return crypto
    .createHash("sha256")
    .update("aries-jade-admin-session\0")
    .update(configuredPassword())
    .digest();
}

function signature(payload) {
  return crypto.createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

function createAdminSession(now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({
    expiresAt: now + SESSION_LIFETIME_SECONDS * 1_000,
    nonce: crypto.randomBytes(16).toString("base64url"),
  })).toString("base64url");

  return `${payload}.${signature(payload)}`;
}

function parseCookies(event) {
  const header = event.headers?.cookie || event.headers?.Cookie || "";
  return Object.fromEntries(
    header.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
      const separator = part.indexOf("=");
      if (separator < 0) {
        return [part, ""];
      }
      return [part.slice(0, separator), part.slice(separator + 1)];
    })
  );
}

function verifyAdminSession(token, now = Date.now()) {
  try {
    const [payload, suppliedSignature, ...extra] = String(token || "").split(".");
    if (!payload || !suppliedSignature || extra.length || !safeEqual(signature(payload), suppliedSignature)) {
      return false;
    }

    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number.isFinite(session.expiresAt)
      && session.expiresAt > now
      && typeof session.nonce === "string"
      && session.nonce.length > 0;
  } catch {
    return false;
  }
}

function isAdminAuthorized(event, now = Date.now()) {
  return verifyAdminSession(parseCookies(event)[COOKIE_NAME], now);
}

function adminSessionCookie(token) {
  return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_LIFETIME_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

function clearAdminSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

module.exports = {
  COOKIE_NAME,
  adminSessionCookie,
  clearAdminSessionCookie,
  createAdminSession,
  isAdminAuthorized,
  verifyAdminPassword,
  verifyAdminSession,
};
