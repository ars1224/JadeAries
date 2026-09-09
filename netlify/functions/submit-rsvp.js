const { json, methodNotAllowed } = require("./lib/http");
const supabase = require("./lib/supabase");
const { verifyGuestToken } = require("./lib/tokens");

const STATUSES = new Set(["attending", "not_attending"]);

function optionalText(value, maximum) {
  const text = String(value || "").trim();
  if (text.length > maximum) {
    throw new Error("too_long");
  }
  return text;
}

function requiredId(value) {
  const id = String(value || "").trim();
  return id.length > 0 && id.length <= 128 ? id : "";
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return methodNotAllowed("POST");
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Please check your response and try again." });
  }

  if (!STATUSES.has(body.status)) {
    return json(400, { error: "Please choose whether you can attend." });
  }

  const mainId = requiredId(body.mainId);
  const dessertId = requiredId(body.dessertId);
  if (body.status === "attending" && !mainId) {
    return json(400, { error: "Please choose one main." });
  }
  if (body.status === "attending" && !dessertId) {
    return json(400, { error: "Please choose one dessert." });
  }

  let dietaryRequirements;
  let notes;
  try {
    dietaryRequirements = optionalText(body.dietaryRequirements, 1_000);
    notes = optionalText(body.notes, 1_000);
  } catch {
    return json(400, { error: "Dietary requirements and notes must each be 1,000 characters or fewer." });
  }

  let session;
  try {
    session = verifyGuestToken(body.token);
  } catch {
    return json(401, { error: "Your invitation session has expired. Please look up your name again." });
  }

  try {
    const result = await supabase.request("rpc/submit_guest_rsvp", {
      method: "POST",
      body: {
        p_guest_id: session.guestId,
        p_status: body.status,
        p_main_id: body.status === "attending" ? mainId : null,
        p_dessert_id: body.status === "attending" ? dessertId : null,
        p_dietary_requirements: body.status === "attending" ? dietaryRequirements : "",
        p_notes: body.status === "attending" ? notes : "",
      },
    });

    return json(200, { success: true, guest: result });
  } catch (error) {
    console.error("RSVP submission failed", { status: error.status, code: error.code });

    if (error.code === "22023") {
      return json(400, { error: "Please choose one active main and one active dessert." });
    }
    if (error.code === "P0002") {
      return json(404, { error: "This invitation is no longer available." });
    }

    return json(500, { error: "Something went wrong while saving your response. Please try again." });
  }
};
