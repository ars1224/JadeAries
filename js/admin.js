const API_URL = "/.netlify/functions/manageGuests";
const AUTH_URL = "/.netlify/functions/admin-auth";
const FOOD_REPORT_URL = "/.netlify/functions/exportFoodReport";
const GUEST_ATTIRE_IMAGE = "/images/attire/guest-attire-reference.png";

const loginView = document.getElementById("login-view");
const managerView = document.getElementById("manager-view");
const loginForm = document.getElementById("login-form");
const passwordInput = document.getElementById("admin-password");
const loginError = document.getElementById("login-error");
const logoutButton = document.getElementById("logout-button");
const guestSearch = document.getElementById("guest-search");
const statusFilter = document.getElementById("status-filter");
const roleFilter = document.getElementById("role-filter");
const menuFilter = document.getElementById("menu-filter");
const guestList = document.getElementById("guest-list");
const guestTemplate = document.getElementById("guest-row-template");
const managerMessage = document.getElementById("manager-message");
const emptyState = document.getElementById("empty-state");
const cateringTotals = document.getElementById("catering-totals");
const downloadFoodPdf = document.getElementById("download-food-pdf");
const downloadFoodExcel = document.getElementById("download-food-excel");
const addGuestForm = document.getElementById("add-guest-form");
const addGuestName = document.getElementById("add-guest-name");
const addGuestRole = document.getElementById("add-guest-role");
const addGuestChild = document.getElementById("add-guest-child");
const addGuestButton = document.getElementById("add-guest-button");
const addGuestMessage = document.getElementById("add-guest-message");
const addAttirePreview = document.getElementById("add-attire-preview");

let guests = [];
let menuItems = [];

const DEFAULT_ROLE_OPTIONS = [
    "Bride",
    "Groom",
    "Parents",
    "Best Man",
    "Maid of Honour",
    "Bridesmaid",
    "Groomsmen",
    "Groomsman",
    "Ninong",
    "Ninang",
    "Proxy Ninong",
    "Proxy Ninang",
    "Guest",
    "Guest - Officiant",
    "Flower Girl",
    "Ring Bearer",
    "Bible Bearer",
    "Coin Bearer"
];

const CHILD_ROLES = new Set([
    "Flower Girl",
    "Ring Bearer",
    "Bible Bearer",
    "Coin Bearer"
]);

function isChildRole(role) {
    return CHILD_ROLES.has(String(role || "").trim());
}

function usesKidsMenu(guest, role = guest?.role) {
    return Boolean(guest?.isChild) || isChildRole(role);
}

function keepKidsTick(checkbox, guest, role) {
    if (usesKidsMenu(guest, role)) {
        checkbox.checked = true;
    }
    return checkbox.checked;
}

