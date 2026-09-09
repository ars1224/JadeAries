const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RSVP_TOKEN_SECRET = "test-secret-that-is-longer-than-thirty-two-characters";
process.env.ADMIN_PASSWORD = "test-admin-password-that-stays-on-the-server";

const supabase = require("../netlify/functions/lib/supabase");
const { SupabaseRequestError } = supabase;
const { createGuestToken, verifyGuestToken } = require("../netlify/functions/lib/tokens");
const { normalizeName } = require("../netlify/functions/find-guest");
const {
  COOKIE_NAME,
  createAdminSession,
  verifyAdminSession,
} = require("../netlify/functions/lib/adminAuth");

function loadHandler(relativePath, request) {
  supabase.request = request;
  const modulePath = require.resolve(relativePath);
  delete require.cache[modulePath];
  return require(modulePath).handler;
}

function jsonBody(response) {
  return JSON.parse(response.body);
}

function adminHeaders() {
  return { cookie: `${COOKIE_NAME}=${createAdminSession()}` };
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

test("image migration maps all approved Netlify assets", () => {
  const migrationPath = path.join(
    __dirname,
    "..",
    "database",
    "migrations",
    "005_populate_image_urls.sql"
  );
  const sql = fs.readFileSync(migrationPath, "utf8");
  const imagePaths = [...sql.matchAll(/'(\/images\/(?:attire|food)\/[^']+)'/g)]
    .map((match) => match[1]);

  assert.equal(new Set(imagePaths).size, 23);
  imagePaths.forEach((assetPath) => {
    assert.equal(fs.existsSync(path.join(__dirname, "..", assetPath)), true, assetPath);
  });

  assert.match(sql, /\('Groomsman', '\/images\/attire\/groomsmen-suit-reference\.jpg'\)/);
  assert.match(sql, /\('Ring Bearer', '\/images\/attire\/bearers-suit-reference\.jpg'\)/);
  assert.match(sql, /\('Coin Bearer', '\/images\/attire\/bearers-suit-reference\.jpg'\)/);
  assert.match(sql, /\('Bible Bearer', '\/images\/attire\/bearers-suit-reference\.jpg'\)/);
  assert.match(sql, /\('Flower Girl', '\/images\/attire\/flower-girls-dress-reference\.png'\)/);
  assert.match(sql, /\('Officiant', '\/images\/attire\/officiant-attire-reference\.png'\)/);
  assert.doesNotMatch(sql, /DISABLE ROW LEVEL SECURITY/i);
});

test("guest attire correction targets the production Wedding Guest profile", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "database", "migrations", "008_fix_wedding_guest_attire_image.sql"),
    "utf8"
  );
  assert.match(sql, /'wedding guest'/i);
  assert.match(sql, /'wedding guest attire'/i);
  assert.match(sql, /'\/images\/attire\/guest-attire-reference\.jpg'/i);
  assert.doesNotMatch(sql, /DISABLE ROW LEVEL SECURITY/i);
});

test("correct admin password creates an HttpOnly session and incorrect passwords are rejected", async () => {
  const modulePath = require.resolve("../netlify/functions/admin-auth");
  delete require.cache[modulePath];
  const handler = require(modulePath).handler;

  const accepted = await handler({
    httpMethod: "POST",
    headers: {},
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }),
  });
  const rejected = await handler({
    httpMethod: "POST",
    headers: {},
    body: JSON.stringify({ password: "incorrect" }),
  });

  assert.equal(accepted.statusCode, 200);
  assert.match(accepted.headers["Set-Cookie"], /HttpOnly/);
  assert.match(accepted.headers["Set-Cookie"], /SameSite=Strict/);
  assert.doesNotMatch(accepted.body, /test-admin-password|service-role/i);
  const token = accepted.headers["Set-Cookie"].match(new RegExp(`${COOKIE_NAME}=([^;]+)`))[1];
  assert.equal(verifyAdminSession(token), true);
  assert.equal(rejected.statusCode, 401);
  assert.equal(rejected.headers["Set-Cookie"], undefined);
});

test("admin sessions expire and logout clears the session cookie", async () => {
  const modulePath = require.resolve("../netlify/functions/admin-auth");
  delete require.cache[modulePath];
  const handler = require(modulePath).handler;
  const issuedAt = Date.now();
  const token = createAdminSession(issuedAt);

  assert.equal(verifyAdminSession(token, issuedAt + (8 * 60 * 60 * 1_000) - 1), true);
  assert.equal(verifyAdminSession(token, issuedAt + (8 * 60 * 60 * 1_000)), false);

  const logout = await handler({ httpMethod: "DELETE", headers: adminHeaders() });
  assert.equal(logout.statusCode, 200);
  assert.match(logout.headers["Set-Cookie"], new RegExp(`^${COOKIE_NAME}=;`));
  assert.match(logout.headers["Set-Cookie"], /Max-Age=0/);
});

