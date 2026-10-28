const machineryForm = document.getElementById("machineryForm");
const ownerToken = localStorage.getItem("token");
const submitButton = document.getElementById("submitListing");
const messageElement = document.getElementById("machineMessage");
const ownerFormToast = document.getElementById("ownerFormToast");
const listingsContainer = document.getElementById("ownerListings");
const listingStatus = document.getElementById("ownerListingStatus");
const cancelEditButton = document.getElementById("cancelEdit");
const imageInput = document.getElementById("machinePhoto");
const removeMachinePhotoButton = document.getElementById("removeMachinePhoto");
const categoryInput = document.getElementById("type");
const specificationFields = document.getElementById("categorySpecificationFields");
const pickupAddressInput = document.getElementById("location");
const pickupSearchResults = document.getElementById("pickupSearchResults");
const pickupLocationMessage = document.getElementById("pickupLocationMessage");
const useCurrentPickupLocationButton = document.getElementById("useCurrentPickupLocation");
const recentMessagesContainer = document.getElementById("ownerRecentMessages");
const messagesStatus = document.getElementById("ownerMessagesStatus");
const chatDialog = document.getElementById("ownerChatDialog");
const chatHistory = document.getElementById("ownerChatHistory");
const chatStatus = document.getElementById("ownerChatStatus");
const chatForm = document.getElementById("ownerChatForm");
const ownerStatDialog = document.getElementById("ownerStatDialog");
const ownerStatDialogTitle = document.getElementById("ownerStatDialogTitle");
const ownerStatDialogContent = document.getElementById("ownerStatDialogContent");
const ownerStatDialogClose = document.getElementById("ownerStatDialogClose");
const MACHINERY_CATEGORIES = [
    "Tractor",
    "Harvester",
    "Tiller / Rotavator",
    "Power Tiller",
    "Adike (Arecanut) Sprayer",
    "Agricultural Drone",
    "Trailer"
];
const SPECIFICATION_FIELDS = {
    Tractor: [["horsepower_hp", "Horsepower (HP)", "number"], ["tractor_type", "Tractor type", "text"]],
    Harvester: [["harvesting_type", "Harvesting type", "text"], ["capacity", "Capacity and unit", "text"]],
    "Tiller / Rotavator": [["tiller_type", "Tiller / rotavator type", "text"], ["working_width_cm", "Working width (cm)", "number"], ["compatible_power_hp", "Compatible power (HP)", "number"]],
    "Power Tiller": [["engine_power_hp", "Engine power (HP)", "number"], ["working_width_cm", "Working width (cm)", "number"]],
    "Adike (Arecanut) Sprayer": [["sprayer_type", "Sprayer type", "text"], ["tank_capacity_l", "Tank capacity (litres)", "number"]],
    "Agricultural Drone": [["payload_capacity_kg", "Payload capacity (kg)", "number"], ["tank_capacity_l", "Spraying tank capacity (litres)", "number"], ["battery_endurance_minutes", "Battery endurance (minutes)", "number"], ["battery_details", "Battery details", "text"]],
    Trailer: [["trailer_type", "Trailer type", "text"], ["load_capacity_t", "Load capacity (tonnes)", "number"], ["dimensions", "Dimensions", "text"]]
};
let signedInOwner = null;
let editingListingId = null;
let editingLegacyCategory = false;
let ownerMap;
let pickupMap;
let ownerListingLayer;
let pickupMarker;
let photoPreviewUrl;
let activeEditingListing = null;
let pickupSearchTimer;
let pickupSearchController;
let reverseLookupController;
let lastPhotonRequestAt = 0;
let activeConversationId = null;
const SULLIA_CENTER = [12.561, 75.387];

try {
    signedInOwner = JSON.parse(localStorage.getItem("user") || "null");
} catch (error) {
    console.error("Saved owner session could not be read:", error);
}

function authHeaders(json = false) {
    return {
        ...(json ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${ownerToken}`
    };
}

function setMessage(element, text, isError = false) {
    element.className = `form-feedback ${isError ? "error" : "success"}`;
    element.textContent = text;
}

function setSubmitButtonLabel(label, loading = false) {
    const labelElement = submitButton?.querySelector("span");
    if (labelElement) labelElement.textContent = label;
    else if (submitButton) submitButton.textContent = label;
    submitButton?.classList.toggle("is-loading", loading);
}

function showOwnerFormToast(text, isError = false) {
    if (!ownerFormToast) return;
    ownerFormToast.hidden = false;
    ownerFormToast.className = `owner-form-toast${isError ? " is-error" : " is-success"}`;
    ownerFormToast.textContent = text;
    window.clearTimeout(showOwnerFormToast.timer);
    showOwnerFormToast.timer = window.setTimeout(() => {
        ownerFormToast.hidden = true;
    }, 5000);
}

const OWNER_STAT_CONFIG = {
    machinery: {
        title: "My Machinery",
        endpoint: "/machinery-owner",
        empty: "You have not published any machinery listings yet."
    },
    pending: {
        title: "Pending Bookings",
        endpoint: "/bookings/owner",
        empty: "There are no booking requests waiting for your response."
    },
    available: {
        title: "Available Machinery",
        endpoint: "/machinery-owner",
        empty: "No machinery is currently marked as available."
    },
    messages: {
        title: "Unread Messages",
        endpoint: "/chat/conversations",
        empty: "You have no unread conversations."
    }
};

function ownerStatLoading() {
    ownerStatDialogContent.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "owner-stat-state is-loading";
    loading.textContent = "Loading live dashboard data…";
    ownerStatDialogContent.append(loading);
}

function ownerStatState(text, isError = false) {
    ownerStatDialogContent.replaceChildren();
    const state = document.createElement("p");
    state.className = `owner-stat-state${isError ? " is-error" : ""}`;
    state.textContent = text;
    ownerStatDialogContent.append(state);
}

function ownerStatRow(title, details) {
    const row = document.createElement("article");
    row.className = "owner-stat-row";
    const heading = document.createElement("h3");
    heading.textContent = title;
    row.append(heading);
    if (details) {
        const detail = document.createElement("p");
        detail.textContent = details;
        row.append(detail);
    }
    return row;
}

function renderOwnerStatRows(type, data) {
    const config = OWNER_STAT_CONFIG[type];
    let rows = [];
    if (type === "machinery" || type === "available") {
        const listings = Array.isArray(data) ? data : [];
        rows = listings
            .filter(listing => type !== "available" || listing.availability)
            .map(listing => ownerStatRow(
                listing.name || "Machinery listing",
                [listing.type, listing.location, `₹${listing.price}/${listing.price_unit || "day"}`].filter(Boolean).join(" · ")
            ));
    } else if (type === "pending") {
        const bookings = Array.isArray(data) ? data : [];
        rows = bookings
            .filter(booking => booking.status === "pending")
            .map(booking => ownerStatRow(
                `${booking.machinery_name || "Machinery"} · Request #${booking.id}`,
                [booking.farmer_name, booking.booking_date, booking.farmer_location].filter(Boolean).join(" · ")
            ));
    } else {
        const conversations = Array.isArray(data) ? data : [];
        rows = conversations
            .filter(conversation => Number(conversation.unread_count) > 0)
            .map(conversation => ownerStatRow(
                conversation.other_user?.name || "Farmer",
                `${conversation.machinery?.name || "Machinery conversation"} · ${conversation.unread_count} unread`
            ));
    }
    ownerStatDialogContent.replaceChildren();
    if (!rows.length) {
        ownerStatState(config.empty);
        return;
    }
    const count = document.createElement("p");
    count.className = "owner-stat-result-count";
    count.textContent = `${rows.length} ${rows.length === 1 ? "result" : "results"}`;
    ownerStatDialogContent.append(count, ...rows);
}