const ATTIRE_BY_ROLE = {
    Bride: {
        displayName: "Bride",
        attireName: "Bridal attire",
        description: "White is lovingly reserved for the bride.",
        imageUrl: "/images/attire/bride-dress-reference.jpg"
    },
    Groom: {
        displayName: "Groom",
        attireName: "Groom attire",
        description: "Ivory / cream three-piece suit, white shirt, light pink tie, and brown shoes.",
        imageUrl: "/images/attire/groom-suit-reference.jpg"
    },
    Parents: {
        displayName: "Parents",
        attireName: "Parents attire",
        description: "Formal attire in a complementary pastel or neutral tone.",
        imageUrl: "/images/attire/parents-father-suit-reference.jpg"
    },
    "Best Man": {
        displayName: "Best Man",
        attireName: "Best Man attire",
        description: "Latte / taupe two-piece suit, white shirt, matching tie, no vest, and black shoes.",
        imageUrl: "/images/attire/best-man-suit-reference.jpg"
    },
    "Maid of Honour": {
        displayName: "Maid of Honour",
        attireName: "Maid of Honour attire",
        description: "Muted olive one-shoulder floor-length gown.",
        imageUrl: "/images/attire/maid-of-honour-dress-reference.jpg"
    },
    Bridesmaid: {
        displayName: "Bridesmaid",
        attireName: "Bridesmaid attire",
        description: "Floor-length A-line gown in lavender, blush, butter yellow, or sky blue.",
        imageUrl: "/images/attire/bridesmaids-dress-reference.jpg"
    },
    Groomsmen: {
        displayName: "Groomsman",
        attireName: "Groomsmen attire",
        description: "Light grey / stone two-piece suit, white undershirt, no tie, and black shoes.",
        imageUrl: "/images/attire/groomsmen-suit-reference.jpg"
    },
    Groomsman: {
        displayName: "Groomsman",
        attireName: "Groomsman attire",
        description: "Light grey / stone two-piece suit, white undershirt, no tie, and black shoes.",
        imageUrl: "/images/attire/groomsmen-suit-reference.jpg"
    },
    Ninong: {
        displayName: "Ninong",
        attireName: "Ninong attire",
        description: "Navy two-piece suit, white shirt, matching navy tie, and brown shoes.",
        imageUrl: "/images/attire/ninong-suit-reference.jpg"
    },
    "Proxy Ninong": {
        displayName: "Ninong",
        attireName: "Ninong attire",
        description: "Navy two-piece suit, white shirt, matching navy tie, and brown shoes.",
        imageUrl: "/images/attire/ninong-suit-reference.jpg"
    },
    Ninang: {
        displayName: "Ninang",
        attireName: "Ninang attire",
        description: "Dusty pink floor-length gown with off-the-shoulder sleeves.",
        imageUrl: "/images/attire/ninang-dress-reference.jpg"
    },
    "Proxy Ninang": {
        displayName: "Ninang",
        attireName: "Ninang attire",
        description: "Dusty pink floor-length gown with off-the-shoulder sleeves.",
        imageUrl: "/images/attire/ninang-dress-reference.jpg"
    },
    Guest: {
        displayName: "Wedding Guest",
        attireName: "Guest attire",
        description: "Semi-formal attire with the wedding colour theme palette.",
        imageUrl: GUEST_ATTIRE_IMAGE
    },
    "Guest - Officiant": {
        displayName: "Officiant",
        attireName: "Officiant attire",
        description: "Formal attire suitable for leading the ceremony.",
        imageUrl: "/images/attire/officiant-attire-reference.png"
    },
    "Flower Girl": {
        displayName: "Flower Girl",
        attireName: "Whimsical colour dress",
        description: "A whimsical colour dress.",
        imageUrl: "/images/attire/flower-girls-dress-reference.png"
    },
    "Ring Bearer": {
        displayName: "Ring Bearer",
        attireName: "Ring bearer attire",
        description: "A smart mini barong or suit.",
        imageUrl: "/images/attire/bearers-suit-reference.jpg"
    },
    "Bible Bearer": {
        displayName: "Bible Bearer",
        attireName: "Bible bearer attire",
        description: "A smart mini barong or suit.",
        imageUrl: "/images/attire/bearers-suit-reference.jpg"
    },
    "Coin Bearer": {
        displayName: "Coin Bearer",
        attireName: "Coin bearer attire",
        description: "A smart mini barong or suit.",
        imageUrl: "/images/attire/bearers-suit-reference.jpg"
    }
};

const nzd = new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "NZD"
});

