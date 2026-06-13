const pages = Array.from(document.querySelectorAll(".invitation-page"));
const carousel = document.querySelector(".invitation-carousel");
const viewport = carousel.querySelector(".invitation-viewport");
const track = document.getElementById("invitation-track");
const dots = Array.from(document.querySelectorAll(".invitation-dots button"));
const previousButton = document.querySelector(".invitation-previous");
const nextButton = document.querySelector(".invitation-next");
const lightbox = document.getElementById("invitation-lightbox");
const lightboxContent = lightbox.querySelector(".lightbox-content");
const lightboxImage = document.getElementById("lightbox-image");
const lightboxTitle = document.getElementById("lightbox-title");

let activeIndex = 0;
let touchStartX = 0;
let autoplayTimer = null;
let lastFocusedPage = null;
let panX = 0;
let panY = 0;
let dragStartX = 0;
let dragStartY = 0;
let isDragging = false;
let suppressZoomClick = false;

function applyPan() {
    lightboxImage.style.transform =
        `translate(calc(-50% + ${panX}px), calc(-50% + ${panY}px))`;
}

function resetPan() {
    panX = 0;
    panY = 0;
    lightboxImage.style.transform = "";
    lightboxImage.classList.remove("is-dragging");
    isDragging = false;
}

function positionCarousel() {
    const activePage = pages[activeIndex];
    const offset = (viewport.clientWidth - activePage.offsetWidth) / 2 - activePage.offsetLeft;

    track.style.transform = `translateX(${offset}px)`;

    pages.forEach((page, index) => {
        page.classList.toggle("is-active", index === activeIndex);
    });

    dots.forEach((dot, index) => {
        const isActive = index === activeIndex;
        dot.classList.toggle("is-active", isActive);
        dot.setAttribute("aria-current", isActive ? "true" : "false");
    });
}

function showPage(index) {
    activeIndex = (index + pages.length) % pages.length;
    positionCarousel();
}

function stopAutoplay() {
    window.clearInterval(autoplayTimer);
    autoplayTimer = null;
}

function startAutoplay() {
    stopAutoplay();

    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        autoplayTimer = window.setInterval(() => showPage(activeIndex + 1), 5_000);
    }
}

function restartAutoplay() {
    stopAutoplay();
    startAutoplay();
}

function openLightbox(page) {
    lastFocusedPage = page;
    stopAutoplay();
    lightboxContent.classList.remove("is-zoomed");
    resetPan();
    lightboxImage.src = page.dataset.fullImage;
    lightboxImage.alt = page.querySelector("img").alt;
    lightboxImage.setAttribute("aria-label", "Zoom in on invitation");
    lightboxImage.setAttribute("aria-pressed", "false");
    lightboxTitle.textContent = page.dataset.title;
    lightbox.hidden = false;
    document.body.style.overflow = "hidden";
    lightbox.querySelector(".lightbox-close").focus();
}

function closeLightbox() {
    lightbox.hidden = true;
    lightboxContent.classList.remove("is-zoomed");
    resetPan();
    lightboxImage.src = "";
    document.body.style.overflow = "";
    lastFocusedPage?.focus();
    startAutoplay();
}

function toggleZoom() {
    if (isDragging || suppressZoomClick) {
        suppressZoomClick = false;
        return;
    }

    const isZoomed = lightboxContent.classList.toggle("is-zoomed");
    resetPan();
    lightboxImage.setAttribute("aria-pressed", String(isZoomed));
    lightboxImage.setAttribute(
        "aria-label",
        isZoomed ? "Zoom out from invitation" : "Zoom in on invitation"
    );

}

pages.forEach((page) => {
    page.addEventListener("click", () => openLightbox(page));
});

previousButton.addEventListener("click", () => {
    showPage(activeIndex - 1);
    restartAutoplay();
});

nextButton.addEventListener("click", () => {
    showPage(activeIndex + 1);
    restartAutoplay();
});

dots.forEach((dot, index) => {
    dot.addEventListener("click", () => {
        showPage(index);
        restartAutoplay();
    });
});

carousel.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
        showPage(activeIndex - 1);
        restartAutoplay();
    }

    if (event.key === "ArrowRight") {
        showPage(activeIndex + 1);
        restartAutoplay();
    }
});

carousel.addEventListener("touchstart", (event) => {
    stopAutoplay();
    touchStartX = event.changedTouches[0].clientX;
}, { passive: true });

carousel.addEventListener("touchend", (event) => {
    const distance = event.changedTouches[0].clientX - touchStartX;

    if (Math.abs(distance) >= 45) {
        showPage(activeIndex + (distance < 0 ? 1 : -1));
    }

    startAutoplay();
}, { passive: true });

carousel.addEventListener("mouseenter", stopAutoplay);
carousel.addEventListener("mouseleave", startAutoplay);
carousel.addEventListener("focusin", stopAutoplay);
carousel.addEventListener("focusout", startAutoplay);

lightboxImage.addEventListener("click", toggleZoom);
lightboxImage.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleZoom();
    }
});

lightboxImage.addEventListener("pointerdown", (event) => {
    if (!lightboxContent.classList.contains("is-zoomed")) {
        return;
    }

    event.preventDefault();
    isDragging = true;
    suppressZoomClick = false;
    dragStartX = event.clientX - panX;
    dragStartY = event.clientY - panY;
    lightboxImage.classList.add("is-dragging");
    lightboxImage.setPointerCapture(event.pointerId);
});

lightboxImage.addEventListener("pointermove", (event) => {
    if (!isDragging) {
        return;
    }

    panX = event.clientX - dragStartX;
    panY = event.clientY - dragStartY;
    if (Math.abs(panX) > 5 || Math.abs(panY) > 5) {
        suppressZoomClick = true;
    }
    applyPan();
});

function stopDrag(event) {
    if (!isDragging) {
        return;
    }

    isDragging = false;
    lightboxImage.classList.remove("is-dragging");

    if (lightboxImage.hasPointerCapture(event.pointerId)) {
        lightboxImage.releasePointerCapture(event.pointerId);
    }
}

lightboxImage.addEventListener("pointerup", stopDrag);
lightboxImage.addEventListener("pointercancel", stopDrag);

lightbox.querySelectorAll("[data-close-lightbox]").forEach((control) => {
    control.addEventListener("click", closeLightbox);
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !lightbox.hidden) {
        closeLightbox();
    }
});

window.addEventListener("resize", positionCarousel);

positionCarousel();
startAutoplay();