async function openOwnerStatDialog(type) {
    const config = OWNER_STAT_CONFIG[type];
    if (!config || !ownerStatDialog || !ownerStatDialogContent) return;
    ownerStatDialogTitle.textContent = config.title;
    ownerStatLoading();
    if (!ownerStatDialog.open) ownerStatDialog.showModal();
    try {
        const result = await AgriMachApi.request(config.endpoint, { headers: authHeaders() });
        const data = type === "messages" ? result?.conversations : result;
        if (type !== "messages" && !Array.isArray(data)) {
            throw new Error("The dashboard returned an invalid response.");
        }
        if (type === "messages" && !Array.isArray(data)) {
            throw new Error("The chat service returned an invalid conversations response.");
        }
        renderOwnerStatRows(type, data);
    } catch (error) {
        console.error(`Owner ${type} summary request failed:`, error);
        ownerStatState(error.message || "Could not load this dashboard summary.", true);
    }
}

function setupOwnerStatDialog() {
    document.querySelectorAll("[data-owner-stat]").forEach(card => {
        card.addEventListener("click", () => openOwnerStatDialog(card.dataset.ownerStat));
    });
    ownerStatDialogClose?.addEventListener("click", () => ownerStatDialog.close());
    ownerStatDialog?.addEventListener("click", event => {
        if (event.target === ownerStatDialog) ownerStatDialog.close();
    });
}

function ownerPhotoCategory(type) {
    const normalized = String(type || "").toLowerCase();
    if (normalized.includes("tractor")) return { key: "tractor", icon: "🚜", title: "Tractor", image: "Mahindra Tractor in Sunny Fields.png" };
    if (normalized.includes("harvester") || normalized.includes("combine")) return { key: "harvester", icon: "🌾", title: "Harvester", image: "8. Combine Harvester Working, Uses, and Importance-min (1)_0.jpg.jpeg" };
    if (normalized.includes("power tiller") || normalized.includes("powertiller")) return { key: "power-tiller", icon: "⚙️", title: "Power Tiller", image: "Walk-Behind-Power-Tiller.jpg" };
    if (normalized.includes("tiller") || normalized.includes("rotavator") || normalized.includes("cultivator")) return { key: "rotavator", icon: "⚙️", title: "Tiller / Rotavator", image: "Tractor-Mounted-Rotavator.jpg" };
    if (normalized.includes("adike") || normalized.includes("arecanut") || normalized.includes("areca")) return { key: "adike-sprayer", icon: "🌴", title: "Adike (Arecanut) Sprayer", image: "Areca Palm Orchard Sprayer in Mist.png" };
    if (normalized.includes("drone")) return { key: "drone", icon: "🛸", title: "Agricultural Drone", image: "Agricultural Drone Spraying Green Crops.png" };
    if (normalized.includes("trailer")) return { key: "trailer", icon: "🚛", title: "Trailer", image: "trailer.jpg" };
    return { key: "legacy", icon: "🧰", title: "Legacy machinery", image: "All Machinery_ Modern Farm Lineup.png" };
}

function createOwnerPhotoPlaceholder(type) {
    const category = ownerPhotoCategory(type);
    const placeholder = document.createElement("div");
    placeholder.className = "owner-listing-photo-placeholder";
    placeholder.dataset.category = category.key;
    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = category.icon;
    const title = document.createElement("strong");
    title.textContent = category.title;
    const label = document.createElement("small");
    label.textContent = "Owner photo not provided";
    placeholder.append(icon, title, label);
    return placeholder;
}

function createOwnerPhoto(listing) {
    const wrapper = document.createElement("div");
    wrapper.className = "owner-listing-photo-wrap";
    if (!listing.image_url) {
        wrapper.append(createCategoryPhoto(listing.type));
        return wrapper;
    }
    const photo = document.createElement("img");
    photo.className = "owner-listing-photo";
    photo.src = listing.image_url;
    photo.alt = `${listing.name} owner photo`;
    photo.loading = "lazy";
    photo.addEventListener("error", () => {
        wrapper.replaceChildren(createCategoryPhoto(listing.type));
    }, { once: true });
    wrapper.append(photo);
    return wrapper;
}

function createCategoryPhoto(type) {
    const category = ownerPhotoCategory(type);
    const photo = document.createElement("img");
    photo.className = "owner-listing-photo";
    photo.src = encodeURI(`images/${category.image}`);
    photo.alt = `${category.title} category photo`;
    photo.loading = "lazy";
    photo.addEventListener("error", () => {
        photo.replaceWith(createOwnerPhotoPlaceholder(type));
    }, { once: true });
    return photo;
}

