const crypto = require("crypto");
const { isAdminAuthorized } = require("./lib/adminAuth");
const { query } = require("./lib/database");
const { json, methodNotAllowed } = require("./lib/http");
const { DESSERT_CHOICES, MAIN_CHOICES, MENU_ITEMS, ensureMenuItems, toSqlTextArray, withMenuRetry } = require("./lib/menu");

const STATUSES = new Set(["pending", "attending", "declined"]);
const DEFAULT_PALETTE = ["#c7a6ed", "#ffc28e", "#ffe688", "#a9cfea"];

function text(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizePalette(value) {
  if (!Array.isArray(value)) {
    return DEFAULT_PALETTE;
  }

  const colours = value
    .map(text)
    .filter((colour) => /^#[0-9a-f]{6}$/i.test(colour))
    .slice(0, 8);

  return colours.length ? colours : DEFAULT_PALETTE;
}

function presentGuest(row) {
  return {
    id: row.id,
    invitationCode: row.invitation_code,
    name: row.full_name,
    role: row.role,
    attireTitle: row.attire_title,
    attireDescription: row.attire_description,
    palette: row.palette,
    status: row.rsvp_status,
    mealChoice: row.meal_choice,
    dessertChoice: row.dessert_choice,
    dietaryRequirements: row.dietary_requirements || "",
    respondedAt: row.responded_at,
  };
}

function validateGuest(body) {
  const name = text(body.name);
  const role = text(body.role) || "Guest";
  const invitationCode = text(body.invitationCode).toUpperCase();
  const attireTitle = text(body.attireTitle) || `${role} attire`;
  const attireDescription = text(body.attireDescription) || "Semi-formal attire in a whimsical pastel shade.";

  if (name.length < 2 || name.length > 120) {
    throw new Error("A guest name between 2 and 120 characters is required.");
  }

  if (role.length > 80 || attireTitle.length > 120 || attireDescription.length > 500) {
    throw new Error("One or more guest fields are too long.");
  }

  return {
    name,
    role,
    invitationCode,
    attireTitle,
    attireDescription,
    palette: normalizePalette(body.palette),
  };
}

function databaseError(error) {
  if (error.code === "23505") {
    return json(409, { error: "A guest with that full name already exists." });
  }

  if (error.code === "23503") {
    return json(409, { error: "That meal is not on the saved wedding menu yet. Please try saving again." });
  }

  if (error.code === "23514") {
    return json(409, {
      error: "The RSVP status and food selections do not match. Attending guests need one main and one dessert.",
    });
  }

  if (["42P01", "42703"].includes(error.code)) {
    return json(503, {
      error: "The PostgreSQL database needs the latest wedding-menu migration before this guest can be saved.",
    });
  }

  console.error("Guest management failed", error);
  return json(500, {
    error: `The guest list could not be updated right now${error.code ? ` (PostgreSQL ${error.code})` : ""}.`,
  });
}

exports.handler = async (event) => {
  if (!isAdminAuthorized(event)) {
    return json(401, { error: "Invalid admin password." });
  }

  try {
    if (event.httpMethod === "GET") {
      const result = await query(
        `SELECT
           id, invitation_code, full_name, role, attire_title, attire_description,
           palette, rsvp_status, meal_choice, dessert_choice, dietary_requirements, responded_at
         FROM guests
         ORDER BY LOWER(full_name)`
      );

      try {
        await ensureMenuItems(query);
      } catch (error) {
        console.error("Menu sync failed", error);
      }

      return json(200, { guests: result.rows.map(presentGuest), menu: MENU_ITEMS });
    }

    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "The request body was not valid JSON." });
    }

    if (event.httpMethod === "POST") {
      let guest;
      try {
        guest = validateGuest(body);
      } catch (error) {
        return json(400, { error: error.message });
      }

      const invitationCode = guest.invitationCode || `AJ-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      const result = await query(
        `INSERT INTO guests (
           invitation_code, full_name, role, attire_title, attire_description, palette
         ) VALUES (
           $1::VARCHAR(40),
           $2::VARCHAR(120),
           $3::VARCHAR(80),
           $4::VARCHAR(120),
           $5::VARCHAR(500),
           $6::TEXT[]
         )
         RETURNING
           id, invitation_code, full_name, role, attire_title, attire_description,
           palette, rsvp_status, meal_choice, dessert_choice, dietary_requirements, responded_at`,
        [
          invitationCode,
          guest.name,
          guest.role,
          guest.attireTitle,
          guest.attireDescription,
          toSqlTextArray(guest.palette),
        ]
      );

      return json(201, { success: true, guest: presentGuest(result.rows[0]) });
    }

    if (event.httpMethod === "PUT") {
      const id = Number(body.id);
      if (!Number.isInteger(id) || id < 1) {
        return json(400, { error: "A valid guest ID is required." });
      }

      let guest;
      try {
        guest = validateGuest(body);
      } catch (error) {
        return json(400, { error: error.message });
      }

      const status = text(body.status).toLowerCase();
      const mealChoice = text(body.mealChoice).toLowerCase() || null;
      const dessertChoice = text(body.dessertChoice).toLowerCase() || null;
      const dietaryRequirements = String(body.dietaryRequirements || "").trim();

      if (!STATUSES.has(status)) {
        return json(400, { error: "Choose a valid RSVP status." });
      }

      if (mealChoice && !MAIN_CHOICES.has(mealChoice)) {
        return json(400, { error: "Choose a valid main." });
      }

      if (dessertChoice && !DESSERT_CHOICES.has(dessertChoice)) {
        return json(400, { error: "Choose a valid dessert." });
      }

      if (status === "attending" && (!mealChoice || !dessertChoice)) {
        return json(400, { error: "Attending guests must have one main and one dessert." });
      }

      if (dietaryRequirements.length > 500) {
        return json(400, { error: "Dietary requirements must be 500 characters or fewer." });
      }

      const result = await withMenuRetry(query, () => query(
        `UPDATE guests
         SET invitation_code = $1::VARCHAR(40),
             full_name = $2::VARCHAR(120),
             role = $3::VARCHAR(80),
             attire_title = $4::VARCHAR(120),
             attire_description = $5::VARCHAR(500),
             palette = $6::TEXT[],
             rsvp_status = $7::VARCHAR(12),
             meal_choice = $8::VARCHAR(64),
             dessert_choice = $9::VARCHAR(64),
             dietary_requirements = $10::VARCHAR(500),
             responded_at = CASE
               WHEN $7::VARCHAR(12) = 'pending' THEN NULL
               ELSE COALESCE(responded_at, NOW())
             END,
             updated_at = NOW()
         WHERE id = $11::BIGINT
         RETURNING
           id, invitation_code, full_name, role, attire_title, attire_description,
           palette, rsvp_status, meal_choice, dessert_choice, dietary_requirements, responded_at`,
        [
          guest.invitationCode || `AJ-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
          guest.name,
          guest.role,
          guest.attireTitle,
          guest.attireDescription,
          toSqlTextArray(guest.palette),
          status,
          status === "attending" ? mealChoice : null,
          status === "attending" ? dessertChoice : null,
          status === "attending" ? dietaryRequirements : "",
          id,
        ]
      ));

      if (result.rowCount === 0) {
        return json(404, { error: "Guest not found." });
      }

      return json(200, { success: true, guest: presentGuest(result.rows[0]) });
    }

    if (event.httpMethod === "DELETE") {
      const id = Number(body.id);
      if (!Number.isInteger(id) || id < 1) {
        return json(400, { error: "A valid guest ID is required." });
      }

      const result = await query("DELETE FROM guests WHERE id = $1", [id]);
      if (result.rowCount === 0) {
        return json(404, { error: "Guest not found." });
      }

      return json(200, { success: true });
    }

    return methodNotAllowed("GET, POST, PUT, DELETE");
  } catch (error) {
    return databaseError(error);
  }
};
