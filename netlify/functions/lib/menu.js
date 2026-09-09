const MENU_ITEMS = Object.freeze([
  {
    slug: "mediterranean_vegetable_charlotte",
    category: "main",
    name: "Mediterranean vegetable charlotte",
    description: "Roquette, olive tapenade, cherry tomatoes, harissa oil",
    image: "img/mediterranean-vegetable-charlotte.jpg",
    dietaryCodes: ["G", "VG"],
    price: 45,
  },
  {
    slug: "confit_pork_belly",
    category: "main",
    name: "Confit pork belly – 200g",
    description: "Rosemary crushed potatoes, crushed beets, garlic spinach, jus",
    image: "img/confit-pork-belly.jpg",
    dietaryCodes: ["G"],
    price: 52,
  },
  {
    slug: "lemon_baked_salmon",
    category: "main",
    name: "Lemon baked salmon – 170g",
    description: "Potato gratin, spiced edamame cassoulet, miso dressing",
    image: "img/lemon-baked-salmon.jpg",
    dietaryCodes: ["G", "D"],
    price: 59,
  },
  {
    slug: "roasted_beef_fillet",
    category: "main",
    name: "Roasted beef fillet – 180g",
    description: "Rosemary crushed potatoes, charred broccolini, candied onion, jus",
    image: "img/roasted-beef-fillet.jpg",
    dietaryCodes: ["D", "DO"],
    price: 62,
  },
  {
    slug: "chicken_thigh_white_wine_parmesan",
    category: "main",
    name: "Chicken thigh baked in white wine & parmesan cream – 180g",
    description: "Potato gratin, broccolini, candied onion",
    image: "img/chicken-thigh-white-wine-parmesan.jpg",
    dietaryCodes: ["G"],
    price: 50,
  },
  {
    slug: "classic_tiramisu",
    category: "dessert",
    name: "Classic tiramisu",
    description: "Espresso cream, lady fingers, cocoa",
    image: "img/classic-tiramisu.jpg",
    dietaryCodes: [],
    price: 22,
  },
  {
    slug: "white_chocolate_cheesecake",
    category: "dessert",
    name: "White chocolate cheesecake",
    description: "Berry coulis, freeze-dried raspberry",
    image: "img/white-chocolate-cheesecake.jpg",
    dietaryCodes: [],
    price: 22,
  },
  {
    slug: "vanilla_bean_panna_cotta",
    category: "dessert",
    name: "Vanilla bean panna cotta",
    description: "White chocolate cream, seasonal berries",
    image: "img/vanilla-bean-panna-cotta.jpg",
    dietaryCodes: ["G"],
    price: 22,
  },
  {
    slug: "poached_orange_almond_torte",
    category: "dessert",
    name: "Poached orange & almond torte",
    description: "Whipped coconut cream, praline",
    image: "img/poached-orange-almond-torte.jpg",
    dietaryCodes: ["G", "D", "VG"],
    price: 24,
  },
]);

const MAIN_CHOICES = new Set(
  MENU_ITEMS.filter((item) => item.category === "main").map((item) => item.slug)
);
const DESSERT_CHOICES = new Set(
  MENU_ITEMS.filter((item) => item.category === "dessert").map((item) => item.slug)
);

function publicMenuItems() {
  return MENU_ITEMS.map(({ price: _price, ...item }) => item);
}

function toSqlTextArray(values) {
  const items = Array.isArray(values) ? values : [];
  return `{${items
    .map((value) => `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .join(",")}}`;
}

async function ensureMenuItems(query) {
  for (const [index, item] of MENU_ITEMS.entries()) {
    await query(
      `INSERT INTO menu_items (slug, category, name, description, dietary_codes, price_nzd, sort_order)
       VALUES (
         $1::VARCHAR(64),
         $2::VARCHAR(12),
         $3::VARCHAR(160),
         $4::VARCHAR(500),
         $5::TEXT[],
         $6::NUMERIC(8, 2),
         $7::SMALLINT
       )
       ON CONFLICT (slug) DO UPDATE
       SET category = EXCLUDED.category,
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           dietary_codes = EXCLUDED.dietary_codes,
           price_nzd = EXCLUDED.price_nzd,
           sort_order = EXCLUDED.sort_order,
           active = TRUE,
           updated_at = NOW()`,
      [
        item.slug,
        item.category,
        item.name,
        item.description,
        toSqlTextArray(item.dietaryCodes),
        item.price,
        (index + 1) * 10,
      ]
    );
  }
}

async function withMenuRetry(query, operation) {
  try {
    return await operation();
  } catch (error) {
    if (error.code !== "23503") {
      throw error;
    }

    await ensureMenuItems(query);
    return operation();
  }
}

module.exports = {
  MENU_ITEMS,
  MAIN_CHOICES,
  DESSERT_CHOICES,
  publicMenuItems,
  toSqlTextArray,
  ensureMenuItems,
  withMenuRetry,
};
