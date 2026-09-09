const API = {
    findGuest: "/.netlify/functions/find-guest",
    getMenu: "/.netlify/functions/get-menu",
    submitRsvp: "/.netlify/functions/submit-rsvp"
};

const screens = new Map(
    Array.from(document.querySelectorAll("[data-screen]")).map((screen) => [screen.dataset.screen, screen])
);
const lookupForm = document.getElementById("lookup-form");
const guestNameInput = document.getElementById("guest-name");
const lookupButton = document.getElementById("lookup-button");
const lookupError = document.getElementById("lookup-error");
const attendanceError = document.getElementById("attendance-error");
const mealForm = document.getElementById("meal-form");
const mealError = document.getElementById("meal-error");
const saveRsvpButton = document.getElementById("save-rsvp-button");
const savingOverlay = document.getElementById("saving-overlay");

let activeGuest = null;
let menuById = new Map();
let successReturnTimer = null;
let submissionInProgress = false;

function returnToLookup() {
    activeGuest = null;
    lookupForm.reset();
    clearInlineError(lookupError);
    showScreen("lookup", "input");
}

function stopSuccessReturn() {
    window.clearInterval(successReturnTimer);
    successReturnTimer = null;
}

function startSuccessReturn() {
    stopSuccessReturn();

    const note = document.getElementById("success-return-note");
    let remaining = 30;

    const renderNote = () => {
        if (!note) {
            return;
        }

        note.textContent = remaining === 1
            ? "Returning to Find your name in 1 second."
            : `Returning to Find your name in ${remaining} seconds.`;
    };

    renderNote();
    successReturnTimer = window.setInterval(() => {
        remaining -= 1;

        if (remaining <= 0) {
            stopSuccessReturn();
            returnToLookup();
            return;
        }

        renderNote();
    }, 1000);
}

function normalizeName(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
}

function setLoading(button, loading, loadingLabel, defaultLabel) {
    button.disabled = loading;
    button.textContent = loading ? loadingLabel : defaultLabel;
}

function showInlineError(element, message) {
    element.textContent = message;
    element.hidden = false;
}

function clearInlineError(element) {
    element.textContent = "";
    element.hidden = true;
}

function createMenuOption(item, fieldName) {
    const label = document.createElement("label");
    label.className = "choice-card meal-option";

    const input = document.createElement("input");
    input.type = "radio";
    input.name = fieldName;
    input.value = item.id;

    const radioMark = document.createElement("span");
    radioMark.className = "radio-mark";
    radioMark.setAttribute("aria-hidden", "true");

    const photo = document.createElement("span");
    photo.className = "menu-option-photo";
    photo.setAttribute("aria-hidden", "true");

    if (item.imageUrl) {
        const image = document.createElement("img");
        image.src = item.imageUrl;
        image.alt = "";
        image.loading = "lazy";
        photo.append(image);
    }

    const copy = document.createElement("span");
    copy.className = "menu-option-copy";

    const name = document.createElement("strong");
    name.textContent = item.name;

    const description = document.createElement("span");
    description.className = "menu-option-description";
    description.textContent = item.description;

    const dietaryCodes = document.createElement("small");
    dietaryCodes.className = "dietary-codes";
    const dietary = Array.isArray(item.dietaryRestrictions)
        ? item.dietaryRestrictions.join(" · ")
        : String(item.dietaryRestrictions || "").trim();
    dietaryCodes.textContent = dietary ? `Dietary: ${dietary}` : "No dietary information listed";

    copy.append(name, description, dietaryCodes);
    label.append(input, photo, radioMark, copy);
    return label;
}

function renderMenu(menu) {
    const mains = Array.isArray(menu?.mains) ? menu.mains : [];
    const desserts = Array.isArray(menu?.desserts) ? menu.desserts : [];
    const allItems = [...mains, ...desserts];
    menuById = new Map(allItems.map((item) => [String(item.id), item]));

    const mainOptions = document.getElementById("main-menu-options");
    const dessertOptions = document.getElementById("dessert-menu-options");
    mainOptions.replaceChildren();
    dessertOptions.replaceChildren();

    mains.forEach((item) => mainOptions.append(createMenuOption(item, "meal")));
    desserts.forEach((item) => dessertOptions.append(createMenuOption(item, "dessert")));
}

