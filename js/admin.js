const API_URL = "/.netlify/functions/manageGuests";
const FOOD_REPORT_URL = "/.netlify/functions/exportFoodReport";

const loginView = document.getElementById("login-view");
const managerView = document.getElementById("manager-view");
const loginForm = document.getElementById("login-form");
const passwordInput = document.getElementById("admin-password");
const loginError = document.getElementById("login-error");
const logoutButton = document.getElementById("logout-button");
const addGuestForm = document.getElementById("add-guest-form");
const guestSearch = document.getElementById("guest-search");
const guestList = document.getElementById("guest-list");
const guestTemplate = document.getElementById("guest-row-template");
const managerMessage = document.getElementById("manager-message");
const emptyState = document.getElementById("empty-state");
const statTotal = document.getElementById("stat-total");
const statAttending = document.getElementById("stat-attending");
const statDeclined = document.getElementById("stat-declined");
const statPending = document.getElementById("stat-pending");
const reportMainCount = document.getElementById("report-main-count");
const reportDessertCount = document.getElementById("report-dessert-count");
const reportGrandTotal = document.getElementById("report-grand-total");
const downloadFoodPdf = document.getElementById("download-food-pdf");
const downloadFoodExcel = document.getElementById("download-food-excel");

let adminPassword = "";
let guests = [];
let menuItems = [];

const nzd = new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "NZD"
});

