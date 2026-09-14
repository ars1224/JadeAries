const { isAdminAuthorized } = require("./lib/adminAuth");
const { json, methodNotAllowed } = require("./lib/http");
const { menuAudience, normalizeDietaryCodes, privateMenuPrice } = require("./lib/menu");
const supabase = require("./lib/supabase");

const STATUSES = new Set(["pending", "attending", "not_attending"]);
const MISSING_RPC_CODES = new Set(["PGRST202", "PGRST203", "PGRST204"]);

const ATTIRE_PROFILE_NAMES_BY_ROLE = {
  "proxy ninong": ["ninong"],
  "proxy ninang": ["ninang"],
  groomsmen: ["groomsman", "groomsmen"],
  "guest - officiant": ["officiant"],
  guest: ["guest", "wedding guest"],
  parents: [
    "parents",
    "father of the bride",
    "mother of the bride",
    "father of the groom",
    "mother of the groom",
  ],
};

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

function normalizeRole(value) {
  return String(value || "Guest").trim().replace(/\s+/g, " ");
}

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

function errorMessage(error) {
  return String(error?.message || "");
}

function isMissingRpc(error) {
  if (MISSING_RPC_CODES.has(error?.code)) {
    return true;
  }
  return /p_is_child|could not find the function/i.test(errorMessage(error));
}

function isMissingWritableColumn(error) {
  return error?.code === "PGRST204" || error?.code === "428C9" || error?.code === "42703";
}

function isMissingChildColumn(error) {
  return isMissingWritableColumn(error) || /is_child/i.test(errorMessage(error));
}

