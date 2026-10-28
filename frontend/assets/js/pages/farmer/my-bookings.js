const token = localStorage.getItem("token");
const container = document.getElementById("bookingList");
const message = document.getElementById("bookingMessage");
let allBookings = [];
let currentFilter = "all";

function farmerHeaders(json = false) {
    return {
        ...(json ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${token}`
    };
}

function showFarmerMessage(text, error = false) {
    message.className = `form-feedback ${error ? "error" : "success"}`;
    message.textContent = text;
}

function appendDetail(card, label, value) {
    if (value == null || value === "") return;
    const line = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = `${label}: `;
    line.append(strong, document.createTextNode(String(value)));
    card.append(line);
}

function bookingCategory(type) {
    const normalized = String(type || "").toLowerCase();
    if (normalized.includes("adike") || normalized.includes("arecanut") || normalized.includes("areca")) return { icon: "🌴", label: "Adike (Arecanut) Sprayer" };
    if (normalized.includes("power tiller") || normalized.includes("powertiller")) return { icon: "⚙️", label: "Power Tiller" };
    if (normalized.includes("tractor")) return { icon: "🚜", label: "Tractor" };
    if (normalized.includes("harvester") || normalized.includes("combine")) return { icon: "🌾", label: "Harvester" };
    if (normalized.includes("tiller") || normalized.includes("rotavator") || normalized.includes("cultivator")) return { icon: "⚙️", label: "Tiller / Rotavator" };
    if (normalized.includes("drone")) return { icon: "🛸", label: "Agricultural Drone" };
    if (normalized.includes("trailer")) return { icon: "🚛", label: "Trailer" };
    return { icon: "🧰", label: "Legacy machinery" };
}

function remainingCancellationTime(booking) {
    const deadline = Date.parse(booking.cancellation_deadline);
    return Number.isFinite(deadline) ? deadline - Date.now() : 0;
}

function formatRemaining(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    return `${Math.floor(totalSeconds / 3600)}h ${Math.floor((totalSeconds % 3600) / 60)}m ${totalSeconds % 60}s`;
}

function appendBookingPhoto(card, booking) {
    const wrapper = document.createElement("div");
    wrapper.className = "booking-machinery-photo";
    const { icon, label } = bookingCategory(booking.machinery_type);
    const placeholder = () => {
        const fallback = document.createElement("div");
        fallback.className = "booking-machinery-placeholder";
        fallback.dataset.category = icon;
        fallback.textContent = `${icon} ${label}`;
        return fallback;
    };
    if (!booking.image_url) {
        wrapper.append(placeholder());
    } else {
        const image = document.createElement("img");
        image.src = booking.image_url;
        image.alt = `${booking.machinery_name || label} photo`;
        image.loading = "lazy";
        image.addEventListener("error", () => wrapper.replaceChildren(placeholder()), { once: true });
        wrapper.append(image);
    }
    card.append(wrapper);
}

function renderBookings() {
    container.replaceChildren();
    const filtered = allBookings.filter(item => currentFilter === "all" || item.status === currentFilter);
    if (!filtered.length) {
        const empty = document.createElement("p");
        empty.className = "feature-card";
        empty.textContent = "No database bookings match this status.";
        container.append(empty);
        return;
    }
    for (const booking of filtered) {
        const card = document.createElement("article");
        card.className = "feature-card";
        card.style.textAlign = "left";
        const title = document.createElement("h2");
        title.textContent = `${booking.machinery_name || "Machinery"} · ${bookingCategory(booking.machinery_type).label}`;
        const status = document.createElement("p");
        status.className = `booking-status-chip status-${booking.status}`;
        status.textContent = booking.status === "accepted" ? "Booking Successfully Accepted" : `Status: ${booking.status}`;
        card.append(title, status);
        appendBookingPhoto(card, booking);
        appendDetail(card, "Pickup location", booking.location);
        appendDetail(card, "Owner", booking.owner_name);
        appendDetail(card, "Owner contact", booking.owner_phone);
        appendDetail(card, "Date", booking.booking_date);
        appendDetail(card, "Time", `${booking.start_time} – ${booking.end_time}`);
        appendDetail(card, "Rental estimate", `${new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(Number(booking.estimated_total))} (${booking.rental_unit || booking.price_unit || "day"}-rate)`);
        if (["pending", "accepted"].includes(booking.status)) {
            const remaining = remainingCancellationTime(booking);
            const countdown = document.createElement("p");
            countdown.className = "cancellation-countdown";
            countdown.dataset.bookingId = booking.id;
            countdown.dataset.deadline = String(Date.parse(booking.cancellation_deadline));
            countdown.dataset.allowed = String(booking.cancellation_allowed === true);
            countdown.textContent = booking.cancellation_allowed && remaining > 0
                ? `${formatRemaining(remaining)} remaining to cancel`
                : "Cancellation period expired";
            card.append(countdown);
            const cancelButton = document.createElement("button");
            cancelButton.type = "button";
            cancelButton.className = "btn btn-sm btn-outline";
            cancelButton.textContent = "Cancel booking";
            cancelButton.disabled = booking.cancellation_allowed !== true || remaining <= 0;
            cancelButton.addEventListener("click", () => cancelBooking(booking.id));
            card.append(cancelButton);
        }
        container.append(card);
    }
}

async function loadFarmerBookings() {
    if (!token) {
        showFarmerMessage("Sign in as a Farmer to view your bookings.", true);
        return;
    }
    try {
        const result = await AgriMachApi.request("/bookings/farmer", { headers: farmerHeaders() });
        allBookings = Array.isArray(result) ? result : [];
        message.textContent = "";
        renderBookings();
    } catch (error) {
        console.error("Farmer bookings request failed:", error);
        showFarmerMessage(error.message || "Could not load your bookings.", true);
    }
}

async function cancelBooking(id) {
    if (!window.confirm("Cancel this booking? Its requested time slot will be released.")) return;
    try {
        const result = await AgriMachApi.request(`/bookings/${id}/status`, {
            method: "PUT",
            headers: farmerHeaders(true),
            body: JSON.stringify({ status: "cancelled" })
        });
        showFarmerMessage(result.message || "Booking request cancelled.");
        await loadFarmerBookings();
    } catch (error) {
        console.error("Booking cancellation failed:", error);
        showFarmerMessage(error.message || "Could not cancel this booking.", true);
    }
}

window.setInterval(() => {
    document.querySelectorAll(".cancellation-countdown[data-deadline]").forEach(countdown => {
        const remaining = Number(countdown.dataset.deadline) - Date.now();
        const allowed = countdown.dataset.allowed === "true";
        countdown.textContent = allowed && remaining > 0
            ? `${formatRemaining(remaining)} remaining to cancel`
            : "Cancellation period expired";
        const button = countdown.parentElement.querySelector("button");
        if (button) button.disabled = !allowed || remaining <= 0;
    });
}, 1000);

document.querySelectorAll("[data-filter]").forEach(button => {
    button.addEventListener("click", () => {
        currentFilter = button.dataset.filter;
        document.querySelectorAll("[data-filter]").forEach(item => item.classList.toggle("active", item === button));
        renderBookings();
    });
});

loadFarmerBookings();
const bookingRefreshTimer = window.setInterval(loadFarmerBookings, 30000);
window.addEventListener("beforeunload", () => window.clearInterval(bookingRefreshTimer));