function renderMachineryPhotoPreview(type, imageSource = "") {
    const preview = document.getElementById("machineryPhotoPreview");
    if (!preview) return;
    if (removeMachinePhotoButton) removeMachinePhotoButton.hidden = !imageSource;
    preview.replaceChildren();
    if (!imageSource) {
        if (type) {
            const photo = createCategoryPhoto(type);
            photo.classList.add("owner-preview-category-image");
            const caption = document.createElement("small");
            caption.className = "owner-photo-preview-caption";
            caption.textContent = "Example category photo · Upload your own machinery photo";
            preview.append(photo, caption);
        } else {
            preview.append(createOwnerPhotoPlaceholder(type));
        }
        return;
    }
    const image = document.createElement("img");
    image.className = "owner-listing-photo owner-preview-upload-image";
    image.alt = `${type || "Machinery"} photo preview`;
    image.src = imageSource;
    preview.append(image);
}

function applyOwnerLocationDefaults() {
    if (!signedInOwner) return;
    const locationInput = document.getElementById("location");
    const latitudeInput = document.getElementById("latitude");
    const longitudeInput = document.getElementById("longitude");
    if (signedInOwner.selected_location) locationInput.value = signedInOwner.selected_location;
    if (signedInOwner.selected_latitude != null) latitudeInput.value = signedInOwner.selected_latitude;
    if (signedInOwner.selected_longitude != null) longitudeInput.value = signedInOwner.selected_longitude;
}

function isWithinOwnerServiceArea(latitude, longitude) {
    const radians = degrees => degrees * Math.PI / 180;
    const [centerLatitude, centerLongitude] = SULLIA_CENTER;
    const latitudeDelta = radians(latitude - centerLatitude);
    const longitudeDelta = radians(longitude - centerLongitude);
    const angle = 2 * Math.asin(Math.sqrt(
        Math.sin(latitudeDelta / 2) ** 2 +
        Math.cos(radians(centerLatitude)) * Math.cos(radians(latitude)) *
        Math.sin(longitudeDelta / 2) ** 2
    ));
    return 6371 * angle <= 25;
}

function createOwnerMap(element, center, zoom = 12) {
    if (!element) return null;
    if (!window.L) {
        element.textContent = "The OpenStreetMap map could not be loaded. You can still enter your pickup coordinates.";
        return null;
    }
    const map = window.L.map(element).setView(center, zoom);
    const tiles = window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
    }).addTo(map);
    let tilesLoaded = false;
    tiles.on("tileload", () => {
        tilesLoaded = true;
        setPickupLocationStatus("Map ready. Select a point or search for its address.");
    });
    tiles.on("tileerror", () => {
        if (!tilesLoaded) {
            setPickupLocationStatus("Map tiles could not be loaded. Check your internet connection; address search may still work.", true);
        }
    });
    window.L.circle(SULLIA_CENTER, {
        radius: 25000,
        color: "#b48b36",
        fillColor: "#d6b35c",
        fillOpacity: 0.08,
        weight: 1
    }).addTo(map);
    return map;
}