function parseBoolean(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function generateInvitationCode() {
  return `JA-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

function createdGuestId(payload) {
  if (payload && typeof payload === "object" && !Array.isArray(payload) && payload.id) {
    return payload.id;
  }
  const row = Array.isArray(payload) ? payload[0] : null;
  return row?.id || "";
}

function notFoundError() {
  const error = new Error("Guest not found.");
  error.code = "P0002";
  return error;
}

function duplicateNameError() {
  const error = new Error("Another guest already uses that name.");
  error.code = "23505";
  return error;
}

async function findAttireProfileId(role) {
  const profiles = await supabase.request(
    `attire_profiles?select=${encodeURIComponent("id,display_name")}&limit=500`
  );
  const candidates = ATTIRE_PROFILE_NAMES_BY_ROLE[normalized(role)] || [normalized(role)];
  const profilesByName = new Map(
    (Array.isArray(profiles) ? profiles : []).map((profile) => [
      normalized(profile.display_name),
      profile.id,
    ])
  );

  for (const candidate of candidates) {
    if (profilesByName.has(candidate)) {
      return profilesByName.get(candidate);
    }
  }
  return null;
}

async function updateGuestRole(guestId, role, extra = {}) {
  const attireProfileId = await findAttireProfileId(role);
  const changes = {
    role,
    updated_at: new Date().toISOString(),
    ...extra,
  };
  if (attireProfileId !== null) {
    changes.attire_profile_id = attireProfileId;
  }

  try {
    const updated = await supabase.request(
      `guests?id=eq.${encodeURIComponent(guestId)}&select=id`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: changes,
      }
    );
    if (!Array.isArray(updated) || updated.length === 0) {
      throw notFoundError();
    }
  } catch (error) {
    if (!("is_child" in extra) || !isMissingWritableColumn(error)) {
      throw error;
    }
    delete changes.is_child;
    const updated = await supabase.request(
      `guests?id=eq.${encodeURIComponent(guestId)}&select=id`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: changes,
      }
    );
    if (!Array.isArray(updated) || updated.length === 0) {
      throw notFoundError();
    }
  }
}

function kidsMenuUnavailableError() {
  const error = new Error(
    "The kids menu is not set up yet. Run database/migrations/015_kids_guest_menu.sql in Supabase, then try again."
  );
  error.code = "P0001";
  return error;
}

async function persistGuestChildFlag(guestId, isChild) {
  try {
    await supabase.request(
      `guests?id=eq.${encodeURIComponent(guestId)}`,
      {
        method: "PATCH",
        body: { is_child: isChild },
      }
    );
  } catch (error) {
    if (isMissingChildColumn(error)) {
      if (isChild) {
        throw kidsMenuUnavailableError();
      }
      return;
    }
    console.error("Could not persist kids-menu flag", {
      status: error?.status,
      code: error?.code,
      message: error?.message,
    });
    if (isChild) {
      throw kidsMenuUnavailableError();
    }
  }
}

async function insertGuestRecord(newGuest) {
  const inserted = await supabase.request(
    "guests?select=id,normalized_name",
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: newGuest,
    }
  );
  const guest = Array.isArray(inserted) ? inserted[0] : inserted;
  if (!guest?.id) {
    throw new Error("The new guest could not be created.");
  }
  return guest;
}

async function createGuestWithoutRpc(fullName, role, isChild) {
  const normalizedName = normalized(fullName);
  const existing = await supabase.request(
    `guests?select=id&normalized_name=eq.${encodeURIComponent(normalizedName)}&limit=1`
  );
  if (Array.isArray(existing) && existing.length > 0) {
    throw duplicateNameError();
  }

  const attireProfileId = await findAttireProfileId(role);
  const newGuest = {
    full_name: fullName,
    normalized_name: normalizedName,
    role,
    rsvp_status: "pending",
    is_child: isChild,
  };
  if (attireProfileId !== null) {
    newGuest.attire_profile_id = attireProfileId;
  }

  let guest;
  try {
    guest = await insertGuestRecord(newGuest);
  } catch (error) {
    if (error?.code === "23502" && newGuest.invitation_code === undefined) {
      newGuest.invitation_code = generateInvitationCode();
      guest = await insertGuestRecord(newGuest);
    } else if (isMissingWritableColumn(error)) {
      delete newGuest.is_child;
      delete newGuest.normalized_name;
      try {
        guest = await insertGuestRecord(newGuest);
      } catch (retryError) {
        if (retryError?.code === "23502" && newGuest.invitation_code === undefined) {
          newGuest.invitation_code = generateInvitationCode();
          guest = await insertGuestRecord(newGuest);
        } else if (!isMissingWritableColumn(retryError)) {
          throw retryError;
        } else {
          delete newGuest.attire_profile_id;
          guest = await insertGuestRecord(newGuest);
        }
      }
    } else {
      throw error;
    }
  }

  if (!guest.normalized_name) {
    try {
      await supabase.request(
        `guests?id=eq.${encodeURIComponent(guest.id)}`,
        {
          method: "PATCH",
          body: { normalized_name: normalizedName },
        }
      );
    } catch {
      // Ignore generated or missing normalized_name columns.
    }
  }
  return guest.id;
}

async function createGuest(fullName, role, isChild) {
  try {
    const created = await supabase.request("rpc/admin_create_guest", {
      method: "POST",
      body: { p_full_name: fullName, p_role: role, p_is_child: isChild },
    });
    const id = createdGuestId(created);
    if (!id) {
      throw new Error("The new guest could not be created.");
    }
    await persistGuestChildFlag(id, isChild);
    return id;
  } catch (error) {
    if (!isMissingRpc(error)) throw error;
    try {
      const created = await supabase.request("rpc/admin_create_guest", {
        method: "POST",
        body: { p_full_name: fullName, p_role: role },
      });
      const id = createdGuestId(created);
      if (!id) {
        throw new Error("The new guest could not be created.");
      }
      await persistGuestChildFlag(id, isChild);
      return id;
    } catch (retryError) {
      if (!isMissingRpc(retryError)) throw retryError;
      return createGuestWithoutRpc(fullName, role, isChild);
    }
  }
}

async function deleteGuestWithoutRpc(guestId) {
  await supabase.request(
    `guest_food_choices?guest_id=eq.${encodeURIComponent(guestId)}`,
    { method: "DELETE" }
  );
  const removed = await supabase.request(
    `guests?id=eq.${encodeURIComponent(guestId)}&select=id`,
    {
      method: "DELETE",
      headers: { Prefer: "return=representation" },
    }
  );
  if (!Array.isArray(removed) || removed.length === 0) {
    throw notFoundError();
  }
}

async function deleteGuest(guestId) {
  try {
    await supabase.request("rpc/admin_delete_guest", {
      method: "POST",
      body: { p_guest_id: guestId },
    });
  } catch (error) {
    if (error?.code === "P0002") {
      throw error;
    }
    await deleteGuestWithoutRpc(guestId);
  }
}

function presentMenuItem(row) {
  return {
    id: String(row.id),
    category: row.course,
    name: row.name,
    description: row.description || "",
    dietaryCodes: normalizeDietaryCodes(row.dietary_restrictions),
    audience: menuAudience(row.audience),
    price: privateMenuPrice(row.name),
  };
}

function presentGuest(row) {
  const foodChoice = one(row.guest_food_choices);
  const attire = one(row.attire_profiles);
  return {
    id: String(row.id),
    name: row.full_name,
    role: row.role || "Guest",
    isChild: Boolean(row.is_child),
    status: row.rsvp_status,
    mainId: foodChoice?.main_id ? String(foodChoice.main_id) : null,
    dessertId: foodChoice?.dessert_id ? String(foodChoice.dessert_id) : null,
    foodNotes: foodChoice?.notes || "",
    dietaryRequirements: row.dietary_requirements || "",
    respondedAt: row.responded_at || null,
    attire: attire ? {
      displayName: attire.display_name || "",
      attireName: attire.attire_name || "",
      description: attire.attire_description || "",
      imageUrl: attire.image_url || null,
    } : null,
  };
}

function buildDashboard(guests, menu) {
  const countStatus = (status) => guests.filter((guest) => guest.status === status).length;
  const countChoice = (field, id) => guests.filter(
    (guest) => guest.status === "attending" && guest[field] === id
  ).length;
  const prices = new Map(menu.map((item) => [item.id, Number(item.price || 0)]));
  const attendingGuests = guests.filter((guest) => guest.status === "attending");

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
      cateringTotal: attendingGuests.reduce(
        (total, guest) => total
          + (prices.get(guest.mainId) || 0)
          + (prices.get(guest.dessertId) || 0),
        0
      ),
    },
    catering: {
      mains: menu
        .filter((item) => item.category === "main")
        .map((item) => {
          const count = countChoice("mainId", item.id);
          return {
            id: item.id,
            name: item.name,
            count,
            unitPrice: Number(item.price || 0),
            subtotal: count * Number(item.price || 0),
          };
        }),
      desserts: menu
        .filter((item) => item.category === "dessert")
        .map((item) => {
          const count = countChoice("dessertId", item.id);
          return {
            id: item.id,
            name: item.name,
            count,
            unitPrice: Number(item.price || 0),
            subtotal: count * Number(item.price || 0),
          };
        }),
    },
  };
}

async function requestRows(path, fallbackPath) {
  try {
    return await supabase.request(path);
  } catch (error) {
    if (!fallbackPath || (error?.code !== "PGRST204" && error?.code !== "42703")) {
      throw error;
    }
    return supabase.request(fallbackPath);
  }
}

async function loadDashboard() {
  const guestColumns = [
    "id",
    "full_name",
    "role",
    "rsvp_status",
    "responded_at",
    "dietary_requirements",
    "is_child",
    "attire_profiles(display_name,attire_name,attire_description,image_url)",
    "guest_food_choices(main_id,dessert_id,notes)",
  ];
  const guestSelect = guestColumns.join(",");
  const legacyGuestSelect = guestColumns.filter((column) => column !== "is_child").join(",");
  const menuSelect = "id,course,name,description,dietary_restrictions,sort_order,audience";
  const legacyMenuSelect = "id,course,name,description,dietary_restrictions,sort_order";

  const [guestRows, menuRows] = await Promise.all([
    requestRows(
      `guests?select=${encodeURIComponent(guestSelect)}&order=full_name.asc&limit=1000`,
      `guests?select=${encodeURIComponent(legacyGuestSelect)}&order=full_name.asc&limit=1000`
    ),
    requestRows(
      `food_options?select=${encodeURIComponent(menuSelect)}&is_active=eq.true&course=in.(main,dessert)&order=sort_order.asc`,
      `food_options?select=${encodeURIComponent(legacyMenuSelect)}&is_active=eq.true&course=in.(main,dessert)&order=sort_order.asc`
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
    message: error?.message,
  });

  if (error?.code === "22023") {
    return json(400, {
      error: "Choose one active main and one active dessert for an attending guest.",
    });
  }

  if (error?.code === "22001") {
    return json(400, { error: "Guest name must be between 2 and 160 characters." });
  }

  if (error?.code === "23505") {
    return json(409, { error: "Another guest already uses that name." });
  }

  if (error?.code === "P0002") {
    return json(404, {
      error: "Guest not found.",
    });
  }

  if (error?.code === "P0001") {
    return json(409, { error: error.message });
  }

  if (error?.code === "23503") {
    return json(409, {
      error: "This guest could not be removed because related records still exist.",
    });
  }

  if (error?.code === "42501") {
    return json(403, {
      error: "The database role cannot change this guest. Run database/migrations/016_service_role_guest_privileges.sql in Supabase, then try again.",
    });
  }

  if (isMissingChildColumn(error)) {
    return json(409, { error: kidsMenuUnavailableError().message });
  }

  const code = error?.code ? ` (${error.code})` : "";
  return json(500, { error: `The guest list could not be updated right now.${code}` });
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

  if (!["POST", "PUT", "DELETE"].includes(event.httpMethod)) {
    return methodNotAllowed("GET, POST, PUT, DELETE");
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "The request body was not valid JSON." });
  }

  const guestId = requiredId(body.id);
  const fullName = String(body.name || "").trim().replace(/\s+/g, " ");
  const role = normalizeRole(body.role);
  const isChild = parseBoolean(body.isChild);
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

  if (event.httpMethod === "POST") {
    if (fullName.length < 2 || fullName.length > 160) {
      return json(400, { error: "Guest name must be between 2 and 160 characters." });
    }
    if (role.length < 2 || role.length > 80) {
      return json(400, { error: "Choose a valid guest role." });
    }

    try {
      const id = await createGuest(fullName, role, isChild);
      return json(201, { success: true, id: String(id) });
    } catch (error) {
      return adminError(error);
    }
  }

  if (!guestId) {
    return json(400, { error: "A valid guest ID is required." });
  }

  if (event.httpMethod === "DELETE") {
    try {
      await deleteGuest(guestId);
      return json(200, { success: true });
    } catch (error) {
      return adminError(error);
    }
  }

  if (fullName.length < 2 || fullName.length > 160) {
    return json(400, { error: "Guest name must be between 2 and 160 characters." });
  }
  if (role.length < 2 || role.length > 80) {
    return json(400, { error: "Choose a valid guest role." });
  }
  if (!STATUSES.has(status)) {
    return json(400, { error: "Choose a valid RSVP status." });
  }
  if (status === "attending" && (!mainId || !dessertId)) {
    return json(400, { error: "Attending guests require one main and one dessert." });
  }

  try {
    const updateBody = {
      p_guest_id: guestId,
      p_full_name: fullName,
      p_role: role,
      p_status: status,
      p_main_id: status === "attending" ? mainId : null,
      p_dessert_id: status === "attending" ? dessertId : null,
      p_dietary_requirements: status === "not_attending" ? "" : dietaryRequirements,
      p_notes: status === "attending" ? foodNotes : "",
      p_is_child: isChild,
    };

    try {
      await supabase.request("rpc/admin_update_guest", {
        method: "POST",
        body: updateBody,
      });
    } catch (error) {
      if (!isMissingRpc(error)) throw error;
      try {
        const { p_is_child: unusedChild, ...roleAwareBody } = updateBody;
        await supabase.request("rpc/admin_update_guest", {
          method: "POST",
          body: roleAwareBody,
        });
      } catch (retryError) {
        if (!isMissingRpc(retryError)) throw retryError;
        const { p_role: unusedRole, p_is_child: unusedChild, ...legacyUpdateBody } = updateBody;
        await supabase.request("rpc/admin_update_guest", {
          method: "POST",
          body: legacyUpdateBody,
        });
        await updateGuestRole(guestId, role);
      }
    }
    await persistGuestChildFlag(guestId, isChild);
    return json(200, { success: true });
  } catch (error) {
    return adminError(error);
  }
};

module.exports.buildDashboard = buildDashboard;
module.exports.presentGuest = presentGuest;