test("Supabase admin dashboard loads all guests and calculates RSVP and catering totals", async () => {
  const guestRows = Array.from({ length: 80 }, (_, index) => {
    const attending = index < 30;
    const notAttending = index >= 30 && index < 50;
    return {
      id: `guest-${index + 1}`,
      full_name: `Guest ${String(index + 1).padStart(2, "0")}`,
      role: index % 2 ? "Guest" : "Bridesmaid",
      rsvp_status: attending ? "attending" : (notAttending ? "not_attending" : "pending"),
      responded_at: attending || notAttending ? "2026-09-09T05:00:00Z" : null,
      dietary_requirements: index === 0 ? "Nut allergy" : "",
      attire_profiles: index === 0 ? {
        display_name: "Guest attire",
        attire_name: "Whimsical Pastel Semi-formal",
        attire_description: "Wear a whimsical pastel shade.",
        image_url: "/images/attire/guest-attire-reference.jpg",
      } : null,
      guest_food_choices: attending ? [{
        main_id: index < 12 ? "main-beef" : "main-salmon",
        dessert_id: "dessert-tiramisu",
        notes: index === 0 ? "Sauce on the side" : "",
      }] : [],
    };
  });
  const menuRows = [
    { id: "main-beef", course: "main", name: "Roasted Beef Fillet – 180g", sort_order: 10 },
    { id: "main-salmon", course: "main", name: "Lemon Baked Salmon – 170g", sort_order: 20 },
    { id: "dessert-tiramisu", course: "dessert", name: "Classic Tiramisu", sort_order: 30 },
  ];
  const handler = loadHandler("../netlify/functions/manageGuests", async (requestPath) => {
    if (requestPath.startsWith("guests?")) {
      assert.doesNotMatch(requestPath, /legacy_id|attire_profile_id/);
      assert.match(requestPath, /attire_profiles/);
      return guestRows;
    }
    if (requestPath.startsWith("food_options?")) {
      return menuRows;
    }
    throw new Error(`Unexpected request: ${requestPath}`);
  });

  const response = await handler({ httpMethod: "GET", headers: adminHeaders() });
  const body = jsonBody(response);

  assert.equal(response.statusCode, 200);
  assert.equal(body.guests.length, 80);
  assert.deepEqual(body.summary, {
    total: 80,
    attending: 30,
    notAttending: 20,
    pending: 30,
    mainSelections: 30,
    dessertSelections: 30,
    mealSelections: 30,
    dietaryRequirements: 1,
    cateringTotal: 2466,
  });
  assert.deepEqual(body.catering.mains.map(({ name, count }) => ({ name, count })), [
    { name: "Roasted Beef Fillet – 180g", count: 12 },
    { name: "Lemon Baked Salmon – 170g", count: 18 },
  ]);
  assert.equal(body.catering.desserts[0].count, 30);
  assert.equal(body.catering.mains[0].unitPrice, 62);
  assert.equal(body.catering.mains[0].subtotal, 744);
  assert.equal(body.menu[0].price, 62);
  assert.equal(body.guests[0].foodNotes, "Sauce on the side");
  assert.deepEqual(body.guests[0].attire, {
    displayName: "Guest attire",
    attireName: "Whimsical Pastel Semi-formal",
    description: "Wear a whimsical pastel shade.",
    imageUrl: "/images/attire/guest-attire-reference.jpg",
  });
  assert.doesNotMatch(response.body, /SUPABASE|service-role|legacy_id|ADMIN_PASSWORD/i);
});

test("admin dashboard rejects requests without a signed session before querying Supabase", async () => {
  let calls = 0;
  const handler = loadHandler("../netlify/functions/manageGuests", async () => {
    calls += 1;
    return [];
  });
  const response = await handler({ httpMethod: "GET", headers: {} });
  assert.equal(response.statusCode, 401);
  assert.equal(calls, 0);
});