function renderOwnerMap(listings) {
    const mapElement = document.getElementById("ownerMap");
    if (!mapElement || !window.L) return;
    const savedLatitude = Number(signedInOwner?.selected_latitude);
    const savedLongitude = Number(signedInOwner?.selected_longitude);
    const center = Number.isFinite(savedLatitude) && Number.isFinite(savedLongitude)
        ? [savedLatitude, savedLongitude]
        : SULLIA_CENTER;
    if (!ownerMap) {
        ownerMap = createOwnerMap(mapElement, center);
        if (!ownerMap) return;
        ownerListingLayer = window.L.featureGroup().addTo(ownerMap);
    }
    ownerListingLayer.clearLayers();
    const points = [];
    if (Number.isFinite(savedLatitude) && Number.isFinite(savedLongitude)) {
        const selectedLocationMarker = window.L.marker([savedLatitude, savedLongitude])
            .bindPopup("Your confirmed owner location");
        ownerListingLayer.addLayer(selectedLocationMarker);
        points.push([savedLatitude, savedLongitude]);
    }
    for (const listing of listings) {
        const latitude = Number(listing.latitude);
        const longitude = Number(listing.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
        const marker = window.L.marker([latitude, longitude])
            .bindPopup(`<strong>${escapeMapText(listing.name)}</strong><br>${escapeMapText(listing.location)}<br>${listing.availability ? "Available" : "Unavailable"}`);
        ownerListingLayer.addLayer(marker);
        points.push([latitude, longitude]);
    }
    if (points.length) ownerMap.fitBounds(ownerListingLayer.getBounds().pad(0.15), { maxZoom: 13 });
    else ownerMap.setView(center, 12);
    window.setTimeout(() => ownerMap.invalidateSize(), 0);
}

function escapeMapText(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function updatePickupMarker({ centerMap = true } = {}) {
    if (!pickupMap || !window.L) return;
    const latitudeValue = document.getElementById("latitude").value;
    const longitudeValue = document.getElementById("longitude").value;
    if (!latitudeValue || !longitudeValue) return;
    const latitude = Number(latitudeValue);
    const longitude = Number(longitudeValue);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return;
    if (!pickupMarker) {
        pickupMarker = window.L.marker([latitude, longitude], { draggable: true }).addTo(pickupMap);
        pickupMarker.on("dragend", () => {
            const point = pickupMarker.getLatLng();
            setPickupCoordinates(point.lat, point.lng, { reverseGeocode: true });
        });
    } else {
        pickupMarker.setLatLng([latitude, longitude]);
    }
    if (centerMap) pickupMap.setView([latitude, longitude], Math.max(pickupMap.getZoom(), 12));
}

function handlePickupCoordinateChange() {
    updatePickupMarker();
    const latitudeInput = document.getElementById("latitude");
    const longitudeInput = document.getElementById("longitude");
    const latitude = Number(latitudeInput.value);
    const longitude = Number(longitudeInput.value);
    if (latitudeInput.value && longitudeInput.value && Number.isFinite(latitude) && Number.isFinite(longitude)) {
        void reverseGeocodePickupAddress(latitude, longitude);
    }
}

function setPickupLocationStatus(text, isError = false) {
    if (!pickupLocationMessage) return;
    pickupLocationMessage.textContent = text;
    pickupLocationMessage.classList.toggle("error", isError);
}

function distanceFromSulliaKm(latitude, longitude) {
    const radians = degrees => degrees * Math.PI / 180;
    const [centerLatitude, centerLongitude] = SULLIA_CENTER;
    const latitudeDelta = radians(latitude - centerLatitude);
    const longitudeDelta = radians(longitude - centerLongitude);
    const angle = 2 * Math.asin(Math.sqrt(
        Math.sin(latitudeDelta / 2) ** 2 +
        Math.cos(radians(centerLatitude)) * Math.cos(radians(latitude)) *
        Math.sin(longitudeDelta / 2) ** 2
    ));
    return 6371 * angle;
}

function setPickupCoordinates(latitude, longitude, { address = "", reverseGeocode = false } = {}) {
    document.getElementById("latitude").value = latitude.toFixed(6);
    document.getElementById("longitude").value = longitude.toFixed(6);
    updatePickupMarker();
    if (!isWithinOwnerServiceArea(latitude, longitude)) {
        setPickupLocationStatus("Choose a pickup point within 25 km of Sullia.", true);
    } else {
        setPickupLocationStatus(`Pickup point selected ${distanceFromSulliaKm(latitude, longitude).toFixed(1)} km from Sullia.`);
    }
    if (address && pickupAddressInput) pickupAddressInput.value = address;
    if (reverseGeocode) void reverseGeocodePickupAddress(latitude, longitude);
}

function photonPlaceLabel(properties = {}) {
    return [
        properties.name || properties.locality || properties.street,
        properties.district || properties.county || properties.city,
        properties.state,
        properties.country
    ].filter((part, index, parts) => part && parts.indexOf(part) === index).join(", ");
}

function showPickupSearchMessage(text) {
    if (!pickupSearchResults) return;
    const message = document.createElement("p");
    message.className = "location-search-empty";
    message.textContent = text;
    pickupSearchResults.replaceChildren(message);
    pickupSearchResults.hidden = false;
}

async function requestPhoton(url, signal) {
    const wait = Math.max(0, 1100 - (Date.now() - lastPhotonRequestAt));
    if (wait) await new Promise(resolve => window.setTimeout(resolve, wait));
    if (signal.aborted) throw new DOMException("Location lookup was cancelled.", "AbortError");
    let response;
    try {
        lastPhotonRequestAt = Date.now();
        response = await fetch(url, { signal, headers: { Accept: "application/geo+json" } });
    } catch (error) {
        if (error.name === "AbortError") throw error;
        throw new Error("Location search is unavailable. Check your internet connection and try again.");
    }
    if (!response.ok) {
        throw new Error(`Location search returned HTTP ${response.status}. Try again shortly.`);
    }
    try {
        return await response.json();
    } catch {
        throw new Error("Location search returned an unreadable response. Try again.");
    }
}

function renderPickupSearchResults(features) {
    if (!pickupSearchResults) return;
    pickupSearchResults.replaceChildren();
    const matching = features.filter(feature => {
        const coordinates = feature.geometry?.coordinates;
        if (!Array.isArray(coordinates) || coordinates.length < 2) return false;
        const [longitude, latitude] = coordinates.map(Number);
        return Number.isFinite(latitude) && Number.isFinite(longitude) &&
            isWithinOwnerServiceArea(latitude, longitude) &&
            photonPlaceLabel(feature.properties);
    });
    if (!matching.length) {
        showPickupSearchMessage("No matching places were found within 25 km of Sullia. Try another village or spelling.");
        return;
    }
    matching.forEach(feature => {
        const [longitude, latitude] = feature.geometry.coordinates.map(Number);
        const label = photonPlaceLabel(feature.properties);
        const result = document.createElement("button");
        result.type = "button";
        result.className = "location-search-result";
        result.setAttribute("role", "option");
        result.textContent = label;
        result.addEventListener("click", () => {
            if (pickupAddressInput) pickupAddressInput.value = label;
            pickupSearchResults.hidden = true;
            setPickupCoordinates(latitude, longitude, { address: label });
        });
        pickupSearchResults.append(result);
    });
    pickupSearchResults.hidden = false;
}

async function searchPickupLocations(query) {
    if (!pickupSearchResults || query.length < 2) {
        if (pickupSearchResults) pickupSearchResults.hidden = true;
        return;
    }
    pickupSearchController?.abort();
    pickupSearchController = new AbortController();
    showPickupSearchMessage("Searching nearby places…");
    const params = new URLSearchParams({
        q: query,
        lat: String(SULLIA_CENTER[0]),
        lon: String(SULLIA_CENTER[1]),
        limit: "20",
        lang: "en"
    });
    try {
        const data = await requestPhoton(`https://photon.komoot.io/api/?${params}`, pickupSearchController.signal);
        renderPickupSearchResults(Array.isArray(data.features) ? data.features : []);
    } catch (error) {
        if (error.name !== "AbortError") showPickupSearchMessage(error.message);
    }
}

async function reverseGeocodePickupAddress(latitude, longitude) {
    if (!pickupAddressInput) return;
    reverseLookupController?.abort();
    reverseLookupController = new AbortController();
    const activeController = reverseLookupController;
    pickupAddressInput.value = "";
    setPickupLocationStatus("Finding the pickup address…");
    const params = new URLSearchParams({
        lat: String(latitude),
        lon: String(longitude),
        lang: "en"
    });
    try {
        const data = await requestPhoton(`https://photon.komoot.io/reverse?${params}`, activeController.signal);
        if (activeController.signal.aborted) return;
        const label = photonPlaceLabel(data.features?.[0]?.properties);
        if (!label) {
            setPickupLocationStatus("No address was found for this point. Search for a village or choose a nearby map point.", true);
            return;
        }
        pickupAddressInput.value = label;
        const distance = distanceFromSulliaKm(latitude, longitude);
        setPickupLocationStatus(
            distance <= 25
                ? `Pickup address selected ${distance.toFixed(1)} km from Sullia.`
                : "Choose a pickup point within 25 km of Sullia.",
            distance > 25
        );
    } catch (error) {
        if (error.name !== "AbortError") {
            setPickupLocationStatus(`${error.message} Search for the pickup village or address to complete the location.`, true);
        }
    }
}

function handlePickupSearchInput() {
    if (!pickupAddressInput || !pickupSearchResults) return;
    window.clearTimeout(pickupSearchTimer);
    pickupSearchController?.abort();
    reverseLookupController?.abort();
    if (pickupAddressInput.value.trim()) {
        document.getElementById("latitude").value = "";
        document.getElementById("longitude").value = "";
        pickupMarker?.remove();
        pickupMarker = null;
        setPickupLocationStatus("Choose a result or select the pickup point on the map to set its coordinates.");
        pickupSearchTimer = window.setTimeout(
            () => searchPickupLocations(pickupAddressInput.value.trim()),
            450
        );
    } else {
        pickupSearchResults.hidden = true;
        setPickupLocationStatus("Search for a pickup address or select a point on the map.");
    }
}

function useCurrentPickupLocation() {
    if (!navigator.geolocation) {
        setPickupLocationStatus("This browser does not support location access. Search for your pickup address instead.", true);
        return;
    }
    useCurrentPickupLocationButton.disabled = true;
    setPickupLocationStatus("Waiting for browser location permission…");
    try {
        navigator.geolocation.getCurrentPosition(
            position => {
                const { latitude, longitude } = position.coords;
                setPickupCoordinates(latitude, longitude, { reverseGeocode: true });
                if (pickupMap) pickupMap.setView([latitude, longitude], 15);
                useCurrentPickupLocationButton.disabled = false;
            },
            error => {
                const message = error.code === error.PERMISSION_DENIED
                    ? "Location permission was denied. Allow location access in your browser or search for an address."
                    : error.code === error.TIMEOUT
                        ? "Browser location lookup timed out. Try again or search for an address."
                        : "Your current location is unavailable. Try again or search for an address.";
                setPickupLocationStatus(message, true);
                useCurrentPickupLocationButton.disabled = false;
            },
            { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
        );
    } catch (error) {
        console.error("Browser geolocation request could not start:", error);
        useCurrentPickupLocationButton.disabled = false;
        setPickupLocationStatus("Browser location lookup could not start. Allow location access or search for an address.", true);
    }
}

function initializeOwnerMaps() {
    pickupMap = createOwnerMap(document.getElementById("ownerPickupMap"), SULLIA_CENTER, 12);
    if (pickupMap) {
        pickupMap.on("click", event => setPickupCoordinates(event.latlng.lat, event.latlng.lng, { reverseGeocode: true }));
        updatePickupMarker({ centerMap: false });
    } else {
        setPickupLocationStatus("The OpenStreetMap map could not be loaded. Check your connection and use the pickup search when available.", true);
    }
}

function setFormValue(id, value) {
    document.getElementById(id).value = value == null ? "" : String(value);
}

function formatAvailabilityTime(value) {
    if (value == null || value === "") return "";
    const text = String(value).trim();
    const match = text.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/);
    return match ? `${match[1]}:${match[2]}` : "";
}

function resetListingForm() {
    editingListingId = null;
    editingLegacyCategory = false;
    activeEditingListing = null;
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    photoPreviewUrl = null;
    machineryForm.reset();
    categoryInput.required = true;
    document.getElementById("priceUnit").value = "day";
    document.getElementById("availability").checked = true;
    document.getElementById("formTitle").textContent = "Add Machinery";
    setSubmitButtonLabel("Publish Machinery Listing");
    cancelEditButton.hidden = true;
    imageInput.value = "";
    renderMachineryPhotoPreview(categoryInput.value);
    renderSpecificationFields("", {});
    applyOwnerLocationDefaults();
    if (pickupMap) {
        if (document.getElementById("latitude").value && document.getElementById("longitude").value) {
            updatePickupMarker({ centerMap: false });
        } else if (pickupMarker) {
            pickupMarker.remove();
            pickupMarker = null;
        }
    }
}

function editListing(listing) {
    const addSection = document.getElementById("addMachinery");
    if (addSection) addSection.hidden = false;
    editingListingId = listing.id;
    editingLegacyCategory = !MACHINERY_CATEGORIES.includes(listing.type);
    activeEditingListing = listing;
    for (const [field, value] of Object.entries({
        name: listing.name,
        type: editingLegacyCategory ? "" : listing.type,
        brand: listing.brand,
        model: listing.model,
        description: listing.description,
        condition: listing.specifications?.condition,
        price: listing.price,
        priceUnit: listing.price_unit || "day",
        location: listing.location,
        latitude: listing.latitude,
        longitude: listing.longitude
    })) setFormValue(field, value);
    categoryInput.required = !editingLegacyCategory;

    const specifications = listing.specifications || {};
    renderSpecificationFields(listing.type, specifications);
    setFormValue("supportedFeatures", Array.isArray(specifications.supported_features) ? specifications.supported_features.join(", ") : "");
    setFormValue("availabilityStartDate", listing.availability_start_date);
    setFormValue("availabilityEndDate", listing.availability_end_date);
    setFormValue("availabilityStartTime", formatAvailabilityTime(listing.availability_start_time));
    setFormValue("availabilityEndTime", formatAvailabilityTime(listing.availability_end_time));
    document.getElementById("availability").checked = listing.availability === true;
    updatePickupMarker();
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    photoPreviewUrl = null;
    imageInput.value = "";
    renderMachineryPhotoPreview(listing.type, listing.image_url || "");
    document.getElementById("formTitle").textContent = `Edit ${listing.name}`;
    setSubmitButtonLabel("Save Listing Changes");
    cancelEditButton.hidden = false;
    messageElement.textContent = "Choose a new photo only if you want to replace the current one.";
    machineryForm.scrollIntoView({ behavior: "smooth", block: "start" });
    window.dispatchEvent(new Event("owner-add-section-open"));
}

function renderSpecificationFields(type, values = {}) {
    specificationFields.replaceChildren();
    for (const [key, label, inputType] of SPECIFICATION_FIELDS[type] || []) {
        const wrapper = document.createElement("label");
        wrapper.className = "form-group";
        wrapper.textContent = label;
        const input = document.createElement("input");
        input.dataset.specification = key;
        input.type = inputType;
        input.step = inputType === "number" ? "any" : "";
        input.min = inputType === "number" ? "0" : "";
        input.value = values[key] == null ? "" : String(values[key]);
        wrapper.append(input);
        specificationFields.append(wrapper);
    }
}

function renderListings(listings) {
    listingsContainer.replaceChildren();
    const machineryCount = document.getElementById("ownerMachineryCount");
    const availableCount = document.getElementById("ownerAvailableCount");
    if (machineryCount) machineryCount.textContent = String(listings.length);
    if (availableCount) availableCount.textContent = String(listings.filter(listing => listing.availability).length);
    renderOwnerMap(listings);
    if (!listings.length) {
        listingStatus.textContent = "You have not published any machinery listings yet.";
        return;
    }
    listingStatus.textContent = "";
    for (const listing of listings) {
        const card = document.createElement("article");
        card.className = "machinery-card owner-machinery-card";
        const content = document.createElement("div");
        content.className = "owner-machinery-card-content";
        const title = document.createElement("h3");
        title.textContent = listing.name;
        title.className = "owner-machinery-card-title";
        const details = document.createElement("p");
        details.className = "owner-machinery-card-details";
        details.textContent = [
            MACHINERY_CATEGORIES.includes(listing.type) ? listing.type : "Legacy machinery",
            [listing.brand, listing.model].filter(Boolean).join(" "),
            `${listing.location} · ₹${listing.price}/${listing.price_unit || "day"}`,
        ].filter(Boolean).join(" · ");
        const status = document.createElement("span");
        status.className = `owner-availability-badge ${listing.availability ? "is-available" : "is-unavailable"}`;
        status.textContent = listing.availability ? "Available" : "Unavailable";
        const specs = listing.specifications || {};
        card.append(createOwnerPhoto(listing));
        details.textContent += Object.entries(specs)
            .filter(([key, value]) => key !== "supported_features" && value != null && value !== "")
            .map(([key, value]) => `${key.replaceAll("_", " ")}: ${value}`).join(" · ");
        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className = "btn btn-sm btn-outline";
        editButton.textContent = "Edit Machinery";
        editButton.addEventListener("click", () => editListing(listing));
        const availabilityButton = document.createElement("button");
        availabilityButton.type = "button";
        availabilityButton.className = "btn btn-sm btn-outline";
        availabilityButton.textContent = listing.availability ? "Mark Unavailable" : "Mark Available";
        availabilityButton.addEventListener("click", () => updateAvailability(listing));
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "btn btn-sm btn-outline owner-delete-button";
        deleteButton.textContent = "Delete Machinery";
        deleteButton.addEventListener("click", () => deleteListing(listing));
        const actions = document.createElement("div");
        actions.className = "owner-machinery-card-actions";
        actions.append(editButton, availabilityButton, deleteButton);
        content.append(status, title, details, actions);
        card.append(content);
        listingsContainer.append(card);
    }
}

async function loadListings() {
    listingStatus.textContent = "Loading your listings…";
    try {
        const result = await AgriMachApi.request("/machinery-owner", { headers: authHeaders() });
        renderListings(Array.isArray(result) ? result : []);
    } catch (error) {
        console.error("Owner listings request failed:", error);
        setMessage(listingStatus, error.message || "Could not load your listings.", true);
    }
}

function setOwnerMessagesStatus(text, isError = false) {
    if (!messagesStatus) return;
    messagesStatus.className = `form-feedback ${isError ? "error" : ""}`;
    messagesStatus.textContent = text;
}

function formatMessageDate(dateValue) {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return "Date unavailable";
    return new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeStyle: "short"
    }).format(date);
}

