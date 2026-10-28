const DEFAULT_CENTER = { latitude: 12.561, longitude: 75.387 };
const DEFAULT_RADIUS_KM = 25;
const PHOTON_API_URL = "https://photon.komoot.io/api/";
const PHOTON_REVERSE_URL = "https://photon.komoot.io/reverse";
const GOOGLE_MAPS_API_KEY = window.AGRIMACHCONNECT_MAP_CONFIG?.googleMapsApiKey?.trim() || "";
const ROLE_PERMISSIONS_TOKEN_KEY = "rolePermissionsToken";

const form = document.getElementById("roleLocationForm");
const message = document.getElementById("roleLocationMessage");
const submitButton = document.getElementById("confirmRoleLocation");
const mapElement = document.getElementById("locationMap");
const mapProvider = document.getElementById("mapProvider");
const searchInput = document.getElementById("locationSearch");
const resultsContainer = document.getElementById("locationSearchResults");
const currentLocationButton = document.getElementById("useCurrentLocation");
const radiusStatus = document.getElementById("radiusStatus");
const selectedLocationName = document.getElementById("selectedLocationName");
const mapAttribution = document.getElementById("mapAttribution");
const mapMessage = document.getElementById("mapMessage");
const latitudeOutput = document.getElementById("selectedLatitude");
const longitudeOutput = document.getElementById("selectedLongitude");
const roleInputs = Array.from(document.querySelectorAll('input[name="role"]'));
const logoutLink = document.getElementById("logoutLink");
const ownerAccessRequestButton = document.getElementById("ownerAccessRequest");

let currentUser = null;
let selectedRole = "";
let selectedLocation = "Sullia, Dakshina Kannada, Karnataka, India";
let selectedCoordinates = { ...DEFAULT_CENTER };
let mapCenter = { ...DEFAULT_CENTER };
let radiusKm = DEFAULT_RADIUS_KM;
let activeMap = null;
let mapMarker = null;
let radiusCircle = null;
let activeProvider = "";
let mapResizeObserver = null;
let leafletFallbackPromise = null;
let searchTimer = null;
let reverseTimer = null;
let mapTileErrorTimer = null;
let lastPhotonRequestAt = 0;
let searchRequestId = 0;
let photonQueue = Promise.resolve();

function distanceKm(first, second) {
    const radians = degrees => degrees * Math.PI / 180;
    const latitudeDelta = radians(second.latitude - first.latitude);
    const longitudeDelta = radians(second.longitude - first.longitude);
    const angle = 2 * Math.asin(Math.sqrt(
        Math.sin(latitudeDelta / 2) ** 2 +
        Math.cos(radians(first.latitude)) *
        Math.cos(radians(second.latitude)) *
        Math.sin(longitudeDelta / 2) ** 2
    ));
    return 6371 * angle;
}

function showMessage(text, isError = true) {
    message.textContent = text;
    message.className = `form-feedback ${isError ? "error" : "success"}`;
}

function getAllowedRoles() {
    const roles = currentUser?.permitted_roles;
    return Array.isArray(roles)
        ? roles.filter(role => ["farmer", "owner"].includes(role))
        : ["farmer", "owner"].includes(currentUser?.role)
            ? [currentUser.role]
            : [];
}

function configureRoleChoices() {
    selectedRole = currentUser?.role === "owner" ? "owner" : "farmer";
    const iconEl = document.getElementById("roleBadgeIcon");
    const titleEl = document.getElementById("roleBadgeTitle");
    const descEl = document.getElementById("roleBadgeDescription");
    if (selectedRole === "owner") {
        if (iconEl) iconEl.textContent = "🚜";
        if (titleEl) titleEl.textContent = "Machinery Owner Account";
        if (descEl) descEl.textContent = "Your Machinery Owner role is permanent and cannot be changed.";
    } else {
        if (iconEl) iconEl.textContent = "🌾";
        if (titleEl) titleEl.textContent = "Farmer Account";
        if (descEl) descEl.textContent = "Your Farmer role is permanent and cannot be changed.";
    }
}

