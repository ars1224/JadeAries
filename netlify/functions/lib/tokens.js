const crypto = require("crypto");

const TOKEN_LIFETIME_MS = 180 * 24 * 60 * 60 * 1_000;

function getSecret() {
  const secret = process.env.RSVP_TOKEN_SECRET;

  console.log("RSVP token diagnostic", {
    configured: Boolean(secret),
    length: secret ? secret.length : 0,
  });

  if (!secret || secret.length < 32) {
    throw new Error(
      "RSVP_TOKEN_SECRET must be configured with at least 32 characters."
    );
  }

  return secret;
}

function sign(payload) {
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

function createGuestToken(guestId) {
  const payload = Buffer.from(JSON.stringify({
    guestId: String(guestId),
    expiresAt: Date.now() + TOKEN_LIFETIME_MS,
  })).toString("base64url");

  return `${payload}.${sign(payload)}`;
}

function verifyGuestToken(token) {
  const [payload, suppliedSignature, ...extra] = String(token || "").split(".");

  if (!payload || !suppliedSignature || extra.length) {
    throw new Error("Invalid invitation session.");
  }

  const expectedSignature = sign(payload);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);

  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    throw new Error("Invalid invitation session.");
  }

  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid invitation session.");
  }

  if (typeof data.guestId !== "string" || !data.guestId || data.guestId.length > 128 || data.expiresAt < Date.now()) {
    throw new Error("Invitation session has expired.");
  }

  return data;
}

module.exports = { createGuestToken, verifyGuestToken };
