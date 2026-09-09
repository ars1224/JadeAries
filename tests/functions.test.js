const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RSVP_TOKEN_SECRET = "test-secret-that-is-longer-than-thirty-two-characters";

const supabase = require("../netlify/functions/lib/supabase");
const { SupabaseRequestError } = supabase;
const { createGuestToken, verifyGuestToken } = require("../netlify/functions/lib/tokens");
const { normalizeName } = require("../netlify/functions/find-guest");

function loadHandler(relativePath, request) {
  supabase.request = request;
  const modulePath = require.resolve(relativePath);
  delete require.cache[modulePath];
  return require(modulePath).handler;
}

function jsonBody(response) {
  return JSON.parse(response.body);
}

test("name normalization ignores capitalization and repeated spaces", () => {
  assert.equal(normalizeName("  MaRiA    Del   Santos  "), "maria del santos");
});

test("guest tokens support UUID/string IDs and reject tampering", () => {
  const id = "808e01e3-7be5-4b74-b4a8-5ccdac2d8702";
  const token = createGuestToken(id);
  assert.equal(verifyGuestToken(token).guestId, id);
  assert.throws(() => verifyGuestToken(`${token}x`), /Invalid invitation session/);
});

test("existing guest lookup returns only personalized fields", async () => {
  const handler = loadHandler("../netlify/functions/find-guest", async (requestPath) => {
    assert.match(requestPath, /normalized_name=eq.maria%20del%20santos/);
    assert.match(requestPath, /limit=2/);
    assert.doesNotMatch(requestPath, /legacy_id/);
    return [{
      id: "guest-7",
      full_name: "Maria Del Santos",
      role: "Bridesmaid",
      rsvp_status: "attending",
      dietary_requirements: "Nut allergy",
      attire_profiles: {
        display_name: "Bridesmaid",
        attire_name: "Olive Green",
        attire_description: "Database-provided attire text.",
        primary_color: "#657153",
        secondary_color: "#d9d2bc",
        image_url: "https://example.com/attire.jpg",
      },
      guest_food_choices: [{ main_id: "main-1", dessert_id: "dessert-1", notes: "No nuts" }],
    }];
  });

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ name: "  MARIA   DEL SANTOS " }),
  });
  const body = jsonBody(response);

  assert.equal(response.statusCode, 200);
  assert.equal(body.guest.fullName, "Maria Del Santos");
  assert.equal(body.guest.attire.attireName, "Olive Green");
  assert.equal(body.guest.foodChoice.mainId, "main-1");
  assert.equal(body.guest.legacyId, undefined);
  assert.equal(verifyGuestToken(body.guest.token).guestId, "guest-7");
});

test("unknown guest gets the requested private not-found response", async () => {
  const handler = loadHandler("../netlify/functions/find-guest", async () => []);
  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ name: "Unknown Person" }),
  });

  assert.equal(response.statusCode, 404);
  assert.equal(
    jsonBody(response).error,
    "Sorry, we couldn't find your invitation. Please contact the bride or groom."
  );
});

test("duplicate normalized names are isolated instead of silently selected", async () => {
  const handler = loadHandler("../netlify/functions/find-guest", async () => [{ id: "1" }, { id: "2" }]);
  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ name: "Shared Name" }),
  });

  assert.equal(response.statusCode, 409);
  assert.match(jsonBody(response).error, /more than one invitation/i);
});

test("menu returns active sorted course groups without prices", async () => {
  const handler = loadHandler("../netlify/functions/get-menu", async (requestPath) => {
    assert.match(requestPath, /is_active=eq.true/);
    assert.match(requestPath, /order=sort_order.asc/);
    assert.doesNotMatch(requestPath, /price/);
    return [
      { id: "m1", course: "main", name: "Main", description: "Main description", dietary_restrictions: ["GF"], image_url: null },
      { id: "d1", course: "dessert", name: "Dessert", description: "Dessert description", dietary_restrictions: null, image_url: "/img/dessert.jpg" },
    ];
  });

  const response = await handler({ httpMethod: "GET" });
  const body = jsonBody(response);
  assert.deepEqual(body.mains.map((item) => item.id), ["m1"]);
  assert.deepEqual(body.desserts.map((item) => item.id), ["d1"]);
  assert.equal(body.mains[0].price, undefined);
});