async function loadOwnerAccessRequest() {
    // Roles are permanent and fixed at registration.
    if (ownerAccessRequestButton) {
        ownerAccessRequestButton.hidden = true;
    }
}

function validCoordinates(latitude, longitude) {
    return Number.isFinite(latitude) &&
        Number.isFinite(longitude) &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180;
}

function savedLocationFromUser(user) {
    const latitudeValue = user.selected_latitude ?? user.farm_latitude;
    const longitudeValue = user.selected_longitude ?? user.farm_longitude;
    if (latitudeValue == null || longitudeValue == null) return;

    const latitude = Number(latitudeValue);
    const longitude = Number(longitudeValue);
    if (validCoordinates(latitude, longitude)) {
        selectedCoordinates = { latitude, longitude };
        selectedLocation = user.selected_location || user.farm_location || selectedLocation;
    }
}

function updateOsmMapLocation() {
    if (activeProvider !== "osm" || !activeMap) return;
    radiusCircle?.setLatLng([mapCenter.latitude, mapCenter.longitude]);
    radiusCircle?.setRadius(radiusKm * 1000);
    mapMarker?.setLatLng([selectedCoordinates.latitude, selectedCoordinates.longitude]);
    activeMap.setView([selectedCoordinates.latitude, selectedCoordinates.longitude], 12);
    invalidateOsmMap();
}

function renderSelection() {
    selectedLocationName.textContent = selectedLocation;
    latitudeOutput.textContent = selectedCoordinates.latitude.toFixed(6);
    longitudeOutput.textContent = selectedCoordinates.longitude.toFixed(6);
    const hasValidLocation = typeof selectedLocation === "string" &&
        selectedLocation.trim().length > 0 &&
        validCoordinates(selectedCoordinates.latitude, selectedCoordinates.longitude);
    const distance = hasValidLocation
        ? distanceKm(mapCenter, selectedCoordinates)
        : Number.POSITIVE_INFINITY;
    const insideRadius = hasValidLocation && distance <= radiusKm;
    radiusStatus.textContent = insideRadius
        ? `${distance.toFixed(1)} km from Sullia · within the ${radiusKm} km area`
        : hasValidLocation
            ? `${distance.toFixed(1)} km from Sullia · outside the ${radiusKm} km area`
            : "Select a valid location within the service area.";
    radiusStatus.classList.toggle("radius-status-outside", !insideRadius);
    submitButton.disabled = !selectedRole ||
        !getAllowedRoles().includes(selectedRole) ||
        !insideRadius;
}

function updateMarker(latitude, longitude) {
    if (activeProvider === "osm" && mapMarker) {
        mapMarker.setLatLng([latitude, longitude]);
    } else if (activeProvider === "google" && mapMarker) {
        mapMarker.setPosition({ lat: latitude, lng: longitude });
    }
}

function selectCoordinates(latitude, longitude, label, reverseGeocode = false, zoom) {
    if (!validCoordinates(latitude, longitude)) {
        showMessage("The selected map location has invalid coordinates. Choose another location.");
        return;
    }
    selectedCoordinates = { latitude, longitude };
    if (label) selectedLocation = label;
    updateMarker(latitude, longitude);
    renderSelection();
    if (activeProvider === "osm" && activeMap) {
        activeMap.setView([latitude, longitude], zoom ?? activeMap.getZoom());
    } else if (activeProvider === "google" && activeMap) {
        activeMap.setCenter({ lat: latitude, lng: longitude });
        if (zoom != null) activeMap.setZoom(zoom);
    }
    if (reverseGeocode) scheduleReverseGeocode(latitude, longitude);
}

function invalidateOsmMap() {
    if (activeProvider === "osm" && typeof activeMap?.invalidateSize === "function") {
        activeMap.invalidateSize({ pan: false });
    }
}