function titleCase(value) {
    return String(value || "")
        .replaceAll("_", " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function showLogin(message = "") {
    guests = [];
    menuItems = [];
    guestList.replaceChildren();
    managerView.hidden = true;
    loginView.hidden = false;
    loginError.textContent = message;
    loginError.hidden = !message;
}

function showManager() {
    loginView.hidden = true;
    managerView.hidden = false;
}

function showMessage(message, isError = false) {
    managerMessage.textContent = message;
    managerMessage.classList.toggle("error", isError);
    managerMessage.hidden = false;
}

function hideMessage() {
    managerMessage.hidden = true;
}

function showAddGuestMessage(message, isError = false) {
    addGuestMessage.textContent = message;
    addGuestMessage.classList.toggle("error", isError);
    addGuestMessage.hidden = false;
}

function hideAddGuestMessage() {
    addGuestMessage.hidden = true;
}

async function authRequest(method, body) {
    const response = await fetch(AUTH_URL, {
        method,
        credentials: "same-origin",
        headers: {
            Accept: "application/json",
            ...(body ? { "Content-Type": "application/json" } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || "Admin authentication failed.");
    }
    return data;
}

async function apiRequest(method = "GET", body) {
    const response = await fetch(API_URL, {
        method,
        credentials: "same-origin",
        headers: {
            Accept: "application/json",
            ...(body ? { "Content-Type": "application/json" } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        if (response.status === 401) {
            showLogin("Your admin session has expired. Please log in again.");
        }
        throw new Error(data.error || "Request failed.");
    }
    return data;
}

function renderSummary(summary = {}) {
    document.getElementById("stat-total").textContent = String(summary.total || 0);
    document.getElementById("stat-attending").textContent = String(summary.attending || 0);
    document.getElementById("stat-not-attending").textContent = String(summary.notAttending || 0);
    document.getElementById("stat-pending").textContent = String(summary.pending || 0);
    document.getElementById("stat-meals").textContent = String(summary.mealSelections || 0);
    document.getElementById("report-main-count").textContent = String(summary.mainSelections || 0);
    document.getElementById("report-dessert-count").textContent = String(summary.dessertSelections || 0);
    document.getElementById("report-dietary-count").textContent = String(summary.dietaryRequirements || 0);
    document.getElementById("report-grand-total").textContent = nzd.format(summary.cateringTotal || 0);
}

function renderCateringGroup(title, items) {
    const section = document.createElement("section");
    section.className = "food-report-group";

    const heading = document.createElement("h3");
    heading.textContent = title;
    const total = document.createElement("p");
    total.textContent = `${items.reduce((sum, item) => sum + item.count, 0)} selections`;
    const header = document.createElement("header");
    header.append(heading, total);

    const grid = document.createElement("div");
    grid.className = "food-report-grid";
    items.forEach((item) => {
        const card = document.createElement("article");
        card.className = "food-report-card catering-count-card";
        const details = document.createElement("div");
        const name = document.createElement("h4");
        name.textContent = item.name;
        const price = document.createElement("p");
        price.className = "catering-price";
        price.textContent = `Unit price: ${nzd.format(item.unitPrice || 0)} · Subtotal: ${nzd.format(item.subtotal || 0)}`;
        details.append(name, price);
        const count = document.createElement("strong");
        count.textContent = String(item.count);
        count.setAttribute("aria-label", `${item.count} selections`);
        card.append(details, count);
        grid.append(card);
    });

    section.append(header, grid);
    return section;
}

function renderCatering(catering = {}) {
    cateringTotals.replaceChildren(
        renderCateringGroup("Mains", catering.mains || []),
        renderCateringGroup("Desserts", catering.desserts || [])
    );
}

function populateRoleFilter() {
    const current = roleFilter.value;
    const roles = [...new Set(guests.map((guest) => guest.role).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right));
    roleFilter.replaceChildren(new Option("All roles", ""));
    roles.forEach((role) => roleFilter.append(new Option(role, role)));
    roleFilter.value = roles.includes(current) ? current : "";
}

function roleOptionsFor(currentRole = "") {
    return [...new Set([...DEFAULT_ROLE_OPTIONS, currentRole].filter(Boolean))]
        .sort((left, right) => left.localeCompare(right));
}

function populateRoleSelect(select, selectedValue) {
    select.replaceChildren();
    roleOptionsFor(selectedValue).forEach((role) => {
        select.append(new Option(role, role));
    });
    select.value = selectedValue || "Guest";
}

function attireForRole(role, fallbackAttire) {
    return ATTIRE_BY_ROLE[role] || fallbackAttire || {
        displayName: role || "",
        attireName: role ? `${role} attire` : "No attire assigned",
        description: "Please contact the bride or groom for this guest's attire details.",
        imageUrl: null
    };
}

function updateAddAttirePreview() {
    const attire = attireForRole(addGuestRole.value);
    addAttirePreview.textContent = `Attire: ${attire.attireName}`;
}

function displayMenuName(value) {
    return String(value || "")
        .replace(/[\s]*[–—−-]\s*\d+(?:\.\d+)?\s*g\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();
}

function menuName(id) {
    return displayMenuName(menuItems.find((item) => item.id === String(id))?.name);
}

function foodPrice(id) {
    return Number(menuItems.find((item) => item.id === String(id))?.price || 0);
}

function updateFoodTotal(mainInput, dessertInput, totalOutput) {
    const value = foodPrice(mainInput.value) + foodPrice(dessertInput.value);
    totalOutput.value = nzd.format(value);
    totalOutput.textContent = totalOutput.value;
}

function itemAudience(item) {
    return String(item?.audience || "").toLowerCase() === "child" ? "child" : "adult";
}

function populateFoodSelect(select, category, selectedValue, isChild = false) {
    const audience = isChild ? "child" : "adult";
    select.replaceChildren(new Option("Not selected", ""));
    menuItems
        .filter((item) => item.category === category && itemAudience(item) === audience)
        .forEach((item) => {
            const dietaryCodes = normalizeDietaryCodes(item.dietaryCodes);
            const dietary = dietaryCodes.length ? ` · ${dietaryCodes.join("/")}` : "";
            select.append(new Option(`${displayMenuName(item.name)}${dietary} — ${nzd.format(item.price || 0)}`, item.id));
        });
    select.value = selectedValue || "";
    if (select.value !== (selectedValue || "")) {
        select.value = "";
    }
}

function normalizeDietaryCodes(value) {
  if (Array.isArray(value)) return value;

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function syncFoodFields(statusInput, mainInput, dessertInput, notesInput, dietaryInput, totalOutput) {
    const attending = statusInput.value === "attending";
    const notAttending = statusInput.value === "not_attending";
    mainInput.disabled = !attending;
    dessertInput.disabled = !attending;
    notesInput.disabled = !attending;
    dietaryInput.disabled = notAttending;
    mainInput.required = attending;
    dessertInput.required = attending;
    if (!attending) {
        mainInput.value = "";
        dessertInput.value = "";
        notesInput.value = "";
    }
    if (notAttending) {
        dietaryInput.value = "";
    }
    updateFoodTotal(mainInput, dessertInput, totalOutput);
}

function formattedResponseTime(value) {
    if (!value) {
        return "Awaiting response";
    }
    return new Intl.DateTimeFormat("en-NZ", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Pacific/Auckland"
    }).format(new Date(value));
}

function renderGuestAttire(row, guest) {
    const attire = guest.attire;
    const isGuestRole = String(guest.role || "").trim().toLowerCase() === "guest";
    const imageUrl = attire?.imageUrl || (isGuestRole ? GUEST_ATTIRE_IMAGE : "");
    const image = row.querySelector(".row-attire-image");
    const fallback = row.querySelector(".row-attire-fallback");
    const attireName = attire?.attireName || attire?.displayName
        || (isGuestRole ? "Guest attire" : "No attire assigned");
    const profileName = attire?.displayName && attire.displayName !== attireName
        ? attire.displayName
        : "";

    row.querySelector(".row-attire-name").textContent = attireName;
    row.querySelector(".row-attire-profile").textContent = profileName;
    row.querySelector(".row-attire-profile").hidden = !profileName;
    row.querySelector(".row-attire-description").textContent = attire?.description
        || "Please contact the bride or groom for this guest's attire details.";

    if (!imageUrl) {
        image.hidden = true;
        fallback.hidden = false;
        fallback.textContent = attire ? "No attire image" : "No attire assigned";
        return;
    }

    fallback.hidden = true;
    image.hidden = false;
    image.src = imageUrl;
    image.alt = `${attireName} reference for ${guest.name}`;
    image.addEventListener("error", () => {
        image.hidden = true;
        fallback.hidden = false;
        fallback.textContent = "Attire image unavailable";
    }, { once: true });
}

function renderGuests() {
    const query = guestSearch.value.trim().toLowerCase();
    const status = statusFilter.value;
    const role = roleFilter.value;
    const menuType = menuFilter.value;
    const filteredGuests = guests.filter((guest) => (
        guest.name.toLowerCase().includes(query)
        && (!status || guest.status === status)
        && (!role || guest.role === role)
        && (!menuType || (usesKidsMenu(guest) ? "child" : "adult") === menuType)
    ));

    guestList.replaceChildren();
    emptyState.hidden = filteredGuests.length > 0;

    filteredGuests.forEach((guest) => {
        const row = guestTemplate.content.firstElementChild.cloneNode(true);
        const statusInput = row.querySelector(".row-status");
        const mainInput = row.querySelector(".row-meal");
        const dessertInput = row.querySelector(".row-dessert");
        const dietaryInput = row.querySelector(".row-dietary");
        const notesInput = row.querySelector(".row-food-notes");
        const totalOutput = row.querySelector(".row-food-total");
        const nameInput = row.querySelector(".row-name");
        const roleInput = row.querySelector(".row-role");
        const childInput = row.querySelector(".row-child");
        const saveButton = row.querySelector(".save-row");
        const deleteButton = row.querySelector(".delete-row");

        row.querySelector(".guest-heading").textContent = guest.name;
        row.querySelector(".guest-meta").textContent = [
            guest.role,
            usesKidsMenu(guest) ? "Kids menu" : "Adult menu",
            titleCase(guest.status),
            guest.mainId ? menuName(guest.mainId) : "No main",
            guest.dessertId ? menuName(guest.dessertId) : "No dessert"
        ].join(" · ");
        nameInput.value = guest.name;
        populateRoleSelect(roleInput, guest.role);
        const respondedTime = row.querySelector(".row-responded");
        respondedTime.textContent = formattedResponseTime(guest.respondedAt);
        if (guest.respondedAt) {
            respondedTime.dateTime = guest.respondedAt;
        } else {
            respondedTime.removeAttribute("datetime");
        }
        renderGuestAttire(row, guest);

        statusInput.value = guest.status;
        childInput.checked = usesKidsMenu(guest);
        populateFoodSelect(mainInput, "main", guest.mainId, childInput.checked);
        populateFoodSelect(dessertInput, "dessert", guest.dessertId, childInput.checked);
        dietaryInput.value = guest.dietaryRequirements;
        notesInput.value = guest.foodNotes;
        syncFoodFields(statusInput, mainInput, dessertInput, notesInput, dietaryInput, totalOutput);

        statusInput.addEventListener("change", () => {
            syncFoodFields(statusInput, mainInput, dessertInput, notesInput, dietaryInput, totalOutput);
        });
        childInput.addEventListener("change", () => {
            const isChild = keepKidsTick(childInput, { ...guest, isChild: childInput.checked }, roleInput.value);
            row.querySelector(".guest-meta").textContent = [
                roleInput.value,
                isChild ? "Kids menu" : "Adult menu",
                titleCase(statusInput.value),
                mainInput.value ? menuName(mainInput.value) : "No main",
                dessertInput.value ? menuName(dessertInput.value) : "No dessert"
            ].join(" · ");
            populateFoodSelect(mainInput, "main", mainInput.value, isChild);
            populateFoodSelect(dessertInput, "dessert", dessertInput.value, isChild);
            updateFoodTotal(mainInput, dessertInput, totalOutput);
        });
        roleInput.addEventListener("change", () => {
            const isChild = keepKidsTick(childInput, { ...guest, isChild: childInput.checked }, roleInput.value);
            populateFoodSelect(mainInput, "main", mainInput.value, isChild);
            populateFoodSelect(dessertInput, "dessert", dessertInput.value, isChild);
            updateFoodTotal(mainInput, dessertInput, totalOutput);
            renderGuestAttire(row, {
                ...guest,
                role: roleInput.value,
                attire: attireForRole(roleInput.value, guest.attire)
            });
        });
        mainInput.addEventListener("change", () => updateFoodTotal(mainInput, dessertInput, totalOutput));
        dessertInput.addEventListener("change", () => updateFoodTotal(mainInput, dessertInput, totalOutput));

        saveButton.addEventListener("click", async () => {
            try {
                hideMessage();
                const fullName = nameInput.value.trim().replace(/\s+/g, " ");
                if (fullName.length < 2 || fullName.length > 160) {
                    throw new Error("Guest name must be between 2 and 160 characters.");
                }
                if (!roleInput.value) {
                    throw new Error("Choose a guest role.");
                }
                saveButton.disabled = true;
                saveButton.textContent = "Saving…";
                await apiRequest("PUT", {
                    id: guest.id,
                    name: fullName,
                    role: roleInput.value,
                    isChild: keepKidsTick(childInput, { ...guest, isChild: childInput.checked }, roleInput.value),
                    status: statusInput.value,
                    mainId: mainInput.value || null,
                    dessertId: dessertInput.value || null,
                    dietaryRequirements: dietaryInput.value,
                    foodNotes: notesInput.value
                });
                showMessage(`${guest.name}'s RSVP was updated.`);
                await loadGuests();
            } catch (error) {
                showMessage(error.message, true);
                saveButton.disabled = false;
                saveButton.textContent = "Save";
            }
        });

        deleteButton.addEventListener("click", async () => {
            const confirmed = window.confirm(`Remove ${guest.name} from the guest list? This cannot be undone.`);
            if (!confirmed) return;

            try {
                hideMessage();
                deleteButton.disabled = true;
                saveButton.disabled = true;
                deleteButton.textContent = "Deleting...";
                await apiRequest("DELETE", { id: guest.id });
                showMessage(`${guest.name} was removed from the guest list.`);
                await loadGuests();
            } catch (error) {
                showMessage(error.message, true);
                deleteButton.disabled = false;
                saveButton.disabled = false;
                deleteButton.textContent = "Delete";
            }
        });

        guestList.append(row);
    });
}

async function loadGuests() {
    const data = await apiRequest();
    guests = Array.isArray(data.guests) ? data.guests : [];
    menuItems = Array.isArray(data.menu) ? data.menu : [];
    renderSummary(data.summary);
    renderCatering(data.catering);
    populateRoleFilter();
    renderGuests();
}

function reportFilename(response, format) {
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^";]+)"?/i);
    return match?.[1] || `food-orders.${format}`;
}

function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    link.hidden = true;
    document.body.append(link);
    link.click();
    window.setTimeout(() => {
        link.remove();
        URL.revokeObjectURL(url);
    }, 60_000);
}

async function assertDownloadBlob(blob, format) {
    const header = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
    const signature = String.fromCharCode(...header);

    if (format === "pdf" && !signature.startsWith("%PDF-")) {
        throw new Error("The PDF report could not be downloaded. Please try again.");
    }
    if (format === "xlsx" && signature.slice(0, 2) !== "PK") {
        throw new Error("The Excel report could not be downloaded. Please try again.");
    }
}

async function downloadFoodReport(format, button) {
    const originalLabel = button.textContent;
    try {
        hideMessage();
        button.disabled = true;
        button.textContent = "Preparing…";
        const response = await fetch(`${FOOD_REPORT_URL}?format=${format}`, {
            credentials: "same-origin",
            headers: {
                Accept: format === "pdf"
                    ? "application/pdf"
                    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            }
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            if (response.status === 401) {
                showLogin("Your admin session has expired. Please log in again.");
            }
            throw new Error(error.error || "The food report could not be downloaded.");
        }
        const blob = await response.blob();
        await assertDownloadBlob(blob, format);
        saveBlob(blob, reportFilename(response, format));
        showMessage(`${format === "pdf" ? "PDF" : "Excel"} food report downloaded.`);
    } catch (error) {
        showMessage(error.message, true);
    } finally {
        button.disabled = false;
        button.textContent = originalLabel;
    }
}

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginError.hidden = true;
    const password = passwordInput.value;
    passwordInput.value = "";
    try {
        await authRequest("POST", { password });
        await loadGuests();
        showManager();
    } catch (error) {
        showLogin(error.message);
        passwordInput.focus();
    }
});

logoutButton.addEventListener("click", async () => {
    await authRequest("DELETE").catch(() => {});
    showLogin();
    passwordInput.focus();
});

addGuestForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideAddGuestMessage();
    const fullName = addGuestName.value.trim().replace(/\s+/g, " ");

    try {
        if (fullName.length < 2 || fullName.length > 160) {
            throw new Error("Guest name must be between 2 and 160 characters.");
        }
        if (!addGuestRole.value) {
            throw new Error("Choose a guest role.");
        }

        addGuestButton.disabled = true;
        addGuestButton.textContent = "Adding…";
        await apiRequest("POST", {
            name: fullName,
            role: addGuestRole.value,
            isChild: keepKidsTick(addGuestChild, { isChild: addGuestChild.checked }, addGuestRole.value)
        });

        addGuestName.value = "";
        populateRoleSelect(addGuestRole, "Guest");
        addGuestChild.checked = false;
        updateAddAttirePreview();
        guestSearch.value = fullName;
        statusFilter.value = "";
        roleFilter.value = "";
        menuFilter.value = "";
        await loadGuests();
        showAddGuestMessage(`${fullName} was added to the guest list.`);
    } catch (error) {
        showAddGuestMessage(error.message, true);
    } finally {
        addGuestButton.disabled = false;
        addGuestButton.textContent = "Add invitee";
    }
});

function syncAddChildFromRole() {
    keepKidsTick(addGuestChild, { isChild: addGuestChild.checked }, addGuestRole.value);
}

addGuestRole.addEventListener("change", () => {
    syncAddChildFromRole();
    updateAddAttirePreview();
});
addGuestChild.addEventListener("change", syncAddChildFromRole);

[guestSearch, statusFilter, roleFilter, menuFilter].forEach((control) => {
    control.addEventListener(control === guestSearch ? "input" : "change", renderGuests);
});
downloadFoodPdf.addEventListener("click", () => downloadFoodReport("pdf", downloadFoodPdf));
downloadFoodExcel.addEventListener("click", () => downloadFoodReport("xlsx", downloadFoodExcel));

populateRoleSelect(addGuestRole, "Guest");
updateAddAttirePreview();

authRequest("GET")
    .then(loadGuests)
    .then(showManager)
    .catch(() => showLogin());
