const weddingDate = new Date("2026-12-19T16:00:00+13:00");
const units = ["days", "hours", "minutes", "seconds"];

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