test("Supabase catering export uses current food names and accurate selection totals", () => {
  const { buildSupabaseFoodReport } = require("../netlify/functions/exportFoodReport");
  const report = buildSupabaseFoodReport([
    {
      full_name: "Guest One",
      rsvp_status: "attending",
      dietary_requirements: "Gluten free",
      guest_food_choices: [{ main_id: "main-1", dessert_id: "dessert-1" }],
    },
    {
      full_name: "Guest Two",
      rsvp_status: "attending",
      dietary_requirements: "",
      guest_food_choices: [{ main_id: "main-1", dessert_id: "dessert-1" }],
    },
  ], [
    { id: "main-1", course: "main", name: "Roasted Beef Fillet – 180g", dietary_restrictions: "D, DO" },
    { id: "dessert-1", course: "dessert", name: "Classic Tiramisu" },
  ]);

  assert.equal(report.mainCount, 2);
  assert.equal(report.dessertCount, 2);
  assert.equal(report.sections[0].items[0].name, "Roasted Beef Fillet – 180g");
  assert.equal(report.sections[0].items[0].unitPrice, 62);
  assert.equal(report.sections[0].items[0].subtotal, 124);
  assert.deepEqual(report.sections[0].items[0].dietaryCodes, ["D", "DO"]);
  assert.equal(report.sections[1].items[0].name, "Classic Tiramisu");
  assert.equal(report.sections[0].items[0].orders[0].dietaryRequirements, "Gluten free");
});

test("Supabase catering report produces valid PDF and Excel files when dietary codes are strings", async () => {
  const {
    buildSupabaseFoodReport,
    createExcel,
    createPdf,
  } = require("../netlify/functions/exportFoodReport");
  const report = buildSupabaseFoodReport([
    {
      full_name: "Guest One",
      rsvp_status: "attending",
      dietary_requirements: "",
      guest_food_choices: [{ main_id: "main-1", dessert_id: "dessert-1" }],
    },
  ], [
    { id: "main-1", course: "main", name: "Roasted Beef Fillet – 180g", dietary_restrictions: "D, DO" },
    { id: "dessert-1", course: "dessert", name: "Classic Tiramisu", dietary_restrictions: "" },
  ]);

  const [pdf, excel] = await Promise.all([createPdf(report), createExcel(report)]);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.equal(excel.subarray(0, 2).toString(), "PK");
  assert.ok(pdf.length > 1_000);
  assert.ok(excel.length > 1_000);
});

test("authenticated catering export handler returns downloadable PDF and Excel responses", async () => {
  const guestRows = [{
    full_name: "Guest One",
    rsvp_status: "attending",
    dietary_requirements: "",
    guest_food_choices: [{ main_id: "main-1", dessert_id: "dessert-1" }],
  }];
  const optionRows = [
    { id: "main-1", course: "main", name: "Roasted Beef Fillet – 180g", dietary_restrictions: "D, DO" },
    { id: "dessert-1", course: "dessert", name: "Classic Tiramisu", dietary_restrictions: "" },
  ];
  const handler = loadHandler("../netlify/functions/exportFoodReport", async (requestPath) => (
    requestPath.startsWith("guests?") ? guestRows : optionRows
  ));

  for (const [format, contentType, signature] of [
    ["pdf", "application/pdf", "%PDF-"],
    ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "PK"],
  ]) {
    const response = await handler({
      httpMethod: "GET",
      headers: adminHeaders(),
      queryStringParameters: { format },
    });
    const output = Buffer.from(response.body, "base64");
    assert.equal(response.statusCode, 200);
    assert.equal(response.isBase64Encoded, true);
    assert.equal(response.headers["Content-Type"], contentType);
    assert.equal(output.subarray(0, signature.length).toString(), signature);
  }
});