function renderOwnerConversations(conversations) {
    recentMessagesContainer.replaceChildren();
    if (!conversations.length) {
        setOwnerMessagesStatus("No conversations yet. Messages from farmers will appear here.");
        return;
    }
    setOwnerMessagesStatus("");
    for (const conversation of conversations.slice(0, 4)) {
        const card = document.createElement("article");
        card.className = "owner-message-card";
        const details = document.createElement("div");
        details.className = "owner-message-card-copy";
        const title = document.createElement("h3");
        title.textContent = conversation.other_user?.name || "Farmer";
        const machinery = document.createElement("p");
        machinery.className = "owner-message-machinery";
        machinery.textContent = conversation.machinery?.name || "Machinery conversation";
        const preview = document.createElement("p");
        preview.className = "owner-message-preview";
        preview.textContent = conversation.last_message?.message_text || "No messages in this conversation yet.";
        const timestamp = document.createElement("small");
        timestamp.textContent = conversation.last_message?.created_at
            ? formatMessageDate(conversation.last_message.created_at)
            : "No messages yet";
        details.append(title, machinery, preview, timestamp);
        const actions = document.createElement("div");
        actions.className = "owner-message-card-actions";
        if (Number(conversation.unread_count) > 0) {
            const unread = document.createElement("span");
            unread.className = "owner-message-unread";
            unread.textContent = `${conversation.unread_count} unread`;
            actions.append(unread);
        }
        const openButton = document.createElement("button");
        openButton.type = "button";
        openButton.className = "btn btn-sm btn-outline";
        openButton.textContent = "Open conversation";
        openButton.addEventListener("click", () => openOwnerConversation(conversation));
        actions.append(openButton);
        card.append(details, actions);
        recentMessagesContainer.append(card);
    }
}