function titleCase(value) {
    return String(value || "")
        .replaceAll("_", " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function updateStats() {
    const count = (status) => guests.filter((guest) => guest.status === status).length;
    statTotal.textContent = String(guests.length);
    statAttending.textContent = String(count("attending"));
    statDeclined.textContent = String(count("declined"));
    statPending.textContent = String(count("pending"));
}

function renderFoodReport() {
    const attending = guests.filter((guest) => guest.status === "attending");
    const mainCount = attending.filter((guest) => guest.mealChoice).length;
    const dessertCount = attending.filter((guest) => guest.dessertChoice).length;
    const grandTotal = attending.reduce(
        (total, guest) => total + foodPrice(guest.mealChoice) + foodPrice(guest.dessertChoice),
        0
    );

    reportMainCount.textContent = String(mainCount);
    reportDessertCount.textContent = String(dessertCount);
    reportGrandTotal.textContent = nzd.format(grandTotal);
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
    link.style.display = "none";
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
            headers: {
                Accept: format === "pdf"
                    ? "application/pdf"
                    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                Authorization: `Bearer ${adminPassword}`
            }
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
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

async function apiRequest(method = "GET", body) {
    const response = await fetch(API_URL, {
        method,
        headers: {
            Accept: "application/json",
            Authorization: `Bearer ${adminPassword}`,
            ...(body ? { "Content-Type": "application/json" } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || "Request failed.");
    }
    return data;
}

function showMessage(message, isError = false) {
    managerMessage.textContent = message;
    managerMessage.classList.toggle("error", isError);
    managerMessage.hidden = false;
}

function hideMessage() {
    managerMessage.hidden = true;
}

function populateFoodSelect(select, category, selectedValue) {
    select.replaceChildren();
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "Not selected";
    select.append(emptyOption);

    menuItems
        .filter((item) => item.category === category)
        .forEach((item) => {
            const option = document.createElement("option");
            const dietary = item.dietaryCodes?.length ? ` · ${item.dietaryCodes.join("/")}` : "";
            option.value = item.slug;
            option.textContent = `${item.name}${dietary} — ${nzd.format(item.price)}`;
            select.append(option);
        });

    select.value = selectedValue || "";
}

function foodPrice(slug) {
    return Number(menuItems.find((item) => item.slug === slug)?.price || 0);
}

function updateFoodTotal(mealInput, dessertInput, totalOutput) {
    totalOutput.value = nzd.format(foodPrice(mealInput.value) + foodPrice(dessertInput.value));
    totalOutput.textContent = totalOutput.value;
}

function syncFoodFields(statusInput, mealInput, dessertInput, totalOutput) {
    const attending = statusInput.value === "attending";
    mealInput.disabled = !attending;
    dessertInput.disabled = !attending;
    if (!attending) {
        mealInput.value = "";
        dessertInput.value = "";
    }
    updateFoodTotal(mealInput, dessertInput, totalOutput);
}

function renderGuests() {
    const query = guestSearch.value.trim().toLowerCase();
    const filteredGuests = guests.filter((guest) =>
        [guest.invitationCode, guest.name, guest.role, guest.status, guest.mealChoice, guest.dessertChoice]
            .some((value) => String(value || "").toLowerCase().includes(query))
    );

    guestList.replaceChildren();
    emptyState.hidden = filteredGuests.length > 0;

    filteredGuests.forEach((guest) => {
        const row = guestTemplate.content.firstElementChild.cloneNode(true);
        const nameInput = row.querySelector(".row-name");
        const roleInput = row.querySelector(".row-role");
        const codeInput = row.querySelector(".row-code");
        const statusInput = row.querySelector(".row-status");
        const mealInput = row.querySelector(".row-meal");
        const dessertInput = row.querySelector(".row-dessert");
        const foodTotal = row.querySelector(".row-food-total");
        const attireTitleInput = row.querySelector(".row-attire-title");
        const attireDescriptionInput = row.querySelector(".row-attire-description");
        const dietaryInput = row.querySelector(".row-dietary");
        const saveButton = row.querySelector(".save-row");

        row.querySelector(".guest-heading").textContent = guest.name;
        row.querySelector(".guest-meta").textContent = guest.respondedAt
            ? `${titleCase(guest.status)} · responded ${new Date(guest.respondedAt).toLocaleDateString()}`
            : `${titleCase(guest.status)} · awaiting response`;

        nameInput.value = guest.name;
        roleInput.value = guest.role;
        codeInput.value = guest.invitationCode;
        statusInput.value = guest.status;
        populateFoodSelect(mealInput, "main", guest.mealChoice);
        populateFoodSelect(dessertInput, "dessert", guest.dessertChoice);
        attireTitleInput.value = guest.attireTitle || "";
        attireDescriptionInput.value = guest.attireDescription || "";
        dietaryInput.value = guest.dietaryRequirements || "";
        mealInput.disabled = statusInput.value !== "attending";
        dessertInput.disabled = statusInput.value !== "attending";
        updateFoodTotal(mealInput, dessertInput, foodTotal);

        statusInput.addEventListener("change", () => syncFoodFields(statusInput, mealInput, dessertInput, foodTotal));
        mealInput.addEventListener("change", () => updateFoodTotal(mealInput, dessertInput, foodTotal));
        dessertInput.addEventListener("change", () => updateFoodTotal(mealInput, dessertInput, foodTotal));

        saveButton.addEventListener("click", async () => {
            try {
                hideMessage();
                saveButton.disabled = true;
                saveButton.textContent = "Saving…";
                await apiRequest("PUT", {
                    id: guest.id,
                    name: nameInput.value,
                    role: roleInput.value,
                    invitationCode: codeInput.value,
                    status: statusInput.value,
                    mealChoice: mealInput.value || null,
                    dessertChoice: dessertInput.value || null,
                    attireTitle: attireTitleInput.value,
                    attireDescription: attireDescriptionInput.value,
                    dietaryRequirements: dietaryInput.value,
                    palette: guest.palette
                });
                showMessage(`${nameInput.value.trim()} was updated.`);
                await loadGuests();
            } catch (error) {
                showMessage(error.message, true);
                saveButton.disabled = false;
                saveButton.textContent = "Save";
            }
        });

        row.querySelector(".delete-row").addEventListener("click", async () => {
            if (!window.confirm(`Delete ${guest.name} from the guest list? This cannot be undone.`)) {
                return;
            }

            try {
                hideMessage();
                await apiRequest("DELETE", { id: guest.id });
                showMessage(`${guest.name} was deleted.`);
                await loadGuests();
            } catch (error) {
                showMessage(error.message, true);
            }
        });

        guestList.append(row);
    });
}

async function loadGuests() {
    const data = await apiRequest();
    guests = data.guests;
    menuItems = data.menu || [];
    updateStats();
    renderFoodReport();
    renderGuests();
}

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    adminPassword = passwordInput.value;
    loginError.hidden = true;

    try {
        await loadGuests();
        loginView.hidden = true;
        managerView.hidden = false;
        passwordInput.value = "";
    } catch (error) {
        adminPassword = "";
        loginError.textContent = error.message;
        loginError.hidden = false;
        passwordInput.select();
    }
});

logoutButton.addEventListener("click", () => {
    adminPassword = "";
    guests = [];
    menuItems = [];
    guestList.replaceChildren();
    managerView.hidden = true;
    loginView.hidden = false;
    passwordInput.focus();
});

addGuestForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = addGuestForm.querySelector('button[type="submit"]');
    const formData = new FormData(addGuestForm);

    try {
        hideMessage();
        submitButton.disabled = true;
        submitButton.textContent = "Adding guest…";
        const result = await apiRequest("POST", Object.fromEntries(formData));
        addGuestForm.reset();
        showMessage(`${result.guest.name} was added with group code ${result.guest.invitationCode}.`);
        await loadGuests();
    } catch (error) {
        showMessage(error.message, true);
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = "Add guest";
    }
});

guestSearch.addEventListener("input", renderGuests);
downloadFoodPdf.addEventListener("click", () => downloadFoodReport("pdf", downloadFoodPdf));
downloadFoodExcel.addEventListener("click", () => downloadFoodReport("xlsx", downloadFoodExcel));
