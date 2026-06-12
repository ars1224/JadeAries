const weddingDate = new Date("2026-12-19T16:00:00+13:00");
const units = ["days", "hours", "minutes", "seconds"];
const menuToggle = document.querySelector(".menu-toggle");
const mainNavigation = document.getElementById("main-navigation");

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

const guestList = {
    ARS123: {
        names: ["Aries Tayao", "Charmnie Gulay"],
        maxSeats: 2
    },
    FAM001: {
        names: ["Juan Dela Cruz", "Maria Dela Cruz", "Pedro Dela Cruz"],
        maxSeats: 3
    },
    SOLO01: {
        names: ["Aileen David"],
        maxSeats: 1
    }
};

const rsvpForm = document.getElementById("rsvp-form");
const codeInput = document.getElementById("rsvp-code");
const validateCodeButton = document.getElementById("validate-code");
const changeCodeButton = document.getElementById("change-code");
const codeStep = document.getElementById("code-step");
const guestStep = document.getElementById("guest-step");
const guestCheckboxes = document.getElementById("guest-checkboxes");
const seatSummary = document.getElementById("seat-summary");
const codeError = document.getElementById("code-error");

const hiddenFields = {
    code: document.getElementById("rsvp-code-field"),
    invitedNames: document.getElementById("invited-names-field"),
    attendingNames: document.getElementById("attending-names-field"),
    attendingCount: document.getElementById("attending-count-field"),
    attendanceStatus: document.getElementById("attendance-status-field")
};

let activeInvitation = null;

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
    hiddenFields.code.value = code;
    hiddenFields.invitedNames.value = invitation.names.join(", ");
}

function validateInvitationCode() {
    const code = normalizeCode(codeInput.value);
    const invitation = guestList[code];

    clearCodeError();

    if (!invitation) {
        showCodeError("We could not find that invitation code. Please check it and try again.");
        return;
    }

    activeInvitation = invitation;
    codeInput.value = code;
    renderGuestOptions(code, invitation);
    codeStep.hidden = true;
    guestStep.hidden = false;
    guestStep.querySelector("input")?.focus();
}

function resetInvitationCode() {
    activeInvitation = null;
    rsvpForm.reset();
    guestCheckboxes.replaceChildren();
    Object.values(hiddenFields).forEach((field) => {
        field.value = "";
    });
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

rsvpForm.addEventListener("submit", (event) => {
    if (!activeInvitation) {
        event.preventDefault();
        showCodeError("Please enter and validate your invitation code first.");
        return;
    }

    const selectedNames = Array.from(
        guestCheckboxes.querySelectorAll('input[type="checkbox"]:checked'),
        (checkbox) => checkbox.value
    );

    const attendingCount = Math.min(selectedNames.length, activeInvitation.maxSeats);
    hiddenFields.attendingNames.value = selectedNames.slice(0, attendingCount).join(", ");
    hiddenFields.attendingCount.value = String(attendingCount);
    hiddenFields.attendanceStatus.value = attendingCount > 0 ? "attending" : "declined";
});
