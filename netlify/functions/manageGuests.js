const { isAdminAuthorized } = require("./lib/adminAuth");
const { json, methodNotAllowed } = require("./lib/http");
const supabase = require("./lib/supabase");

const STATUSES = new Set(["pending", "attending", "not_attending"]);

function one(value) {
  return Array.isArray(value) ? (value[0] || null) : (value || null);
}

function optionalText(value, maximum) {
  const result = String(value || "").trim();
  if (result.length > maximum) {
    throw new Error("too_long");
  }
  return result;
}

function requiredId(value) {
  const id = String(value || "").trim();
  return id && id.length <= 128 ? id : "";
}

function presentMenuItem(row) {
  return {
    id: String(row.id),
    category: row.course,
    name: row.name,
    description: row.description || "",
    dietaryCodes: row.dietary_restrictions || [],
  };
}

function presentGuest(row) {
  const foodChoice = one(row.guest_food_choices);
  return {
    id: String(row.id),
    name: row.full_name,
    role: row.role || "Guest",
    status: row.rsvp_status,
    mainId: foodChoice?.main_id ? String(foodChoice.main_id) : null,
    dessertId: foodChoice?.dessert_id ? String(foodChoice.dessert_id) : null,
    foodNotes: foodChoice?.notes || "",
    dietaryRequirements: row.dietary_requirements || "",
    respondedAt: row.responded_at || null,
  };
}

function buildDashboard(guests, menu) {
  const countStatus = (status) => guests.filter((guest) => guest.status === status).length;
  const countChoice = (field, id) => guests.filter(
    (guest) => guest.status === "attending" && guest[field] === id
  ).length;

  return {
    summary: {
      total: guests.length,
      attending: countStatus("attending"),
      notAttending: countStatus("not_attending"),
      pending: countStatus("pending"),
      mainSelections: guests.filter(
        (guest) => guest.status === "attending" && guest.mainId
      ).length,
      dessertSelections: guests.filter(
        (guest) => guest.status === "attending" && guest.dessertId
      ).length,
      mealSelections: guests.filter(
        (guest) => guest.status === "attending" && guest.mainId && guest.dessertId
      ).length,
      dietaryRequirements: guests.filter((guest) => guest.dietaryRequirements).length,
    },
    catering: {
      mains: menu
        .filter((item) => item.category === "main")
        .map((item) => ({ id: item.id, name: item.name, count: countChoice("mainId", item.id) })),
      desserts: menu
        .filter((item) => item.category === "dessert")
        .map((item) => ({ id: item.id, name: item.name, count: countChoice("dessertId", item.id) })),
    },
  };
}

async function loadDashboard() {
  const guestSelect = [
    "id",
    "full_name",
    "role",
    "rsvp_status",
    "responded_at",
    "dietary_requirements",
    "guest_food_choices(main_id,dessert_id,notes)",
  ].join(",");
  const menuSelect = "id,course,name,description,dietary_restrictions,sort_order";

  const [guestRows, menuRows] = await Promise.all([
    supabase.request(
      `guests?select=${encodeURIComponent(guestSelect)}&order=full_name.asc&limit=1000`
    ),
    supabase.request(
      `food_options?select=${encodeURIComponent(menuSelect)}&is_active=eq.true&course=in.(main,dessert)&order=sort_order.asc`
    ),
  ]);

  const guests = (Array.isArray(guestRows) ? guestRows : []).map(presentGuest);
  const menu = (Array.isArray(menuRows) ? menuRows : []).map(presentMenuItem);
  return { guests, menu, ...buildDashboard(guests, menu) };
}

function adminError(error) {
  console.error("Admin guest management failed", {
    status: error?.status,
    code: error?.code,
    name: error?.name,
  });

  if (error?.code === "22023") {
    return json(400, { error: "Choose one active main and one active dessert for an attending guest." });
  }
  if (error?.code === "P0002") {
    return json(404, { error: "Guest not found." });
  }
  return json(500, { error: "The guest list could not be updated right now." });
}

exports.handler = async (event) => {
  if (!isAdminAuthorized(event)) {
    return json(401, { error: "Your admin session has expired. Please log in again." });
  }

  if (event.httpMethod === "GET") {
    try {
      return json(200, await loadDashboard());
    } catch (error) {
      return adminError(error);
    }
  }

  if (event.httpMethod !== "PUT") {
    return methodNotAllowed("GET, PUT");
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "The request body was not valid JSON." });
  }

  const guestId = requiredId(body.id);
  const status = String(body.status || "").trim().toLowerCase();
  const mainId = requiredId(body.mainId);
  const dessertId = requiredId(body.dessertId);
  let dietaryRequirements;
  let foodNotes;

  try {
    dietaryRequirements = optionalText(body.dietaryRequirements, 1_000);
    foodNotes = optionalText(body.foodNotes, 1_000);
  } catch {
    return json(400, { error: "Dietary requirements and food notes must each be 1,000 characters or fewer." });
  }

  if (!guestId) {
    return json(400, { error: "A valid guest ID is required." });
  }
  if (!STATUSES.has(status)) {
    return json(400, { error: "Choose a valid RSVP status." });
  }
  if (status === "attending" && (!mainId || !dessertId)) {
    return json(400, { error: "Attending guests require one main and one dessert." });
  }

  try {
    await supabase.request("rpc/admin_update_guest_rsvp", {
      method: "POST",
      body: {
        p_guest_id: guestId,
        p_status: status,
        p_main_id: status === "attending" ? mainId : null,
        p_dessert_id: status === "attending" ? dessertId : null,
        p_dietary_requirements: status === "not_attending" ? "" : dietaryRequirements,
        p_notes: status === "attending" ? foodNotes : "",
      },
    });
    return json(200, { success: true });
  } catch (error) {
    return adminError(error);
  }
};

module.exports.buildDashboard = buildDashboard;
module.exports.presentGuest = presentGuest;