function menuName(id) {
    return menuById.get(String(id))?.name || "chosen";
}

function fillConfirmedDish(kind, id) {
    const item = menuById.get(String(id));
    const name = document.getElementById(`success-${kind}`);
    const image = document.getElementById(`success-${kind}-image`);
    const frame = image?.closest(".confirmed-dish");

    name.textContent = item?.name || menuName(id);

    if (!image) {
        return;
    }

    if (item?.imageUrl) {
        image.src = item.imageUrl;
        image.alt = item.name;
        if (frame) {
            frame.hidden = false;
        }
        return;
    }

    image.removeAttribute("src");
    image.alt = "";
    if (frame) {
        frame.hidden = true;
    }
}

function showScreen(name, focusSelector) {
    stopSuccessReturn();

    screens.forEach((screen, screenName) => {
        screen.hidden = screenName !== name;
        if (screenName === name) {
            screen.scrollTop = 0;
        }
    });

    const stepMap = {
        lookup: "find",
        "not-found": "find",
        dashboard: "invite",
        meal: "rsvp",
        success: "done",
        declined: "done"
    };
    const order = ["find", "welcome", "invite", "rsvp", "done"];
    const currentStep = stepMap[name] || "find";
    const currentIndex = order.indexOf(currentStep);

    document.querySelectorAll(".app-progress li").forEach((item) => {
        const itemIndex = order.indexOf(item.dataset.step);
        item.classList.toggle("is-current", item.dataset.step === currentStep);
        item.classList.toggle("is-complete", itemIndex >= 0 && itemIndex < currentIndex);
    });

    window.requestAnimationFrame(() => {
        const activeScreen = screens.get(name);
        const focusTarget = focusSelector
            ? activeScreen?.querySelector(focusSelector)
            : activeScreen?.querySelector("h1, input, button");

        if (focusTarget) {
            focusTarget.setAttribute("tabindex", "-1");
            focusTarget.focus({ preventScroll: true });
            focusTarget.addEventListener("blur", () => focusTarget.removeAttribute("tabindex"), { once: true });
        }
    });

    if (name === "success") {
        startSuccessReturn();
    }
}

function updateAttire(guest) {
    const attire = guest.attire;
    const preview = document.getElementById("dress-code");
    const figure = preview.querySelector(".dress-guide");
    const image = document.getElementById("dress-guide-image");
    const palette = document.querySelector(".palette");
    const colours = [attire?.primaryColor, attire?.secondaryColor].filter(Boolean);

    palette.replaceChildren();
    colours.forEach((colour) => {
        const swatch = document.createElement("i");
        swatch.style.setProperty("--swatch", colour);
        palette.append(swatch);
    });
    palette.hidden = colours.length === 0;

    const hasImage = Boolean(attire?.imageUrl);
    preview.classList.toggle("has-guide", hasImage);
    figure.hidden = !hasImage;
    if (hasImage) {
        image.src = attire.imageUrl;
        image.alt = `${attire.attireName || "Attire"} reference for ${guest.fullName}`;
    } else {
        image.removeAttribute("src");
        image.alt = "";
    }

    const attireName = attire?.attireName || attire?.displayName || "Attire details";
    const description = attire?.description || "Please contact the bride or groom for your attire details.";
    document.getElementById("look-badge").textContent = `${guest.role || "Guest"} · ${attireName}`;
    document.getElementById("attire-theme").textContent = attire?.displayName || attireName;
    document.getElementById("attire-title").textContent = attireName;
    document.getElementById("attire-description").textContent = description;
    document.getElementById("welcome-attire").textContent = description;
}