async function loadOwnerMessages() {
    const unreadCount = document.getElementById("ownerUnreadCount");
    const unreadNavCount = document.getElementById("ownerUnreadNavCount");
    const unreadSummary = document.getElementById("ownerMessagesUnreadSummary");
    if (!ownerToken || signedInOwner?.role !== "owner") return;

    const [conversationsResult, unreadResult] = await Promise.allSettled([
        AgriMachApi.request("/chat/conversations", { headers: authHeaders() }),
        AgriMachApi.request("/chat/unread-count", { headers: authHeaders() })
    ]);
    if (conversationsResult.status === "fulfilled") {
        const conversations = conversationsResult.value?.conversations;
        if (!Array.isArray(conversations)) {
            setOwnerMessagesStatus("The chat service returned an invalid conversations response.", true);
        } else {
            renderOwnerConversations(conversations);
        }
    } else {
        console.error("Owner conversations request failed:", conversationsResult.reason);
        setOwnerMessagesStatus(conversationsResult.reason?.message || "Could not load recent conversations.", true);
    }
    if (unreadResult.status === "fulfilled") {
        const count = Number(unreadResult.value?.total_unread);
        if (Number.isInteger(count) && count >= 0) {
            unreadCount.textContent = String(count);
            unreadNavCount.textContent = String(count);
            unreadNavCount.hidden = count === 0;
            unreadSummary.textContent = count === 1 ? "1 unread message" : `${count} unread messages`;
        } else {
            unreadCount.textContent = "—";
            unreadNavCount.hidden = true;
            unreadSummary.textContent = "Unread count unavailable";
        }
    } else {
        console.error("Owner unread message count request failed:", unreadResult.reason);
        unreadCount.textContent = "—";
        unreadNavCount.hidden = true;
        unreadSummary.textContent = "Unread count unavailable";
    }
}

