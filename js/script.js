const weddingDate = new Date("2026-12-19T16:00:00+13:00");
const units = ["days", "hours", "minutes", "seconds"];

const menuToggle = document.querySelector(".menu-toggle");
const mainNavigation = document.getElementById("main-navigation");

const rsvpForm = document.getElementById("rsvp-form");
const codeInput = document.getElementById("rsvp-code");
const validateCodeButton = document.getElementById("validate-code");
const changeCodeButton = document.getElementById("change-code");
const codeStep = document.getElementById("code-step");
const guestStep = document.getElementById("guest-step");
const guestCheckboxes = document.getElementById("guest-checkboxes");
const seatSummary = document.getElementById("seat-summary");
const codeError = document.getElementById("code-error");

let activeInvitation = null;

function closeNavigation() {
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Open navigation");
    mainNavigation.classList.remove("is-open");
}

menuToggle.addEventListener("click", () => {
    const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
    menuToggle.setAttribute("aria-expanded", String(!isOpen));
    menuToggle.setAttribute("aria-label", isOpen ? "Open navigation" : "Close navigation");
    mainNavigation.classList.toggle("is-open", !isOpen);
});

mainNavigation.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", closeNavigation);
});

window.addEventListener("resize", () => {
    if (window.innerWidth > 760) {
        closeNavigation();
    }
});

function updateCountdown() {
    const remaining = Math.max(weddingDate.getTime() - Date.now(), 0);

    const values = {
        days: Math.floor(remaining / 86_400_000),
        hours: Math.floor((remaining % 86_400_000) / 3_600_000),
        minutes: Math.floor((remaining % 3_600_000) / 60_000),
        seconds: Math.floor((remaining % 60_000) / 1_000)
    };

    units.forEach((unit) => {
        document.getElementById(unit).textContent = values[unit];
    });
}

updateCountdown();
setInterval(updateCountdown, 1_000);

function normalizeCode(value) {
    return value.trim().toUpperCase();
}

function showCodeError(message) {
    codeError.textContent = message;
    codeError.hidden = false;
    codeInput.setAttribute("aria-invalid", "true");
    codeInput.focus();
}

function clearCodeError() {
    codeError.textContent = "";
    codeError.hidden = true;
    codeInput.removeAttribute("aria-invalid");
}

function renderGuestOptions(code, invitation) {
    guestCheckboxes.replaceChildren();

    invitation.names.forEach((name, index) => {
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        const labelText = document.createElement("span");

        label.className = "guest-option";
        checkbox.type = "checkbox";
        checkbox.value = name;
        checkbox.id = `guest-${index}`;
        labelText.textContent = name;

        label.append(checkbox, labelText);
        guestCheckboxes.append(label);
    });

    const seatWord = invitation.maxSeats === 1 ? "seat" : "seats";
    seatSummary.textContent = `This invitation includes up to ${invitation.maxSeats} ${seatWord}.`;
}

async function validateInvitationCode() {
    const code = normalizeCode(codeInput.value);

    clearCodeError();

    if (!code) {
        showCodeError("Please enter your invitation code.");
        return;
    }

    try {
        validateCodeButton.textContent = "Checking...";
        validateCodeButton.disabled = true;

        const response = await fetch(`/.netlify/functions/getGuests?code=${encodeURIComponent(code)}`);
        const data = await response.json();

        if (!response.ok) {
            showCodeError(data.error || "Invitation code not found.");
            return;
        }

        activeInvitation = {
            code: data.code,
            names: data.guests.map((guest) => guest.name),
            maxSeats: data.guests.length
        };

        codeInput.value = data.code;
        renderGuestOptions(data.code, activeInvitation);

        codeStep.hidden = true;
        guestStep.hidden = false;
        guestStep.querySelector("input")?.focus();
    } catch (error) {
        showCodeError("Something went wrong. Please try again.");
    } finally {
        validateCodeButton.textContent = "Find Invitation";
        validateCodeButton.disabled = false;
    }
}

function resetInvitationCode() {
    activeInvitation = null;
    rsvpForm.reset();
    guestCheckboxes.replaceChildren();

    guestStep.hidden = true;
    codeStep.hidden = false;

    clearCodeError();
    codeInput.focus();
}

validateCodeButton.addEventListener("click", validateInvitationCode);

codeInput.addEventListener("input", () => {
    codeInput.value = codeInput.value.toUpperCase();
    clearCodeError();
});

codeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        event.preventDefault();
        validateInvitationCode();
    }
});

changeCodeButton.addEventListener("click", resetInvitationCode);

rsvpForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!activeInvitation) {
        showCodeError("Please enter and validate your invitation code first.");
        return;
    }

    const selectedNames = Array.from(
        guestCheckboxes.querySelectorAll('input[type="checkbox"]:checked'),
        (checkbox) => checkbox.value
    );

    const submitButton = rsvpForm.querySelector('button[type="submit"]');

    try {
        submitButton.textContent = "Sending...";
        submitButton.disabled = true;

        const response = await fetch("/.netlify/functions/updateRsvp", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                code: activeInvitation.code,
                attendingGuests: selectedNames
            })
        });

        const data = await response.json();

        if (!response.ok) {
            alert(data.error || "Could not save RSVP.");
            submitButton.textContent = "Send RSVP";
            submitButton.disabled = false;
            return;
        }

        guestStep.innerHTML = `
            <p class="eyebrow">Thank you</p>
            <h3>Your RSVP has been received.</h3>
            <p class="form-help">We are grateful for your response.</p>
        `;
    } catch (error) {
        alert("Something went wrong. Please try again.");
        submitButton.textContent = "Send RSVP";
        submitButton.disabled = false;
    }
});