function hydrateGuest(guest) {
    activeGuest = guest;
    const role = guest.role || "Guest";
    const fullName = guest.fullName;

    document.getElementById("welcome-name").textContent = fullName;
    document.getElementById("invite-for-name").textContent = fullName;
    document.getElementById("role-badge").textContent = role;
    document.getElementById("personal-welcome").textContent = `You're our ${role}. We're so happy to share our wedding day with you.`;
    document.getElementById("invited-guest-name").textContent = fullName;
    document.getElementById("success-name").textContent = fullName;
    document.getElementById("success-role").textContent = role;
    document.getElementById("declined-name").textContent = fullName;
    updateAttire(guest);

    mealForm.reset();
    document.getElementById("dietary-requirements").value = guest.dietaryRequirements || "";
    document.getElementById("meal-notes").value = guest.foodChoice?.notes || "";

    const status = document.getElementById("current-rsvp-status");
    if (guest.rsvpStatus === "attending") {
        status.textContent = "Your current response is attending. You can update it below.";
        status.hidden = false;
    } else if (guest.rsvpStatus === "not_attending") {
        status.textContent = "Your current response is not attending. You can change it below.";
        status.hidden = false;
    } else {
        status.textContent = "";
        status.hidden = true;
    }

    if (guest.foodChoice?.mainId) {
        const existingMeal = Array.from(mealForm.querySelectorAll('input[name="meal"]'))
            .find((input) => input.value === String(guest.foodChoice.mainId));
        if (existingMeal) {
            existingMeal.checked = true;
        }
    }

    if (guest.foodChoice?.dessertId) {
        const existingDessert = Array.from(mealForm.querySelectorAll('input[name="dessert"]'))
            .find((input) => input.value === String(guest.foodChoice.dessertId));
        if (existingDessert) {
            existingDessert.checked = true;
        }
    }
}

async function parseResponse(response) {
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        const error = new Error(data.error || "Something went wrong. Please try again.");
        error.status = response.status;
        throw error;
    }

    return data;
}

async function findGuest(name) {
    const response = await fetch(API.findGuest, {
        method: "POST",
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ name })
    });
    return parseResponse(response);
}

async function getMenu() {
    const response = await fetch(API.getMenu, { headers: { Accept: "application/json" } });
    return parseResponse(response);
}

async function saveRsvp({ status, mainId = null, dessertId = null, dietaryRequirements = "", notes = "" }) {
    if (!activeGuest?.token) {
        throw new Error("Your invitation session has expired. Please look up your name again.");
    }

    const response = await fetch(API.submitRsvp, {
        method: "POST",
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            token: activeGuest.token,
            status,
            mainId,
            dessertId,
            dietaryRequirements,
            notes
        })
    });

    return parseResponse(response);
}

lookupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearInlineError(lookupError);

    const name = normalizeName(guestNameInput.value);
    if (name.length < 2) {
        showInlineError(lookupError, "Please enter the full name shown on your invitation.");
        guestNameInput.focus();
        return;
    }

    try {
        setLoading(lookupButton, true, "Finding your invitation…", "Get my invitation");
        const data = await findGuest(name);
        const menu = await getMenu();
        renderMenu(menu);
        hydrateGuest(data.guest);
        showScreen("dashboard");
    } catch (error) {
        if (error.status === 404) {
            showScreen("not-found");
        } else {
            showInlineError(lookupError, error.message);
        }
    } finally {
        setLoading(lookupButton, false, "Finding your invitation…", "Get my invitation");
    }
});

guestNameInput.addEventListener("input", () => clearInlineError(lookupError));

document.querySelectorAll("[data-go]").forEach((control) => {
    control.addEventListener("click", () => {
        const destination = control.dataset.go;

        if (destination !== "lookup" && !activeGuest) {
            showScreen("lookup", "input");
            return;
        }

        if (destination === "lookup") {
            returnToLookup();
            return;
        }

        showScreen(destination);
    });
});

document.querySelector('[data-attending="true"]').addEventListener("click", () => {
    if (submissionInProgress) {
        return;
    }
    clearInlineError(attendanceError);
    showScreen("meal");
});