function renderOwnerChatMessages(messages) {
    chatHistory.replaceChildren();
    if (!messages.length) {
        const empty = document.createElement("p");
        empty.className = "owner-chat-empty";
        empty.textContent = "Start the conversation by sending a message.";
        chatHistory.append(empty);
        return;
    }
    const signedInUserId = String(signedInOwner?.id || "");
    for (const message of messages) {
        const item = document.createElement("article");
        const ownMessage = String(message.sender_id) === signedInUserId;
        item.className = `owner-chat-message ${ownMessage ? "is-mine" : "is-theirs"}`;
        const sender = document.createElement("strong");
        sender.textContent = ownMessage ? "You" : (message.sender_name || "Farmer");
        const body = document.createElement("p");
        body.textContent = message.message_text || "";
        const timestamp = document.createElement("small");
        timestamp.textContent = formatMessageDate(message.created_at);
        item.append(sender, body, timestamp);
        chatHistory.append(item);
    }
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

async function openOwnerConversation(conversation) {
    activeConversationId = conversation.id;
    document.getElementById("ownerChatTitle").textContent = conversation.other_user?.name || "Farmer";
    document.getElementById("ownerChatMachinery").textContent = conversation.machinery?.name || "Machinery conversation";
    chatHistory.replaceChildren();
    chatStatus.className = "form-feedback";
    chatStatus.textContent = "Loading messages…";
    chatDialog.showModal();
    try {
        const result = await AgriMachApi.request(
            `/chat/conversations/${encodeURIComponent(conversation.id)}/messages`,
            { headers: authHeaders() }
        );
        if (!Array.isArray(result?.messages)) throw new Error("The chat service returned an invalid message history.");
        renderOwnerChatMessages(result.messages);
        chatStatus.textContent = "";
        await loadOwnerMessages();
    } catch (error) {
        console.error("Conversation history request failed:", error);
        chatStatus.className = "form-feedback error";
        chatStatus.textContent = error.message || "Could not load this conversation.";
    }
}

async function updateAvailability(listing) {
    try {
        const result = await AgriMachApi.request(`/machinery-owner/${listing.id}`, {
            method: "PUT",
            headers: authHeaders(true),
            body: JSON.stringify({ availability: !listing.availability })
        });
        await loadListings();
    } catch (error) {
        console.error("Listing availability update failed:", error);
        setMessage(listingStatus, error.message || "Could not update availability.", true);
    }
}

async function deleteListing(listing) {
    if (!window.confirm(`Mark "${listing.name}" unavailable? Its record and existing bookings will be preserved.`)) return;
    try {
        const result = await AgriMachApi.request(`/machinery-owner/${listing.id}`, {
            method: "DELETE",
            headers: authHeaders()
        });
        setMessage(listingStatus, result.message || "Listing removed from the marketplace.");
        await loadListings();
    } catch (error) {
        console.error("Listing removal failed:", error);
        setMessage(listingStatus, error.message || "Could not remove the listing.", true);
    }
}

async function imageDataUrl() {
    const file = imageInput.files?.[0];
    if (!file) return null;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 3 * 1024 * 1024) {
        throw new Error("Select a PNG, JPEG, or WebP image no larger than 3 MB.");
    }
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener("load", () => {
            if (typeof reader.result !== "string") reject(new Error("The selected image could not be read."));
            else resolve(reader.result);
        }, { once: true });
        reader.addEventListener("error", () => reject(new Error("The selected image could not be read.")), { once: true });
        reader.readAsDataURL(file);
    });
}

