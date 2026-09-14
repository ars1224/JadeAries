const { json, methodNotAllowed } = require("./lib/http");
const { displayMenuName, matchesMenuAudience, menuAudience } = require("./lib/menu");
const supabase = require("./lib/supabase");

function requestedAudience(event) {
  return menuAudience(event.queryStringParameters?.audience);
}

function presentOption(row) {
  return {
    id: row.id,
    name: displayMenuName(row.name),
    description: row.description || "",
    dietaryRestrictions: row.dietary_restrictions || null,
    imageUrl: row.image_url || null,
    audience: menuAudience(row.audience),
  };
}

async function loadMenuRows() {
  const select = "id,course,name,description,dietary_restrictions,image_url,sort_order,audience";
  try {
    return await supabase.request(
      `food_options?select=${encodeURIComponent(select)}&is_active=eq.true&course=in.(main,dessert)&order=sort_order.asc`
    );
  } catch (error) {
    if (error?.code !== "PGRST204" && error?.code !== "42703") {
      throw error;
    }
    return supabase.request(
      `food_options?select=${encodeURIComponent("id,course,name,description,dietary_restrictions,image_url,sort_order")}&is_active=eq.true&course=in.(main,dessert)&order=sort_order.asc`
    );
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return methodNotAllowed("GET");
  }

  try {
    const audience = event.queryStringParameters?.audience
      ? requestedAudience(event)
      : "";
    const rows = await loadMenuRows();
    const menu = { mains: [], desserts: [] };
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      if (!matchesMenuAudience(row, audience)) {
        return;
      }
      if (row.course === "main") {
        menu.mains.push(presentOption(row));
      } else if (row.course === "dessert") {
        menu.desserts.push(presentOption(row));
      }
    });

    return json(200, menu);
  } catch (error) {
    console.error("Menu lookup failed", { status: error.status, code: error.code });
    return json(500, { error: "We couldn't load the menu right now. Please try again." });
  }
};
