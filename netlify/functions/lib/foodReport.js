const { MENU_ITEMS } = require("./menu");

function guestValue(guest, camelCase, snakeCase) {
  return guest[camelCase] ?? guest[snakeCase] ?? null;
}

function buildFoodReport(guests, menuItems = MENU_ITEMS) {
  const attendingGuests = guests.filter(
    (guest) => guestValue(guest, "status", "rsvp_status") === "attending"
  );

  const sections = [
    { category: "main", title: "Mains", choiceFields: ["mealChoice", "meal_choice"] },
    { category: "dessert", title: "Desserts", choiceFields: ["dessertChoice", "dessert_choice"] },
  ].map(({ category, title, choiceFields }) => {
    const items = menuItems
      .filter((item) => item.category === category)
      .map((item) => {
        const orders = attendingGuests
          .filter((guest) => guestValue(guest, ...choiceFields) === item.slug)
          .map((guest) => ({
            name: guestValue(guest, "name", "full_name") || "Unnamed guest",
            dietaryRequirements:
              guestValue(guest, "dietaryRequirements", "dietary_requirements") || "",
          }))
          .sort((left, right) => left.name.localeCompare(right.name));

        const quantity = orders.length;
        const unitPrice = Number(item.price || 0);
        return {
          ...item,
          orders,
          quantity,
          unitPrice,
          subtotal: quantity * unitPrice,
        };
      });

    return {
      category,
      title,
      items,
      quantity: items.reduce((total, item) => total + item.quantity, 0),
      total: items.reduce((total, item) => total + item.subtotal, 0),
    };
  });

  return {
    generatedAt: new Date(),
    attendingGuests: attendingGuests.length,
    sections,
    mainCount: sections.find((section) => section.category === "main")?.quantity || 0,
    dessertCount: sections.find((section) => section.category === "dessert")?.quantity || 0,
    grandTotal: sections.reduce((total, section) => total + section.total, 0),
  };
}

module.exports = { buildFoodReport };