test("admin RSVP updates use the validated atomic RPC and clear food for not attending", async () => {
  let rpcBody;
  const handler = loadHandler("../netlify/functions/manageGuests", async (requestPath, options) => {
    assert.equal(requestPath, "rpc/admin_update_guest");
    rpcBody = options.body;
    return { rsvpStatus: "not_attending" };
  });
  const response = await handler({
    httpMethod: "PUT",
    headers: adminHeaders(),
    body: JSON.stringify({
      id: "guest-7",
      name: "Guest Seven",
      status: "not_attending",
      mainId: "invalid-main",
      dessertId: "invalid-dessert",
      dietaryRequirements: "Should be cleared",
      foodNotes: "Should be cleared",
    }),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(rpcBody.p_status, "not_attending");
  assert.equal(rpcBody.p_full_name, "Guest Seven");
  assert.equal(rpcBody.p_main_id, null);
  assert.equal(rpcBody.p_dessert_id, null);
  assert.equal(rpcBody.p_dietary_requirements, "");
  assert.equal(rpcBody.p_notes, "");
});

test("admin rejects missing selections and database-invalid food IDs", async () => {
  let calls = 0;
  const handler = loadHandler("../netlify/functions/manageGuests", async () => {
    calls += 1;
    throw new SupabaseRequestError(400, "22023");
  });
  const missing = await handler({
    httpMethod: "PUT",
    headers: adminHeaders(),
    body: JSON.stringify({ id: "guest-7", name: "Guest Seven", status: "attending" }),
  });
  const invalid = await handler({
    httpMethod: "PUT",
    headers: adminHeaders(),
    body: JSON.stringify({
      id: "guest-7",
      name: "Guest Seven",
      status: "attending",
      mainId: "not-a-main",
      dessertId: "not-a-dessert",
    }),
  });

  assert.equal(missing.statusCode, 400);
  assert.equal(calls, 1);
  assert.equal(invalid.statusCode, 400);
  assert.match(jsonBody(invalid).error, /active main.*active dessert/i);
});

test("admin rejects invalid names and reports normalized-name conflicts safely", async () => {
  let calls = 0;
  const handler = loadHandler("../netlify/functions/manageGuests", async () => {
    calls += 1;
    throw new SupabaseRequestError(409, "23505");
  });

  const invalid = await handler({
    httpMethod: "PUT",
    headers: adminHeaders(),
    body: JSON.stringify({ id: "guest-7", name: " ", status: "pending" }),
  });
  const duplicate = await handler({
    httpMethod: "PUT",
    headers: adminHeaders(),
    body: JSON.stringify({ id: "guest-7", name: "Existing Guest", status: "pending" }),
  });

  assert.equal(invalid.statusCode, 400);
  assert.equal(calls, 1);
  assert.equal(duplicate.statusCode, 409);
  assert.deepEqual(jsonBody(duplicate), { error: "Another guest already uses that name." });
});

test("admin migration reuses RSVP validation, clears pending food, and preserves RLS", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "database", "migrations", "006_supabase_admin_rsvp.sql"),
    "utf8"
  );
  assert.match(sql, /RETURN public\.submit_guest_rsvp/i);
  assert.match(sql, /p_status <> 'pending'/i);
  assert.match(sql, /DELETE FROM public\.guest_food_choices/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]*anon, authenticated/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION[\s\S]*service_role/i);
  assert.doesNotMatch(sql, /DISABLE ROW LEVEL SECURITY/i);
});

test("admin name migration updates normalized lookup atomically and remains service-role-only", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "database", "migrations", "007_admin_edit_guest_name.sql"),
    "utf8"
  );
  assert.match(sql, /cleaned_normalized_name := LOWER\(cleaned_full_name\)/i);
  assert.match(sql, /normalized_name = cleaned_normalized_name/i);
  assert.match(sql, /RETURN public\.admin_update_guest_rsvp/i);
  assert.match(sql, /ERRCODE = '23505'/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]*anon, authenticated/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION[\s\S]*service_role/i);
  assert.doesNotMatch(sql, /DISABLE ROW LEVEL SECURITY/i);
});

test("admin frontend uses cookie sessions, name search, RSVP and role filters, and mobile layout", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "admin.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "..", "js", "admin.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "css", "admin.css"), "utf8");

  assert.match(html, /id="guest-search"/);
  assert.match(html, /id="status-filter"/);
  assert.match(html, /id="role-filter"/);
  assert.match(html, /class="row-food-notes"/);
  assert.match(html, /<input class="row-name"[^>]*required>/);
  assert.match(html, /id="report-grand-total"/);
  assert.match(html, /class="row-food-total"/);
  assert.match(html, /class="guest-attire span-full"/);
  assert.match(html, /class="row-attire-image"/);
  assert.match(script, /credentials: "same-origin"/);
  assert.match(script, /nzd\.format\(summary\.cateringTotal/);
  assert.match(script, /Unit price:.*item\.unitPrice.*Subtotal:.*item\.subtotal/);
  assert.match(script, /assertDownloadBlob\(blob, format\)/);
  assert.doesNotMatch(script, /adminPassword|Authorization:\s*`Bearer/i);
  assert.match(script, /guest\.name\.toLowerCase\(\)\.includes\(query\)/);
  assert.match(script, /guest\.status === status/);
  assert.match(script, /guest\.role === role/);
  assert.match(script, /p_full_name|name: fullName/);
  assert.match(script, /renderGuestAttire\(row, guest\)/);
  assert.match(script, /Attire image unavailable/);
  assert.match(script, /GUEST_ATTIRE_IMAGE = "\/images\/attire\/guest-attire-reference\.jpg"/);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /\.filter-grid/);
  assert.match(css, /\.guest-attire/);
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
  assert.match(script, /showPhotoFallback/);
  assert.match(script, /image\.onerror = showFallback/);
  assert.match(css, /@media \(max-width: 719px\)/);
  assert.match(css, /Photo unavailable/);
});