if (machineryForm) {
    if (!ownerToken || !signedInOwner) {
        window.location.replace("login.html");
    } else if (signedInOwner.role === "farmer") {
        window.location.replace("farmer-dashboard.html");
    } else if (signedInOwner.role !== "owner") {
        window.location.replace("login.html");
    } else {
        applyOwnerLocationDefaults();
        initializeOwnerMaps();
        loadListings();
        void loadOwnerMessages();
    }
    window.addEventListener("owner-add-section-open", () => {
        window.setTimeout(() => pickupMap?.invalidateSize(), 0);
    });

    cancelEditButton.addEventListener("click", resetListingForm);
    pickupAddressInput?.addEventListener("input", handlePickupSearchInput);
    pickupAddressInput?.addEventListener("keydown", event => {
        if (event.key === "Escape" && pickupSearchResults) {
            pickupSearchResults.hidden = true;
        } else if (event.key === "Enter" && pickupSearchResults && !pickupSearchResults.hidden) {
            const firstResult = pickupSearchResults.querySelector(".location-search-result");
            if (firstResult) {
                event.preventDefault();
                firstResult.click();
            }
        }
    });
    pickupAddressInput?.addEventListener("focus", () => {
        if (pickupSearchResults && pickupAddressInput.value.trim().length >= 2) {
            void searchPickupLocations(pickupAddressInput.value.trim());
        }
    });
    useCurrentPickupLocationButton?.addEventListener("click", useCurrentPickupLocation);
    pickupSearchResults?.addEventListener("keydown", event => {
        if (event.key === "Escape") pickupSearchResults.hidden = true;
    });
    document.getElementById("latitude")?.addEventListener("change", handlePickupCoordinateChange);
    document.getElementById("longitude")?.addEventListener("change", handlePickupCoordinateChange);
    machineryForm.addEventListener("submit", async event => {
        event.preventDefault();
        if (!ownerToken || signedInOwner?.role !== "owner") return;
        submitButton.disabled = true;
        setSubmitButtonLabel(editingListingId ? "Saving Changes…" : "Publishing Listing…", true);
        messageElement.textContent = "";
        let serverRequestStarted = false;

        try {
            const latitude = Number(document.getElementById("latitude").value);
            const longitude = Number(document.getElementById("longitude").value);
            if (
                !document.getElementById("latitude").value ||
                !document.getElementById("longitude").value ||
                !Number.isFinite(latitude) ||
                !Number.isFinite(longitude) ||
                !isWithinOwnerServiceArea(latitude, longitude)
            ) {
                throw new Error("Select a valid pickup point within 25 km of Sullia before publishing.");
            }
            if (!pickupAddressInput.value.trim()) {
                throw new Error("Select a pickup village or address from search or the map.");
            }
            const specifications = {};
            if (editingLegacyCategory && activeEditingListing?.specifications &&
                typeof activeEditingListing.specifications === "object" &&
                !Array.isArray(activeEditingListing.specifications)) {
                Object.assign(specifications, activeEditingListing.specifications);
            }
            specificationFields.querySelectorAll("[data-specification]").forEach(input => {
                if (input.value !== "") specifications[input.dataset.specification] = input.type === "number" ? Number(input.value) : input.value.trim();
            });
            const supportedFeatures = document.getElementById("supportedFeatures").value
                .split(",").map(feature => feature.trim()).filter(Boolean);
            if (supportedFeatures.length) specifications.supported_features = supportedFeatures;
            else delete specifications.supported_features;
            if (document.getElementById("condition").value.trim()) {
                specifications.condition = document.getElementById("condition").value.trim();
            } else delete specifications.condition;
            const payload = {
                name: document.getElementById("name").value.trim(),
                ...(categoryInput.value ? { type: categoryInput.value } : {}),
                brand: document.getElementById("brand").value.trim(),
                model: document.getElementById("model").value.trim(),
                description: document.getElementById("description").value.trim(),
                price: Number(document.getElementById("price").value),
                price_unit: document.getElementById("priceUnit").value,
                location: document.getElementById("location").value.trim(),
                latitude: Number(document.getElementById("latitude").value),
                longitude: Number(document.getElementById("longitude").value),
                availability: document.getElementById("availability").checked,
                ...(!editingLegacyCategory || categoryInput.value || Object.keys(specifications).length
                    ? { specifications }
                    : {}),
                availability_start_date: document.getElementById("availabilityStartDate").value || null,
                availability_end_date: document.getElementById("availabilityEndDate").value || null,
                availability_start_time: formatAvailabilityTime(document.getElementById("availabilityStartTime").value) || null,
                availability_end_time: formatAvailabilityTime(document.getElementById("availabilityEndTime").value) || null
            };
            const photo = await imageDataUrl();
            if (photo) payload.image_url = photo;
            serverRequestStarted = true;
            const result = await AgriMachApi.request(
                `/machinery-owner${editingListingId ? `/${editingListingId}` : ""}`,
                {
                    method: editingListingId ? "PUT" : "POST",
                    headers: authHeaders(true),
                    body: JSON.stringify(payload)
                }
            );
            setMessage(messageElement, result.message || "Machinery listing saved.");
            showOwnerFormToast(result.message || "Machinery listing saved.");
            resetListingForm();
            await loadListings();
        } catch (error) {
            console.error("Machinery listing save failed:", error);
            setMessage(messageElement, error.message || "Could not save the machinery listing.", true);
            if (serverRequestStarted) showOwnerFormToast(error.message || "The server could not save this listing.", true);
        } finally {
            submitButton.disabled = false;
            setSubmitButtonLabel(editingListingId ? "Save Listing Changes" : "Publish Machinery Listing");
        }
    });
}

document.getElementById("ownerChatClose")?.addEventListener("click", () => chatDialog.close());
chatForm?.addEventListener("submit", async event => {
    event.preventDefault();
    const input = document.getElementById("ownerChatInput");
    const sendButton = document.getElementById("ownerChatSend");
    const messageText = input.value.trim();
    if (!activeConversationId || !messageText) return;
    sendButton.disabled = true;
    chatStatus.className = "form-feedback";
    chatStatus.textContent = "";
    try {
        await AgriMachApi.request(
            `/chat/conversations/${encodeURIComponent(activeConversationId)}/messages`,
            {
                method: "POST",
                headers: authHeaders(true),
                body: JSON.stringify({ message_text: messageText })
            }
        );
        input.value = "";
        const result = await AgriMachApi.request(
            `/chat/conversations/${encodeURIComponent(activeConversationId)}/messages`,
            { headers: authHeaders() }
        );
        if (!Array.isArray(result?.messages)) throw new Error("The chat service returned an invalid message history.");
        renderOwnerChatMessages(result.messages);
        await loadOwnerMessages();
    } catch (error) {
        console.error("Owner message send failed:", error);
        chatStatus.className = "form-feedback error";
        chatStatus.textContent = error.message || "Could not send this message.";
    } finally {
        sendButton.disabled = false;
    }
});
const ownerMessageRefreshTimer = window.setInterval(() => {
    if (!document.hidden && !chatDialog?.open) void loadOwnerMessages();
}, 30000);
window.addEventListener("beforeunload", () => window.clearInterval(ownerMessageRefreshTimer));

categoryInput?.addEventListener("change", () => {
    if (categoryInput.value) {
        editingLegacyCategory = false;
        categoryInput.required = true;
    }
    renderSpecificationFields(categoryInput.value);
    renderMachineryPhotoPreview(categoryInput.value, photoPreviewUrl || activeEditingListing?.image_url || "");
});
imageInput?.addEventListener("change", () => {
    const file = imageInput.files?.[0];
    if (!file) {
        if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
        photoPreviewUrl = null;
        renderMachineryPhotoPreview(categoryInput?.value || "", activeEditingListing?.image_url || "");
        return;
    }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 3 * 1024 * 1024) {
        setMessage(messageElement, "Select a PNG, JPEG, or WebP image no larger than 3 MB.", true);
        if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
        photoPreviewUrl = null;
        imageInput.value = "";
        renderMachineryPhotoPreview(categoryInput?.value || "", activeEditingListing?.image_url || "");
        return;
    }
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    photoPreviewUrl = URL.createObjectURL(file);
    renderMachineryPhotoPreview(categoryInput?.value || "", photoPreviewUrl);
});
removeMachinePhotoButton?.addEventListener("click", () => {
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    photoPreviewUrl = null;
    imageInput.value = "";
    renderMachineryPhotoPreview(categoryInput?.value || "", activeEditingListing?.image_url || "");
});
renderSpecificationFields(categoryInput?.value || "");
setupOwnerStatDialog();
window.addEventListener("owner-add-section-open", () => {
    window.setTimeout(() => {
        ownerMap?.invalidateSize();
        pickupMap?.invalidateSize();
    }, 0);
});
renderMachineryPhotoPreview(categoryInput?.value || "");
