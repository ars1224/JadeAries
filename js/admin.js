const API_URL = "/.netlify/functions/manageGuests";
const AUTH_URL = "/.netlify/functions/admin-auth";
const FOOD_REPORT_URL = "/.netlify/functions/exportFoodReport";

const loginView = document.getElementById("login-view");
const managerView = document.getElementById("manager-view");
const loginForm = document.getElementById("login-form");
const passwordInput = document.getElementById("admin-password");
const loginError = document.getElementById("login-error");
const logoutButton = document.getElementById("logout-button");
const guestSearch = document.getElementById("guest-search");
const statusFilter = document.getElementById("status-filter");
const roleFilter = document.getElementById("role-filter");
const guestList = document.getElementById("guest-list");
const guestTemplate = document.getElementById("guest-row-template");
const managerMessage = document.getElementById("manager-message");
const emptyState = document.getElementById("empty-state");
const cateringTotals = document.getElementById("catering-totals");
const downloadFoodPdf = document.getElementById("download-food-pdf");
const downloadFoodExcel = document.getElementById("download-food-excel");

let guests = [];
let menuItems = [];

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
        const name = document.createElement("h4");
        name.textContent = item.name;
        const count = document.createElement("strong");
        count.textContent = String(item.count);
        count.setAttribute("aria-label", `${item.count} selections`);
        card.append(name, count);
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

function menuName(id) {
    return menuItems.find((item) => item.id === String(id))?.name || "";
}

function populateFoodSelect(select, category, selectedValue) {
    select.replaceChildren(new Option("Not selected", ""));
    menuItems
        .filter((item) => item.category === category)
        .forEach((item) => {
            const dietaryCodes = normalizeDietaryCodes(item.dietaryCodes);
            const dietary = dietaryCodes.length ? ` · ${dietaryCodes.join("/")}` : "";
            select.append(new Option(`${item.name}${dietary}`, item.id));
        });
    select.value = selectedValue || "";
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

function syncFoodFields(statusInput, mainInput, dessertInput, notesInput, dietaryInput) {
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

function renderGuests() {
    const query = guestSearch.value.trim().toLowerCase();
    const status = statusFilter.value;
    const role = roleFilter.value;
    const filteredGuests = guests.filter((guest) => (
        guest.name.toLowerCase().includes(query)
        && (!status || guest.status === status)
        && (!role || guest.role === role)
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
        const saveButton = row.querySelector(".save-row");

        row.querySelector(".guest-heading").textContent = guest.name;
        row.querySelector(".guest-meta").textContent = [
            guest.role,
            titleCase(guest.status),
            guest.mainId ? menuName(guest.mainId) : "No main",
            guest.dessertId ? menuName(guest.dessertId) : "No dessert"
        ].join(" · ");
        row.querySelector(".row-name").textContent = guest.name;
        row.querySelector(".row-role").textContent = guest.role;
        const respondedTime = row.querySelector(".row-responded");
        respondedTime.textContent = formattedResponseTime(guest.respondedAt);
        if (guest.respondedAt) {
            respondedTime.dateTime = guest.respondedAt;
        } else {
            respondedTime.removeAttribute("datetime");
        }

        statusInput.value = guest.status;
        populateFoodSelect(mainInput, "main", guest.mainId);
        populateFoodSelect(dessertInput, "dessert", guest.dessertId);
        dietaryInput.value = guest.dietaryRequirements;
        notesInput.value = guest.foodNotes;
        syncFoodFields(statusInput, mainInput, dessertInput, notesInput, dietaryInput);

        statusInput.addEventListener("change", () => {
            syncFoodFields(statusInput, mainInput, dessertInput, notesInput, dietaryInput);
        });

        saveButton.addEventListener("click", async () => {
            try {
                hideMessage();
                saveButton.disabled = true;
                saveButton.textContent = "Saving…";
                await apiRequest("PUT", {
                    id: guest.id,
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

[guestSearch, statusFilter, roleFilter].forEach((control) => {
    control.addEventListener(control === guestSearch ? "input" : "change", renderGuests);
});
downloadFoodPdf.addEventListener("click", () => downloadFoodReport("pdf", downloadFoodPdf));
downloadFoodExcel.addEventListener("click", () => downloadFoodReport("xlsx", downloadFoodExcel));

authRequest("GET")
    .then(loadGuests)
    .then(showManager)
    .catch(() => showLogin());
