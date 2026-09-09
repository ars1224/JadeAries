const { json, methodNotAllowed } = require("./lib/http");
const supabase = require("./lib/supabase");

function presentOption(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    dietaryRestrictions: row.dietary_restrictions || null,
    imageUrl: row.image_url || null,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return methodNotAllowed("GET");
  }

  try {
    const select = "id,course,name,description,dietary_restrictions,image_url,sort_order";
    const rows = await supabase.request(
      `food_options?select=${encodeURIComponent(select)}&is_active=eq.true&course=in.(main,dessert)&order=sort_order.asc`
    );

    const menu = { mains: [], desserts: [] };
    (Array.isArray(rows) ? rows : []).forEach((row) => {
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