function loadLeafletFallback() {
    if (window.L) return Promise.resolve();
    if (!leafletFallbackPromise) {
        leafletFallbackPromise = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js";
            script.onload = () => window.L
                ? resolve()
                : reject(new Error("The Leaflet map library did not initialize."));
            script.onerror = () => reject(new Error("Leaflet could not load from either configured CDN."));
            document.head.append(script);
        });
    }
    return leafletFallbackPromise;
}

function initializeOsmMap() {
    if (!window.L) {
        showMessage("Loading the map library…", false);
        loadLeafletFallback()
            .then(initializeOsmMap)
            .catch(error => {
                console.error("Leaflet could not be loaded:", error);
                showMessage("The map library could not load from either CDN. Check your internet connection and reload this page.");
            });
        return;
    }
    if (activeMap && activeProvider === "osm") return;
    if (activeProvider === "osm" && activeMap) activeMap.remove();
    mapElement.replaceChildren();
    const center = [mapCenter.latitude, mapCenter.longitude];
    activeMap = window.L.map(mapElement).setView(
        [selectedCoordinates.latitude, selectedCoordinates.longitude],
        12
    );
    const tileLayer = window.L.tileLayer("https://tile.openstreetmap.de/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> · Tiles by OpenStreetMap.de / OpenStreetMap'
    }).addTo(activeMap);
    let loadedTiles = 0;
    const tileErrors = new Set();
    let triedFallbackTiles = false;
    tileLayer.on("loading", () => {
        loadedTiles = 0;
        tileErrors.clear();
        clearTimeout(mapTileErrorTimer);
        mapMessage.hidden = true;
    });
    tileLayer.on("tileload", event => {
        loadedTiles += 1;
        tileErrors.delete(event.coords.x + ":" + event.coords.y + ":" + event.coords.z);
        clearTimeout(mapTileErrorTimer);
        mapMessage.hidden = true;
    });
    tileLayer.on("tileerror", event => {
        tileErrors.add(event.coords.x + ":" + event.coords.y + ":" + event.coords.z);
        clearTimeout(mapTileErrorTimer);
        mapTileErrorTimer = window.setTimeout(() => {
            if (loadedTiles === 0 && tileErrors.size > 0) {
                if (!triedFallbackTiles) {
                    triedFallbackTiles = true;
                    mapMessage.textContent = "OpenStreetMap.de tiles are unavailable; trying the OpenStreetMap tile service…";
                    mapMessage.hidden = false;
                    tileLayer.setUrl("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png");
                } else {
                    mapMessage.textContent = "Map tiles could not load. Check your internet connection or try again; you can still search for a village.";
                    mapMessage.hidden = false;
                }
            }
        }, 1400);
    });
    radiusCircle = window.L.circle(center, {
        radius: radiusKm * 1000,
        color: "#d97706",
        weight: 2,
        fillColor: "#fbbf24",
        fillOpacity: 0.12
    }).addTo(activeMap);
    const markerIcon = window.L.divIcon({
        className: "location-marker-shell",
        html: '<span class="location-marker-pin" aria-hidden="true"></span>',
        iconSize: [34, 44],
        iconAnchor: [17, 42]
    });
    mapMarker = window.L.marker(
        [selectedCoordinates.latitude, selectedCoordinates.longitude],
        { draggable: true, icon: markerIcon, title: "Selected location" }
    ).addTo(activeMap);
    activeMap.on("click", event => {
        selectCoordinates(event.latlng.lat, event.latlng.lng, "Selected map location", true);
    });
    mapMarker.on("dragend", event => {
        const point = event.target.getLatLng();
        selectCoordinates(point.lat, point.lng, selectedLocation, true);
    });
    activeProvider = "osm";
    mapAttribution.innerHTML = 'Map data &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>. Tiles by <a href="https://www.openstreetmap.de/" target="_blank" rel="noreferrer">OpenStreetMap.de</a>. Search by <a href="https://photon.komoot.io/" target="_blank" rel="noreferrer">Photon</a>.';
    mapResizeObserver?.disconnect();
    if ("ResizeObserver" in window) {
        mapResizeObserver = new ResizeObserver(invalidateOsmMap);
        mapResizeObserver.observe(mapElement);
    }
    requestAnimationFrame(invalidateOsmMap);
    window.setTimeout(invalidateOsmMap, 250);
    renderSelection();
}

