const API_URL = "/.netlify/functions/manageGuests";

const loginView = document.getElementById("login-view");
const managerView = document.getElementById("manager-view");
const loginForm = document.getElementById("login-form");
const passwordInput = document.getElementById("admin-password");
const loginError = document.getElementById("login-error");
const logoutButton = document.getElementById("logout-button");
const addCodeForm = document.getElementById("add-code-form");
const newNamesInput = document.getElementById("new-names");
const guestSearch = document.getElementById("guest-search");
const guestList = document.getElementById("guest-list");
const guestTemplate = document.getElementById("guest-row-template");
const managerMessage = document.getElementById("manager-message");
const emptyState = document.getElementById("empty-state");
const statTotal = document.getElementById("stat-total");
const statAttending = document.getElementById("stat-attending");
const statDeclined = document.getElementById("stat-declined");
const statPending = document.getElementById("stat-pending");

let adminPassword = "";
let guests = [];

function updateStats() {
    const attending = guests.filter(
        (guest) => guest.status.toLowerCase() === "attending"
    ).length;
    const declined = guests.filter(
        (guest) => guest.status.toLowerCase() === "declined"
    ).length;
    const total = guests.length;
    const pending = Math.max(total - attending - declined, 0);

    statTotal.textContent = String(total);
    statAttending.textContent = String(attending);
    statDeclined.textContent = String(declined);
    statPending.textContent = String(pending);
}

async function apiRequest(method = "GET", body) {
    const response = await fetch(API_URL, {
        method,
        headers: {
            Authorization: `Bearer ${adminPassword}`,
            ...(body ? { "Content-Type": "application/json" } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
    });

    const data = await response.json();

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

function renderGuests() {
    const query = guestSearch.value.trim().toLowerCase();
    const filteredGuests = guests.filter((guest) =>
        [guest.code, guest.name, guest.status].some((value) =>
            String(value).toLowerCase().includes(query)
        )
    );

    guestList.replaceChildren();
    emptyState.hidden = filteredGuests.length > 0;

    filteredGuests.forEach((guest) => {
        const row = guestTemplate.content.firstElementChild.cloneNode(true);
        const codeInput = row.querySelector(".row-code");
        const nameInput = row.querySelector(".row-name");
        const statusInput = row.querySelector(".row-status");

        codeInput.value = guest.code;
        nameInput.value = guest.name;
        statusInput.value = guest.status;

        row.querySelector(".save-row").addEventListener("click", async () => {
            try {
                hideMessage();
                await apiRequest("PUT", {
                    row: guest.row,
                    code: codeInput.value,
                    name: nameInput.value,
                    status: statusInput.value
                });
                showMessage("Guest updated.");
                await loadGuests();
            } catch (error) {
                showMessage(error.message, true);
            }
        });

        row.querySelector(".delete-row").addEventListener("click", async () => {
            if (!window.confirm(`Delete ${guest.name} from invitation ${guest.code}?`)) {
                return;
            }

            try {
                hideMessage();
                await apiRequest("DELETE", { row: guest.row });
                showMessage("Guest deleted.");
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
    updateStats();
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
    updateStats();
    guestList.replaceChildren();
    managerView.hidden = true;
    loginView.hidden = false;
    passwordInput.focus();
});

addCodeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const names = newNamesInput.value
        .split(/[,\r\n]+/)
        .map((name) => name.trim())
        .filter(Boolean);

    try {
        hideMessage();
        const result = await apiRequest("POST", { names });
        addCodeForm.reset();
        showMessage(`Invitation ${result.code} added for ${names.length} guest${names.length === 1 ? "" : "s"}.`);
        await loadGuests();
    } catch (error) {
        showMessage(error.message, true);
    }
});

guestSearch.addEventListener("input", renderGuests);