document.querySelector('[data-attending="false"]').addEventListener("click", async () => {
    if (submissionInProgress) {
        return;
    }

    clearInlineError(attendanceError);
    submissionInProgress = true;
    document.querySelectorAll("[data-attending]").forEach((button) => { button.disabled = true; });
    savingOverlay.hidden = false;

    try {
        const data = await saveRsvp({ status: "not_attending" });
        activeGuest = { ...activeGuest, ...data.guest };
        hydrateGuest(activeGuest);
        showScreen("declined");
    } catch (error) {
        showInlineError(attendanceError, error.message);
    } finally {
        savingOverlay.hidden = true;
        submissionInProgress = false;
        document.querySelectorAll("[data-attending]").forEach((button) => { button.disabled = false; });
    }
});

mealForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submissionInProgress) {
        return;
    }

    clearInlineError(mealError);

    const formData = new FormData(mealForm);
    const mainId = formData.get("meal");
    const dessertId = formData.get("dessert");
    const dietaryRequirements = String(formData.get("dietaryRequirements") || "").trim();
    const notes = String(formData.get("notes") || "").trim();

    if (!mainId) {
        showInlineError(mealError, "Please choose one main before saving your RSVP.");
        mealForm.querySelector('input[name="meal"]')?.focus();
        return;
    }

    if (!dessertId) {
        showInlineError(mealError, "Please choose one dessert before saving your RSVP.");
        mealForm.querySelector('input[name="dessert"]')?.focus();
        return;
    }

    try {
        submissionInProgress = true;
        setLoading(saveRsvpButton, true, "Saving your response…", "Save preferences");
        const data = await saveRsvp({
            status: "attending",
            mainId,
            dessertId,
            dietaryRequirements,
            notes
        });
        activeGuest = { ...activeGuest, ...data.guest };
        hydrateGuest(activeGuest);
        fillConfirmedDish("meal", mainId);
        fillConfirmedDish("dessert", dessertId);
        showScreen("success");
    } catch (error) {
        showInlineError(mealError, error.message);
    } finally {
        submissionInProgress = false;
        setLoading(saveRsvpButton, false, "Saving your response…", "Save preferences");
    }
});

mealForm.addEventListener("change", () => clearInlineError(mealError));

