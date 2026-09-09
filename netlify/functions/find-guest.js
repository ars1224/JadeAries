const { json, methodNotAllowed } = require("./lib/http");
const supabase = require("./lib/supabase");
const { createGuestToken } = require("./lib/tokens");

const NOT_FOUND_MESSAGE = "Sorry, we couldn't find your invitation. Please contact the bride or groom.";

function normalizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function one(value) {
  return Array.isArray(value) ? (value[0] || null) : (value || null);
}

function presentGuest(row) {
  const attire = one(row.attire_profiles);
  const foodChoice = one(row.guest_food_choices);

  return {
    token: createGuestToken(row.id),
    fullName: row.full_name,
    role: row.role,
    rsvpStatus: row.rsvp_status,
    dietaryRequirements: row.dietary_requirements || "",
    attire: attire ? {
      displayName: attire.display_name,
      attireName: attire.attire_name,
      description: attire.attire_description,
      primaryColor: attire.primary_color,
      secondaryColor: attire.secondary_color,
      imageUrl: attire.image_url,
    } : null,
    foodChoice: foodChoice ? {
      mainId: foodChoice.main_id,
      dessertId: foodChoice.dessert_id,
      notes: foodChoice.notes || "",
    } : null,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return methodNotAllowed("POST");
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Please enter the full name shown on your invitation." });
  }

  const normalizedName = normalizeName(body.name);
  if (normalizedName.length < 2 || normalizedName.length > 160) {
    return json(400, { error: "Please enter the full name shown on your invitation." });
  }

  const select = [
    "id",
    "full_name",
    "role",
    "rsvp_status",
    "dietary_requirements",
    "attire_profiles(display_name,attire_name,attire_description,primary_color,secondary_color,image_url)",
    "guest_food_choices(main_id,dessert_id,notes)",
  ].join(",");

  try {
    const rows = await supabase.request(
      `guests?select=${encodeURIComponent(select)}&normalized_name=eq.${encodeURIComponent(normalizedName)}&limit=2`
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      return json(404, { error: NOT_FOUND_MESSAGE });
    }

    if (rows.length > 1) {
      console.warn("Guest lookup found a duplicate normalized name.");
      return json(409, {
        error: "We found more than one invitation with that name. Please contact the bride or groom.",
      });
    }

    return json(200, { guest: presentGuest(rows[0]) });
  } catch (error) {
    console.error("Guest lookup failed", { status: error.status, code: error.code });
    return json(500, { error: "We couldn't open your invitation right now. Please try again." });
  }
};

exports.normalizeName = normalizeName;