test("attending requires exactly one main and one dessert", async () => {
  const handler = loadHandler("../netlify/functions/submit-rsvp", async () => {
    throw new Error("Database must not be called.");
  });
  const token = createGuestToken("guest-9");

  const missingMain = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ token, status: "attending", dessertId: "dessert-1" }),
  });
  const missingDessert = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ token, status: "attending", mainId: "main-1" }),
  });

  assert.equal(missingMain.statusCode, 400);
  assert.match(jsonBody(missingMain).error, /main/i);
  assert.equal(missingDessert.statusCode, 400);
  assert.match(jsonBody(missingDessert).error, /dessert/i);
});

test("arbitrary RSVP statuses are rejected", async () => {
  const handler = loadHandler("../netlify/functions/submit-rsvp", async () => ({}));
  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ token: createGuestToken("guest-9"), status: "maybe" }),
  });
  assert.equal(response.statusCode, 400);
});

test("invalid or inactive food IDs are rejected server-side", async () => {
  const handler = loadHandler("../netlify/functions/submit-rsvp", async () => {
    throw new SupabaseRequestError(400, "22023");
  });
  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({
      token: createGuestToken("guest-9"),
      status: "attending",
      mainId: "dessert-used-as-main",
      dessertId: "dessert-1",
    }),
  });
  assert.equal(response.statusCode, 400);
  assert.match(jsonBody(response).error, /active main.*active dessert/i);
});

test("not attending requires no food and clears food parameters", async () => {
  let rpcBody;
  const handler = loadHandler("../netlify/functions/submit-rsvp", async (requestPath, options) => {
    assert.equal(requestPath, "rpc/submit_guest_rsvp");
    rpcBody = options.body;
    return { fullName: "Maria Santos", role: "Guest", rsvpStatus: "not_attending", foodChoice: null };
  });
  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ token: createGuestToken("guest-9"), status: "not_attending" }),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(rpcBody.p_status, "not_attending");
  assert.equal(rpcBody.p_main_id, null);
  assert.equal(rpcBody.p_dessert_id, null);
});

test("attending submissions use one atomic RPC with notes", async () => {
  let calls = 0;
  let rpcBody;
  const handler = loadHandler("../netlify/functions/submit-rsvp", async (_requestPath, options) => {
    calls += 1;
    rpcBody = options.body;
    return { fullName: "Maria Santos", role: "Guest", rsvpStatus: "attending" };
  });
  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({
      token: createGuestToken("guest-9"),
      status: "attending",
      mainId: "main-1",
      dessertId: "dessert-1",
      dietaryRequirements: "Nut allergy",
      notes: "Sauce on the side",
    }),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(calls, 1);
  assert.equal(rpcBody.p_guest_id, "guest-9");
  assert.equal(rpcBody.p_notes, "Sauce on the side");
});

test("database errors never leak details or service credentials", async () => {
  const handler = loadHandler("../netlify/functions/submit-rsvp", async () => {
    throw new SupabaseRequestError(500, "XX000");
  });
  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ token: createGuestToken("guest-9"), status: "not_attending" }),
  });
  const body = response.body;

  assert.equal(response.statusCode, 500);
  assert.doesNotMatch(body, /XX000|service-role|SUPABASE/i);
  assert.match(body, /Something went wrong while saving your response/);
});

test("migration validates courses, upserts food, and deletes food for declines", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "database", "migrations", "004_supabase_personalized_rsvp.sql"),
    "utf8"
  );
  assert.match(sql, /course = 'main'[\s\S]*is_active = TRUE/i);
  assert.match(sql, /course = 'dessert'[\s\S]*is_active = TRUE/i);
  assert.match(sql, /ON CONFLICT \(guest_id\) DO UPDATE/i);
  assert.match(sql, /DELETE FROM public\.guest_food_choices/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]*anon, authenticated/i);
  assert.doesNotMatch(sql, /DISABLE ROW LEVEL SECURITY/i);
});

test("frontend keeps full names intact, blocks duplicate submits, and preserves music", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "..", "js", "script.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "css", "style.css"), "utf8");

  assert.match(html, /id="guest-name"/);
  assert.doesNotMatch(html, /id="first-name"|id="last-name"/);
  assert.match(script, /if \(submissionInProgress\)/);
  assert.match(html, /id="wedding-music"[\s\S]*\.mp3/);
  assert.match(script, /weddingMusic\.play\(\)/);
  assert.match(css, /@media \(max-width: 719px\)/);
});