document.querySelectorAll(".dashboard-nav a").forEach((link) => {
    link.addEventListener("click", (event) => {
        const href = link.getAttribute("href");
        const target = document.querySelector(href);
        if (!target) {
            return;
        }

        event.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
});

const INVITATION_PAGES = [
    {
        src: "img/1.png",
        alt: "Invitation page 1 of 5: Jhon Aries and Charmnie Jade invite you to their wedding"
    },
    {
        src: "img/2.png",
        alt: "Invitation page 2 of 5"
    },
    {
        src: "img/3.png",
        alt: "Invitation page 3 of 5: the wedding entourage"
    },
    {
        src: "img/4.png",
        alt: "Invitation page 4 of 5"
    },
    {
        src: "img/5.png",
        alt: "Invitation page 5 of 5"
    }
];

const invitationLightbox = document.getElementById("invitation-lightbox");
const invitationPageImage = document.getElementById("invitation-page-image");
const invitationPageLabel = document.getElementById("invitation-page-label");
const entourageLightbox = document.getElementById("entourage-lightbox");
let invitationPage = 0;

function renderInvitationPage() {
    const page = INVITATION_PAGES[invitationPage];
    invitationPageImage.src = page.src;
    invitationPageImage.alt = page.alt;
    invitationPageLabel.textContent = `${invitationPage + 1} / ${INVITATION_PAGES.length}`;
}

function openInvitationLightbox(startPage = 0) {
    invitationPage = startPage;
    renderInvitationPage();
    INVITATION_PAGES.forEach((page) => {
        const preload = new Image();
        preload.src = page.src;
    });
    invitationLightbox.hidden = false;
}

function closeInvitationLightbox() {
    invitationLightbox.hidden = true;
}

function stepInvitationPage(step) {
    invitationPage = (invitationPage + step + INVITATION_PAGES.length) % INVITATION_PAGES.length;
    renderInvitationPage();
}

function closeEntourageLightbox() {
    entourageLightbox.hidden = true;
}

document.getElementById("invitation-open").addEventListener("click", () => {
    openInvitationLightbox(0);
});

document.getElementById("invitation-artwork-open").addEventListener("click", () => {
    openInvitationLightbox(0);
});

document.getElementById("invitation-prev").addEventListener("click", () => {
    stepInvitationPage(-1);
});

document.getElementById("invitation-next").addEventListener("click", () => {
    stepInvitationPage(1);
});

invitationLightbox.addEventListener("click", (event) => {
    if (event.target === invitationLightbox || event.target.classList.contains("lightbox-close")) {
        closeInvitationLightbox();
    }
});

document.getElementById("entourage-button").addEventListener("click", () => {
    entourageLightbox.hidden = false;
});

entourageLightbox.addEventListener("click", (event) => {
    if (event.target === entourageLightbox || event.target.classList.contains("lightbox-close")) {
        closeEntourageLightbox();
    }
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !invitationLightbox.hidden) {
        closeInvitationLightbox();
        return;
    }

    if (!invitationLightbox.hidden && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        stepInvitationPage(event.key === "ArrowLeft" ? -1 : 1);
        return;
    }

    if (event.key === "Escape" && !entourageLightbox.hidden) {
        closeEntourageLightbox();
    }
});

document.getElementById("calendar-button").addEventListener("click", () => {
    const calendar = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Jhon Aries and Charmnie Jade//Wedding//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        "UID:wedding-20261219@jhonaries-charmniejade",
        "DTSTAMP:20260907T000000Z",
        "DTSTART:20261219T030000Z",
        "DTEND:20261219T100000Z",
        "SUMMARY:Jhon Aries & Charmnie Jade’s Wedding",
        "LOCATION:Pemberton Gardens\\, 210 Tosswill Rd\\, Prebbleton\\, Christchurch",
        "DESCRIPTION:We can’t wait to celebrate with you!",
        "END:VEVENT",
        "END:VCALENDAR"
    ].join("\r\n");

    stopSuccessReturn();
    startSuccessReturn();
    const blob = new Blob([calendar], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "jhon-aries-and-charmnie-jade-wedding.ics";
    link.rel = "noopener";
    link.style.display = "none";
    document.body.append(link);
    link.click();
    window.setTimeout(() => {
        link.remove();
        URL.revokeObjectURL(url);
    }, 60_000);
});

const weddingMusic = document.getElementById("wedding-music");
const musicToggle = document.getElementById("music-toggle");
const musicLabel = musicToggle.querySelector(".music-label");
weddingMusic.volume = 0.25;

function updateMusicControl(isPlaying) {
    musicToggle.classList.toggle("is-playing", isPlaying);
    musicToggle.setAttribute("aria-pressed", String(isPlaying));
    musicToggle.setAttribute("aria-label", isPlaying ? "Pause wedding music" : "Play wedding music");
    musicLabel.textContent = isPlaying ? "Pause music" : "Play music";
}

async function attemptMusicPlayback() {
    try {
        await weddingMusic.play();
        updateMusicControl(true);
        return true;
    } catch {
        updateMusicControl(false);
        return false;
    }
}

musicToggle.addEventListener("click", async () => {
    if (weddingMusic.paused) {
        await attemptMusicPlayback();
    } else {
        weddingMusic.pause();
    }
});

weddingMusic.addEventListener("play", () => updateMusicControl(true));
weddingMusic.addEventListener("pause", () => updateMusicControl(false));

async function playMusicOnFirstInteraction(event) {
    ["pointerdown", "keydown", "touchstart"].forEach((eventName) => {
        document.removeEventListener(eventName, playMusicOnFirstInteraction);
    });

    if (event.target instanceof Element && event.target.closest("#music-toggle")) {
        return;
    }

    if (weddingMusic.paused) {
        await attemptMusicPlayback();
    }
}

attemptMusicPlayback().then((started) => {
    if (!started) {
        ["pointerdown", "keydown", "touchstart"].forEach((eventName) => {
            document.addEventListener(eventName, playMusicOnFirstInteraction, { once: true });
        });
    }
});

const queryName = normalizeName(new URLSearchParams(window.location.search).get("name"));
if (queryName) {
    guestNameInput.value = queryName;
    lookupForm.requestSubmit();
}