function loadGoogleMaps() {
    if (window.google?.maps) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        window.initAgriMachGoogleMap = resolve;
        window.gm_authFailure = () => reject(new Error("Google Maps rejected the configured key."));
        script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&callback=initAgriMachGoogleMap`;
        script.async = true;
        script.onerror = () => reject(new Error("Google Maps could not be loaded."));
        document.head.append(script);
    });
}

async function initializeGoogleMap() {
    if (!GOOGLE_MAPS_API_KEY) {
        throw new Error("Add a browser-restricted Google Maps JavaScript API key to frontend/map-config.js to enable Google Maps.");
    }
    await loadGoogleMaps();
    if (activeProvider === "osm" && activeMap) activeMap.remove();
    mapElement.replaceChildren();
    const center = { lat: mapCenter.latitude, lng: mapCenter.longitude };
    activeMap = new window.google.maps.Map(mapElement, {
        center: { lat: selectedCoordinates.latitude, lng: selectedCoordinates.longitude },
        zoom: 12,
        mapTypeControl: false,
        streetViewControl: false
    });
    radiusCircle = new window.google.maps.Circle({
        map: activeMap,
        center,
        radius: radiusKm * 1000,
        strokeColor: "#d97706",
        strokeOpacity: 0.9,
        strokeWeight: 2,
        fillColor: "#fbbf24",
        fillOpacity: 0.12
    });
    mapMarker = new window.google.maps.Marker({
        map: activeMap,
        position: { lat: selectedCoordinates.latitude, lng: selectedCoordinates.longitude },
        draggable: true
    });
    activeMap.addListener("click", event => {
        selectCoordinates(event.latLng.lat(), event.latLng.lng(), "Selected map location", true);
    });
    mapMarker.addListener("dragend", event => {
        selectCoordinates(event.latLng.lat(), event.latLng.lng(), selectedLocation, true);
    });
    activeProvider = "google";
    mapAttribution.textContent = "Map © Google Maps. Location search by Photon.";
}

async function changeMapProvider() {
    try {
        if (mapProvider.value === "google") {
            await initializeGoogleMap();
        } else {
            initializeOsmMap();
        }
        renderSelection();
    } catch (error) {
        mapProvider.value = "osm";
        initializeOsmMap();
        showMessage(`${error.message} OpenStreetMap is still available.`);
    }
}

function photonRequest(url) {
    const request = photonQueue.then(async () => {
        const wait = Math.max(0, 1100 - (Date.now() - lastPhotonRequestAt));
        if (wait) await new Promise(resolve => setTimeout(resolve, wait));
        const response = await fetch(url);
        lastPhotonRequestAt = Date.now();
        if (!response.ok) {
            throw new Error(`Location search service returned HTTP ${response.status}.`);
        }
        return response.json();
    });
    photonQueue = request.catch(() => {});
    return request;
}

function photonLabel(properties) {
    const locality = properties.name || properties.locality || properties.street;
    const area = properties.district || properties.county || properties.city;
    const state = properties.state;
    return [locality, area, state, properties.country].filter((part, index, parts) =>
        part && parts.indexOf(part) === index
    ).join(", ");
}

function searchQueries(query) {
    const normalized = query.toLowerCase().replace(/[^a-z]/g, "");
    if (normalized === "aivarnadu" || normalized === "ivarnadu") {
        return ["Aivarnadu", "Ivarnadu", "Ivar Nadu"];
    }
    if (normalized === "sullia") {
        return ["Sullia", "Sulya"];
    }
    return [query];
}

function matchesSearchQuery(feature, query) {
    const searchableText = Object.values(feature.properties || {})
        .filter(value => typeof value === "string")
        .join(" ")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, "");
    return searchQueries(query).some(variant => {
        const needle = variant.toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]/g, "");
        return needle.length > 1 && searchableText.includes(needle);
    });
}

function renderSearchResults(features) {
    resultsContainer.replaceChildren();
    if (!features.length) {
        const empty = document.createElement("p");
        empty.className = "location-search-empty";
        empty.textContent = "No matching places were found within 25 km. Try another spelling or refine your search.";
        resultsContainer.append(empty);
        resultsContainer.hidden = false;
        return;
    }

    features.forEach(feature => {
        const [longitude, latitude] = feature.geometry.coordinates;
        const label = photonLabel(feature.properties);
        if (!label || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
        const result = document.createElement("button");
        result.type = "button";
        result.className = "location-search-result";
        result.setAttribute("role", "option");
        result.textContent = label;
        result.addEventListener("click", () => {
            resultsContainer.hidden = true;
            selectCoordinates(latitude, longitude, label, false, 16);
        });
        resultsContainer.append(result);
    });
    resultsContainer.hidden = resultsContainer.childElementCount === 0;
}

function showSearchStatus(text) {
    resultsContainer.replaceChildren();
    const status = document.createElement("p");
    status.className = "location-search-empty";
    status.textContent = text;
    resultsContainer.append(status);
    resultsContainer.hidden = false;
}

async function searchLocations(query) {
    const requestId = ++searchRequestId;
    const variants = searchQueries(query);
    const allFeatures = [];
    try {
        for (const variant of variants) {
            const url = new URL(PHOTON_API_URL);
            url.searchParams.set("q", `${variant} Sullia Dakshina Kannada Karnataka India`);
            url.searchParams.set("lat", String(mapCenter.latitude));
            url.searchParams.set("lon", String(mapCenter.longitude));
            url.searchParams.set("limit", "10");
            url.searchParams.set("lang", "en");
            const result = await photonRequest(url);
            if (requestId !== searchRequestId || searchInput.value.trim() !== query) return;
            const nearbyFeatures = (result.features || []).filter(feature => {
                const [longitude, latitude] = feature.geometry.coordinates;
                return Number.isFinite(latitude) &&
                    Number.isFinite(longitude) &&
                    distanceKm(mapCenter, { latitude, longitude }) <= radiusKm &&
                    matchesSearchQuery(feature, query);
            });
            allFeatures.push(...nearbyFeatures);
            if (nearbyFeatures.length) break;
        }
        if (requestId !== searchRequestId || searchInput.value.trim() !== query) return;
        const unique = new Map();
        allFeatures.forEach(feature => {
            const [longitude, latitude] = feature.geometry.coordinates;
            if (
                Number.isFinite(latitude) &&
                Number.isFinite(longitude) &&
                distanceKm(mapCenter, { latitude, longitude }) <= radiusKm
            ) {
                const label = photonLabel(feature.properties);
                if (label) unique.set(`${latitude},${longitude},${label}`, feature);
            }
        });
        renderSearchResults(Array.from(unique.values()));
    } catch (error) {
        if (requestId !== searchRequestId || searchInput.value.trim() !== query) return;
        resultsContainer.replaceChildren();
        const failure = document.createElement("p");
        failure.className = "location-search-empty";
        failure.textContent = "Location search is temporarily unavailable. Check your connection and try again.";
        resultsContainer.append(failure);
        resultsContainer.hidden = false;
        console.error("Village search failed:", error);
    }
}

function scheduleReverseGeocode(latitude, longitude) {
    clearTimeout(reverseTimer);
    reverseTimer = setTimeout(async () => {
        const url = new URL(PHOTON_REVERSE_URL);
        url.searchParams.set("lat", String(latitude));
        url.searchParams.set("lon", String(longitude));
        url.searchParams.set("lang", "en");
        try {
            const result = await photonRequest(url);
            const feature = result.features?.[0];
            if (feature) {
                const label = photonLabel(feature.properties);
                if (label) {
                    selectedLocation = label;
                    renderSelection();
                }
            }
        } catch (error) {
            console.warn("Could not look up the selected address:", error.message);
        }
    }, 450);
}

async function loadLocationConfig() {
    const config = await AgriMachApi.request("/auth/location-config");
    if (
        !Number.isFinite(config.center?.latitude) ||
        !Number.isFinite(config.center?.longitude) ||
        !Number.isFinite(config.radiusKm) ||
        config.radiusKm <= 0
    ) {
        throw new Error("The server returned invalid location settings.");
    }
    mapCenter = config.center;
    radiusKm = config.radiusKm;
    if (
        currentUser.selected_latitude == null &&
        currentUser.farm_latitude == null
    ) {
        selectedCoordinates = { ...mapCenter };
    }
    mapProvider.querySelector('option[value="google"]').disabled = !GOOGLE_MAPS_API_KEY;
    if (GOOGLE_MAPS_API_KEY) {
        mapProvider.querySelector('option[value="google"]').textContent = "Google Maps";
    }
    updateOsmMapLocation();
    renderSelection();
}

async function initializePage() {
    const token = localStorage.getItem("token");
    if (!token) {
        window.location.replace("login.html");
        return;
    }

    try {
        const session = await AgriMachApi.request("/auth/session", {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (typeof session?.token !== "string" || !session.token) {
            throw new Error("The server could not refresh your role-selection session. Please log in again.");
        }
        currentUser = session?.user;
        if (
            !currentUser ||
            !Array.isArray(currentUser.permitted_roles) ||
            !currentUser.permitted_roles.length
        ) {
            throw new Error("The server returned incomplete account permissions. Please log in again.");
        }
        localStorage.setItem("token", session.token);
        localStorage.setItem("user", JSON.stringify(currentUser));
        localStorage.removeItem(ROLE_PERMISSIONS_TOKEN_KEY);
    } catch (error) {
        if (error?.status !== 404) {
            console.error("Current account permissions could not be loaded:", error);
            showMessage(error instanceof Error
                ? error.message
                : "Your account permissions could not be verified.");
            return;
        }

        const permissionsFromCurrentLogin =
            localStorage.getItem(ROLE_PERMISSIONS_TOKEN_KEY) === token;
        localStorage.removeItem(ROLE_PERMISSIONS_TOKEN_KEY);
        if (!permissionsFromCurrentLogin) {
            localStorage.removeItem("token");
            localStorage.removeItem("user");
            window.location.replace("login.html?permissionsRefresh=required");
            return;
        }

        try {
            const cachedUser = JSON.parse(localStorage.getItem("user") || "null");
            const cachedRoles = Array.isArray(cachedUser?.permitted_roles)
                ? cachedUser.permitted_roles
                : cachedUser?.allowed_roles;
            if (
                !cachedUser ||
                typeof cachedUser !== "object" ||
                !Array.isArray(cachedRoles) ||
                !cachedRoles.some(role => ["farmer", "owner"].includes(role))
            ) {
                throw new Error("No valid signed-in account permissions are available.");
            }
            currentUser = { ...cachedUser, permitted_roles: cachedRoles };
            showMessage(
                "This backend cannot refresh permissions. Using the permissions returned by your latest login; if access changes, log out and sign in again. The server still verifies every role selection.",
                false
            );
            console.warn("Account session refresh route is unavailable; using permissions from the current login only.");
        } catch (cacheError) {
            console.error("Cached account permissions could not be loaded:", cacheError);
            showMessage("Account permissions could not be refreshed or recovered from this login. Please log in again or update the backend.");
            return;
        }
    }

    configureRoleChoices();
    if (!selectedRole) {
        showMessage("Your account has no permitted role. Please log in again or contact support.");
        return;
    }
    if (!Array.isArray(currentUser.permitted_roles) && !Array.isArray(currentUser.allowed_roles)) {
        showMessage("Your account permissions could not be verified. Please log in again.");
        return;
    }
    savedLocationFromUser(currentUser);
    updateOsmMapLocation();
    renderSelection();
    await loadOwnerAccessRequest();
    try {
        await loadLocationConfig();
    } catch (error) {
        renderSelection();
        showMessage(error.message);
    }
}


logoutLink?.addEventListener("click", () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem(ROLE_PERMISSIONS_TOKEN_KEY);
});

searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchRequestId += 1;
    const query = searchInput.value.trim();
    if (query.length < 2) {
        resultsContainer.hidden = true;
        resultsContainer.replaceChildren();
        return;
    }
    searchTimer = setTimeout(() => {
        showSearchStatus("Searching nearby villages…");
        searchLocations(query);
    }, 450);
});

document.addEventListener("click", event => {
    if (!resultsContainer.contains(event.target) && event.target !== searchInput) {
        resultsContainer.hidden = true;
    }
});

currentLocationButton.addEventListener("click", () => {
    if (!navigator.geolocation) {
        showMessage("Your browser does not support location access. Search for your village or place a pin on the map.");
        return;
    }
    currentLocationButton.disabled = true;
    currentLocationButton.textContent = "Finding location...";
    navigator.geolocation.getCurrentPosition(
        position => {
            const { latitude, longitude } = position.coords;
            selectCoordinates(latitude, longitude, "Current location", true);
            if (distanceKm(mapCenter, { latitude, longitude }) > radiusKm) {
                showMessage(`Your current location is outside the ${radiusKm} km area around Sullia. Move the pin or choose a nearby result.`);
            } else {
                showMessage("Current location selected. Review the pin, then confirm to continue.", false);
            }
            currentLocationButton.disabled = false;
            currentLocationButton.textContent = "Use My Current Location";
        },
        error => {
            const reason = error.code === error.PERMISSION_DENIED
                ? "Location permission was denied. Allow location access or search for your village."
                : error.code === error.POSITION_UNAVAILABLE
                    ? "Your current location is unavailable. Search for your village or place a pin on the map."
                    : "Location request timed out. Try again or search for your village.";
            showMessage(reason);
            currentLocationButton.disabled = false;
            currentLocationButton.textContent = "Use My Current Location";
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
});

mapProvider.addEventListener("change", changeMapProvider);

form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!getAllowedRoles().includes(selectedRole)) {
        showMessage("Your account is not permitted to use the selected role.");
        return;
    }
    if (
        typeof selectedLocation !== "string" ||
        !selectedLocation.trim() ||
        !validCoordinates(selectedCoordinates.latitude, selectedCoordinates.longitude)
    ) {
        showMessage("Select a valid village or address before continuing.");
        return;
    }
    if (distanceKm(mapCenter, selectedCoordinates) > radiusKm) {
        showMessage(`Choose a location within ${radiusKm} km of Sullia, Karnataka.`);
        return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "Saving your location...";
    message.textContent = "";
    try {
        const data = await AgriMachApi.request("/auth/confirm-location", {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${localStorage.getItem("token")}`
            },
            body: JSON.stringify({
                role: selectedRole,
                location: selectedLocation,
                latitude: selectedCoordinates.latitude,
                longitude: selectedCoordinates.longitude
            })
        });
        localStorage.setItem("token", data.token);
        localStorage.setItem("user", JSON.stringify(data.user));
        window.location.assign(selectedRole === "owner" ? "owner-dashboard.html" : "farmer-dashboard.html");
    } catch (error) {
        console.error("Role and location confirmation failed:", error);
        showMessage(error?.status === 404
            ? "The running backend did not recognize PATCH /api/auth/confirm-location. This project registers that authenticated route; restart or update the backend instance, then try again. Your location was not saved."
            : error instanceof Error
                ? error.message
                : "Role and location could not be saved.");
    } finally {
        submitButton.textContent = "Confirm Location & Continue";
        renderSelection();
    }
});

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
        initializeOsmMap();
        void initializePage();
    }, { once: true });
} else {
    initializeOsmMap();
    void initializePage();
}
