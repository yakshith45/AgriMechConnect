const token = localStorage.getItem("token");
const container = document.getElementById("bookingList");
const message = document.getElementById("bookingMessage");

function ownerHeaders(json = false) {
    return {
        ...(json ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${token}`
    };
}

function showOwnerMessage(text, error = false) {
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

function appendFarmerLocationMap(card, booking) {
    const latitude = Number(booking.farmer_latitude);
    const longitude = Number(booking.farmer_longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !window.L) return;

    const mapElement = document.createElement("div");
    mapElement.className = "booking-location-map";
    mapElement.setAttribute("role", "application");
    mapElement.setAttribute("aria-label", `Farmer location for booking ${booking.id}`);
    card.append(mapElement);

    const center = [12.561, 75.387];
    const map = window.L.map(mapElement, { scrollWheelZoom: false }).setView([latitude, longitude], 12);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
    }).addTo(map);
    window.L.circle(center, {
        radius: 25000,
        color: "#b48b36",
        fillColor: "#d6b35c",
        fillOpacity: 0.08,
        weight: 1
    }).addTo(map);
    const popup = document.createElement("span");
    popup.textContent = booking.farmer_location || "Farmer selected location";
    window.L.marker([latitude, longitude]).addTo(map).bindPopup(popup);
    window.setTimeout(() => map.invalidateSize(), 0);
}

function renderOwnerBookings(bookings) {
    container.replaceChildren();
    const pendingCount = bookings.filter(booking => booking.status === "pending").length;
    const summaryCount = document.getElementById("ownerBookingCount");
    const pendingBadge = document.getElementById("ownerPendingBadge");
    const navCount = document.getElementById("ownerPendingNavCount");
    if (summaryCount) summaryCount.textContent = String(pendingCount);
    if (pendingBadge) {
        pendingBadge.hidden = pendingCount === 0;
        pendingBadge.textContent = `${pendingCount} pending`;
    }
    if (navCount) {
        navCount.hidden = pendingCount === 0;
        navCount.textContent = String(pendingCount);
    }
    if (!bookings.length) {
        const empty = document.createElement("p");
        empty.className = "feature-card";
        empty.textContent = "No real booking requests have been made for your machinery yet.";
        container.append(empty);
        return;
    }
    for (const booking of bookings) {
        const card = document.createElement("article");
        card.className = "feature-card";
        card.style.textAlign = "left";
        const title = document.createElement("h2");
        title.textContent = `${booking.machinery_name || "Machinery"} · Request #${booking.id}`;
        const status = document.createElement("p");
        status.className = `booking-status-chip status-${booking.status}`;
        const statusLabels = {
            pending: "Pending",
            accepted: "Booking Successfully Accepted",
            rejected: "Rejected",
            cancelled: "Cancelled",
            completed: "Completed"
        };
        status.textContent = statusLabels[booking.status] || "Status unavailable";
        card.append(title, status);
        appendBookingPhoto(card, booking);
        appendDetail(card, "Machinery category", bookingCategory(booking.machinery_type).label);
        appendDetail(card, "Farmer", booking.farmer_name);
        appendDetail(card, "Farmer phone", booking.farmer_phone);
        appendDetail(card, "Farmer email", booking.farmer_email);
        appendDetail(card, "Farmer's selected farm location", booking.farmer_location);
        appendDetail(card, "Date", booking.booking_date);
        appendDetail(card, "Time", `${booking.start_time} – ${booking.end_time}`);
        appendDetail(card, "Rental estimate", `${new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(Number(booking.estimated_total))} (${booking.rental_unit || booking.price_unit || "day"}-rate)`);
        appendFarmerLocationMap(card, booking);
        if (booking.status === "pending") {
            for (const [nextStatus, label] of [["accepted", "Accept request"], ["rejected", "Decline"]]) {
                const button = document.createElement("button");
                button.type = "button";
                button.className = nextStatus === "accepted"
                    ? "btn btn-sm btn-accent"
                    : "btn btn-sm btn-outline owner-reject-button";
                button.textContent = nextStatus === "accepted" ? "Accept" : "Reject";
                button.setAttribute("aria-label", `${label} for ${booking.machinery_name || "machinery"}`);
                button.addEventListener("click", () => updateBooking(booking.id, nextStatus));
                card.append(button);
            }
        }
        container.append(card);
    }
}

async function loadOwnerBookings() {
    let user;
    try {
        user = JSON.parse(localStorage.getItem("user") || "null");
    } catch (error) {
        console.error("Saved booking-request session could not be read:", error);
    }
    if (!token || user?.role !== "owner") {
        showOwnerMessage("Sign in and choose Machinery Owner access to view booking requests.", true);
        return;
    }
    try {
        const result = await AgriMachApi.request("/bookings/owner", { headers: ownerHeaders() });
        renderOwnerBookings(Array.isArray(result) ? result : []);
        message.textContent = "";
    } catch (error) {
        console.error("Owner booking request failed:", error);
        showOwnerMessage(error?.status === 403
            ? "This session does not have active Machinery Owner access. Log out and sign in again, then choose Machinery Owner."
            : error.message || "Could not load booking requests.", true);
    }
}

async function updateBooking(id, status) {
    const action = status === "accepted" ? "accept" : "reject";
    if (!window.confirm(`Are you sure you want to ${action} this booking request?`)) return;
    try {
        const result = await AgriMachApi.request(`/bookings/${id}/status`, {
            method: "PUT",
            headers: ownerHeaders(true),
            body: JSON.stringify({ status })
        });
        showOwnerMessage(result.message || (status === "accepted" ? "Booking Successfully Accepted" : "Booking declined."));
        await loadOwnerBookings();
    } catch (error) {
        console.error("Booking status update failed:", error);
        showOwnerMessage(error.message || "Could not update this booking.", true);
    }
}

loadOwnerBookings();
const requestRefreshTimer = window.setInterval(loadOwnerBookings, 30000);
window.addEventListener("beforeunload", () => window.clearInterval(requestRefreshTimer));
