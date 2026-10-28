const machineryContainer = document.getElementById("machineryList");
const bookingContainer = document.getElementById("farmerBookingList");
const farmerLocationName = document.getElementById("farmerLocationName");
const resultsSummary = document.getElementById("resultsSummary");
const errorElement = document.getElementById("machineryError");
const filterMessage = document.getElementById("filterMessage");
const searchInput = document.getElementById("machinerySearchInput");
const minPriceInput = document.getElementById("minPrice");
const maxPriceInput = document.getElementById("maxPrice");
const villageFilterInput = document.getElementById("villageFilter");
const availabilityFilterInput = document.getElementById("availabilityFilter");
const tankCapacityInput = document.getElementById("sprayerTankCapacity");
const horsepowerRangeInput = document.getElementById("tractorHorsepowerRange");
const horsepowerFilter = document.getElementById("tractorHorsepowerFilter");
const dateInput = document.getElementById("availabilityDate");
const startInput = document.getElementById("availabilityStart");
const endInput = document.getElementById("availabilityEnd");
const dialog = document.getElementById("machineryDialog");
const bookingForm = document.getElementById("bookingForm");
const bookingMessage = document.getElementById("bookingMessage");
const bookingSubmit = document.getElementById("bookingSubmit");
const bookingEstimate = document.getElementById("bookingEstimate");
const dialogMachineDetails = document.getElementById("dialogMachineDetails");
const bookingSummary = document.getElementById("bookingSummary");
const mapSection = document.getElementById("machineryMapSection");

const categoryCards = Array.from(document.querySelectorAll(".market-category-card"));
const showAllCategoriesButton = document.getElementById("showAllCategories");
const radiusButtons = Array.from(document.querySelectorAll(".radius-button"));
const DEFAULT_RADIUS_KM = 25;
const DEFAULT_CENTER = { latitude: 12.561, longitude: 75.387 };
const CATEGORIES = {
    tractor: { title: "Tractor", icon: "🚜", image: "images/Mahindra%20Tractor%20in%20Sunny%20Fields.png" },
    harvester: { title: "Harvester", icon: "🌾", image: "images/8.%20Combine%20Harvester%20Working%2C%20Uses%2C%20and%20Importance-min%20(1)_0.jpg.jpeg" },
    rotavator: { title: "Tiller / Rotavator", icon: "⚙️", image: "images/Tractor-Mounted-Rotavator.jpg" },
    "power-tiller": { title: "Power Tiller", icon: "⚙️", image: "images/Walk-Behind-Power-Tiller.jpg" },
    "adike-sprayer": { title: "Adike (Arecanut) Sprayer", icon: "🌴", image: "images/Areca%20Palm%20Orchard%20Sprayer%20in%20Mist.png" },
    drone: { title: "Agricultural Drone", icon: "🛸", image: "images/Agricultural%20Drone%20Spraying%20Green%20Crops.png" },
    trailer: { title: "Trailer", icon: "🚛", image: "images/trailer.jpg" }
};

let signedInUser = null;
let token = localStorage.getItem("token");
let farmerCoordinates = null;
let radiusKm = DEFAULT_RADIUS_KM;
let category = "all";
let machinery = [];
let selectedMachine = null;
let map = null;
let mapMarkers = null;
let farmerMarker = null;
let searchTerm = "";
let searchTimer = null;
let resultView = "list";
let refreshTimer = null;

function localDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function tomorrowDateString() {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return localDateString(date);
}

function apiHeaders(json = false) {
    return {
        ...(json ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${token}`
    };
}

function calculateDistanceKm(first, second) {
    const radians = value => value * Math.PI / 180;
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

function money(value) {
    const amount = Number(value);
    return Number.isFinite(amount)
        ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount)
        : "Price not provided";
}

function readableBookingDate(value) {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime())
        ? String(value || "Date unavailable")
        : new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function selectedSchedule() {
    return {
        booking_date: dateInput.value,
        start_time: startInput.value,
        end_time: endInput.value
    };
}

function validSchedule(schedule) {
    return Boolean(
        schedule.booking_date &&
        schedule.start_time &&
        schedule.end_time &&
        schedule.end_time > schedule.start_time
    );
}

function setError(text) {
    errorElement.textContent = text;
    errorElement.hidden = !text;
}

function createPhoto(machine, className) {
    const wrapper = document.createElement("div");
    wrapper.className = `${className}-wrap`;
    const categoryInfo = categoryInfoFor(machine.type);
    const imageSource = machine.image_url || categoryInfo?.image;
    if (imageSource) {
        const image = document.createElement("img");
        image.className = className;
        image.src = imageSource;
        image.alt = machine.image_url
            ? machine.name ? `${machine.name} photo` : "Machinery photo"
            : `${categoryInfo.title} category photo`;
        image.loading = "lazy";
        image.addEventListener("error", () => {
            wrapper.replaceChildren(createPhotoPlaceholder(machine.type));
        }, { once: true });
        wrapper.append(image);
    } else {
        wrapper.append(createPhotoPlaceholder(machine.type));
    }
    return wrapper;
}

function createPhotoPlaceholder(type) {
    const placeholder = document.createElement("div");
    placeholder.className = "machinery-photo-placeholder";
    const categoryInfo = categoryInfoFor(type) || { key: "legacy", icon: "🧰", title: "Legacy machinery" };
    placeholder.dataset.category = categoryInfo.key;
    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = categoryInfo.icon;
    const label = document.createElement("small");
    label.textContent = "Owner photo not provided";
    const title = document.createElement("strong");
    title.textContent = categoryInfo.title;
    placeholder.append(icon, title, label);
    return placeholder;
}

function categoryInfoFor(type) {
    const normalized = String(type || "").toLowerCase();
    let key = null;
    if (normalized.includes("tractor")) key = "tractor";
    else if (normalized.includes("harvester") || normalized.includes("combine")) key = "harvester";
    else if (normalized.includes("power tiller") || normalized.includes("powertiller")) key = "power-tiller";
    else if (normalized.includes("tiller") || normalized.includes("rotavator") || normalized.includes("cultivator")) key = "rotavator";
    else if (normalized.includes("adike") || normalized.includes("arecanut") || normalized.includes("areca")) key = "adike-sprayer";
    else if (normalized.includes("drone")) key = "drone";
    else if (normalized.includes("trailer")) key = "trailer";
    return key ? { ...CATEGORIES[key], key } : null;
}

function addFact(parent, label, value) {
    if (value == null || value === "") return;
    const row = document.createElement("div");
    row.className = "machinery-fact";
    const name = document.createElement("span");
    name.textContent = label;
    const content = document.createElement("strong");
    content.textContent = String(value);
    row.append(name, content);
    parent.append(row);
}

function specificationsFor(machine) {
    if (!machine.specifications) return {};
    if (typeof machine.specifications === "object" && !Array.isArray(machine.specifications)) {
        return machine.specifications;
    }
    try {
        const parsed = JSON.parse(machine.specifications);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
        console.error("Machinery specifications could not be read:", error);
        return {};
    }
}

function distanceFromFarmer(machine) {
    return Number(machine.distance_km);
}

function matchesSearch(machine) {
    if (!searchTerm) return true;
    const specificationValues = Object.entries(specificationsFor(machine))
        .flatMap(([key, value]) => [key, ...(Array.isArray(value) ? value : [value])]);
    const searchFields = [
        machine.name,
        machine.type,
        machine.brand,
        machine.model,
        machine.location,
        machine.description,
        machine.owner_name,
        machine.price_unit,
        machine.specifications?.condition,
        ...specificationValues
    ];
    return searchFields.some(value =>
        String(value || "").toLowerCase().includes(searchTerm.toLowerCase())
    );
}

function createMachineCard(machine) {
    const card = document.createElement("article");
    card.className = "nearby-machinery-card";
    card.dataset.machineId = machine.id;

    const photo = createPhoto(machine, "nearby-machinery-photo");
    const categoryBadge = document.createElement("span");
    categoryBadge.className = "nearby-category-badge";
    categoryBadge.textContent = `${categoryInfoFor(machine.type).icon} ${machine.type}`;
    const availability = document.createElement("span");
    availability.className = "nearby-availability-badge";
    availability.textContent = "Available for selected time";
    photo.append(categoryBadge, availability);

    const content = document.createElement("div");
    content.className = "nearby-machinery-content";
    const title = document.createElement("h3");
    title.textContent = machine.name;
    const makeModel = [machine.brand, machine.model].filter(Boolean).join(" · ");
    const subtitle = document.createElement("p");
    subtitle.className = "nearby-machinery-model";
    subtitle.textContent = makeModel;
    subtitle.hidden = !makeModel;

    const price = document.createElement("div");
    price.className = "nearby-machinery-price";
    const priceAmount = document.createElement("strong");
    priceAmount.textContent = money(machine.price);
    const priceUnit = document.createElement("span");
    priceUnit.textContent = ` / ${machine.price_unit || "day"}`;
    price.append(priceAmount, priceUnit);

    const facts = document.createElement("div");
    facts.className = "nearby-machinery-facts";
    addFact(facts, "Distance", Number.isFinite(distanceFromFarmer(machine)) ? `${distanceFromFarmer(machine).toFixed(1)} km away` : null);
    addFact(facts, "Pickup location", machine.location);
    addFact(facts, "Owner", machine.owner_name);
    const specs = specificationsFor(machine);
    addFact(facts, "Condition", specs.condition);
    Object.entries(specs).forEach(([key, value]) => {
        if (key === "condition" || value === "" || value == null) return;
        addFact(facts, specificationLabel(key), Array.isArray(value) ? value.join(", ") : value);
    });
    addFact(facts, "Availability", "Available for selected date and time");

    if (machine.description) {
        const description = document.createElement("p");
        description.className = "nearby-machinery-description";
        description.textContent = machine.description;
        content.append(title, subtitle, price, facts, description);
    } else {
        content.append(title, subtitle, price, facts);
    }

    const actions = document.createElement("div");
    actions.className = "nearby-machinery-actions";
    const detailsButton = document.createElement("button");
    detailsButton.type = "button";
    detailsButton.className = "btn btn-outline nearby-details-button";
    detailsButton.textContent = "View Details";
    detailsButton.addEventListener("click", () => openMachineDialog(machine, false));
    const bookButton = document.createElement("button");
    bookButton.type = "button";
    bookButton.className = "btn btn-accent nearby-book-button";
    bookButton.textContent = "Book Now";
    bookButton.addEventListener("click", () => openMachineDialog(machine, true));
    actions.append(detailsButton, bookButton);

    content.append(actions);
    card.append(photo, content);
    if (machine.owner_phone) {
        const contact = document.createElement("a");
        contact.className = "nearby-owner-contact";
        contact.href = `tel:${String(machine.owner_phone).replace(/[^\d+]/g, "")}`;
        contact.textContent = `Contact owner · ${machine.owner_phone}`;
        content.append(contact);
    }
    return card;
}

function renderMachinery() {
    const villageTerm = villageFilterInput.value.trim().toLowerCase();
    const filtered = machinery.filter(machine => {
        const reasons = [];
        if (!matchesSearch(machine)) reasons.push("search");
        if (villageTerm && !String(machine.location || "").toLowerCase().includes(villageTerm)) reasons.push("pickup location");
        const machineCategory = categoryInfoFor(machine.type)?.key;
        if (!machineCategory) reasons.push("unknown category");
        if (machineCategory && category !== "all" && machineCategory !== category) reasons.push("category");
        if (reasons.length) {
            console.debug("Farmer listing excluded by frontend filter:", {
                id: machine.id,
                name: machine.name,
                type: machine.type,
                reasons
            });
            return false;
        }
        return true;
    });
    machineryContainer.replaceChildren();
    filtered.forEach(machine => machineryContainer.append(createMachineCard(machine)));
    const scheduleSummary = validSchedule(selectedSchedule())
        ? ` for ${dateInput.value} · ${startInput.value}–${endInput.value}`
        : "";
    resultsSummary.textContent = `${filtered.length} ${filtered.length === 1 ? "listing" : "listings"} within ${radiusKm} km${scheduleSummary}`;

    if (!filtered.length && !errorElement.hidden) return;
    if (!filtered.length) {
        const empty = document.createElement("div");
        empty.className = "market-empty-state";
        const icon = document.createElement("span");
        icon.className = "market-empty-icon";
        icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21V9m0 4c-3-5-7-4-7-4s0 6 7 6m0-3c3-5 7-4 7-4s0 6-7 6"></path><path d="M12 9c0-4 3-7 7-7 0 4-3 7-7 7Z"></path></svg>';
        const heading = document.createElement("h3");
        heading.textContent = machinery.length
            ? "No listings match these filters"
            : "No matching owner listings yet";
        const copy = document.createElement("p");
        copy.textContent = machinery.length
            ? "Available owner listings were found, but your current filters hide them. Reset the filters or widen the distance and search criteria."
            : "No available owner listings match your distance, category, price, pickup village, specifications, availability, and booking time. Try widening your filters.";
        const resetButton = document.createElement("button");
        resetButton.type = "button";
        resetButton.className = "btn btn-outline";
        resetButton.textContent = "Reset filters";
        resetButton.addEventListener("click", async () => {
            category = "all";
            searchTerm = "";
            searchInput.value = "";
            villageFilterInput.value = "";
            minPriceInput.value = "";
            maxPriceInput.value = "";
            tankCapacityInput.value = "";
            horsepowerRangeInput.value = "";
            availabilityFilterInput.value = "any";
            radiusKm = DEFAULT_RADIUS_KM;
            radiusButtons.forEach(button => {
                const active = Number(button.dataset.radius) === radiusKm;
                button.classList.toggle("active", active);
                button.setAttribute("aria-pressed", String(active));
            });
            categoryCards.forEach(button => {
                button.classList.remove("active");
                button.setAttribute("aria-pressed", "false");
            });
            showAllCategoriesButton.setAttribute("aria-pressed", "true");
            tankCapacityInput.disabled = true;
            horsepowerFilter.hidden = true;
            horsepowerRangeInput.disabled = true;
            dateInput.value = "";
            startInput.value = "";
            endInput.value = "";
            filterMessage.textContent = "";
            await loadMachinery();
        });
        empty.append(icon, heading, copy, resetButton);
        machineryContainer.append(empty);
    }
    renderMachineryMap(filtered);
}

function popupContent(machine) {
    const content = document.createElement("div");
    content.className = "machinery-map-popup";
    const title = document.createElement("strong");
    title.textContent = machine.name;
    const type = document.createElement("span");
    type.textContent = machine.type;
    const price = document.createElement("span");
    price.textContent = `${money(machine.price)} / ${machine.price_unit || "day"}`;
    const distance = document.createElement("span");
    distance.textContent = `${distanceFromFarmer(machine).toFixed(1)} km from you`;
    const details = document.createElement("button");
    details.type = "button";
    details.className = "map-popup-details";
    details.textContent = "View details";
    details.addEventListener("click", () => openMachineDialog(machine, false));
    content.append(title, type, price, distance, details);
    return content;
}

function renderMachineryMap(listings) {
    if (!map || !mapMarkers) return;
    mapMarkers.clearLayers();
    listings.forEach(machine => {
        const latitude = Number(machine.latitude);
        const longitude = Number(machine.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
        window.L.marker([latitude, longitude], {
            title: machine.name,
            icon: window.L.divIcon({
                className: "machinery-map-marker-shell",
                html: `<span class="machinery-map-marker" aria-hidden="true">${categoryInfoFor(machine.type).icon}</span>`,
                iconSize: [34, 38],
                iconAnchor: [17, 34]
            })
        }).bindPopup(popupContent(machine)).addTo(mapMarkers);
    });
}

function initializeMap() {
    if (!window.L) {
        mapSection.hidden = false;
        mapSection.insertAdjacentHTML("afterbegin", '<p class="market-error">The interactive map could not load. Refresh this page or continue using the list.</p>');
        return;
    }
    const center = [farmerCoordinates.latitude, farmerCoordinates.longitude];
    map = window.L.map("machineryMap").setView(center, 12);
    window.L.tileLayer("https://tile.openstreetmap.de/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> · Tiles by <a href="https://www.openstreetmap.de/">OpenStreetMap.de</a>'
    }).addTo(map).on("tileerror", () => {
        errorElement.textContent = "Map tiles could not load. Check your connection or use the machinery list.";
        errorElement.hidden = false;
    }).on("tileload", () => {
        if (errorElement.textContent.startsWith("Map tiles could not load")) setError("");
    });
    window.L.circle(center, {
        radius: 25000,
        color: "#d97706",
        weight: 2,
        fillColor: "#fbbf24",
        fillOpacity: 0.08
    }).addTo(map);
    farmerMarker = window.L.circleMarker(center, {
        radius: 8,
        color: "#fff",
        weight: 3,
        fillColor: "#087847",
        fillOpacity: 1
    }).bindPopup("Your confirmed location").addTo(map);
    mapMarkers = window.L.layerGroup().addTo(map);
    renderMachineryMap(machinery);
}

function setResultView(view) {
    resultView = view;
    const listButton = document.getElementById("showListView");
    const mapButton = document.getElementById("showMapView");
    listButton.classList.toggle("active", view === "list");
    mapButton.classList.toggle("active", view === "map");
    listButton.setAttribute("aria-pressed", String(view === "list"));
    mapButton.setAttribute("aria-pressed", String(view === "map"));
    machineryContainer.hidden = view !== "list";
    mapSection.hidden = view !== "map";
    if (view === "map" && map) {
        window.setTimeout(() => {
            map.invalidateSize();
            map.panTo([farmerCoordinates.latitude, farmerCoordinates.longitude]);
        }, 0);
    }
}

function addDetailRow(container, label, value) {
    if (value == null || value === "") return;
    const row = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = `${label}: `;
    row.append(strong, document.createTextNode(String(value)));
    container.append(row);
}

function checkMachineAvailability(machine, date, startTime, endTime) {
    if (!machine) return { ok: true };
    const availStartDate = machine.availability_start_date ? String(machine.availability_start_date).slice(0, 10) : null;
    const availEndDate = machine.availability_end_date ? String(machine.availability_end_date).slice(0, 10) : null;
    const availStartTime = machine.availability_start_time ? String(machine.availability_start_time).slice(0, 5) : null;
    const availEndTime = machine.availability_end_time ? String(machine.availability_end_time).slice(0, 5) : null;

    if (availStartDate && date && date < availStartDate) {
        return { ok: false, message: `Booking date cannot be earlier than owner's start date (${availStartDate}).` };
    }
    if (availEndDate && date && date > availEndDate) {
        return { ok: false, message: `Booking date cannot be later than owner's end date (${availEndDate}).` };
    }
    if (availStartTime && startTime && startTime < availStartTime) {
        return { ok: false, message: `Start time cannot be earlier than owner's listed start time (${availStartTime}).` };
    }
    if (availEndTime && endTime && endTime > availEndTime) {
        return { ok: false, message: `End time cannot be later than owner's listed end time (${availEndTime}).` };
    }
    return { ok: true };
}

function openMachineDialog(machine, bookingMode) {
    selectedMachine = machine;
    dialogMachineDetails.replaceChildren();
    const image = createPhoto(machine, "dialog-machinery-photo");
    const title = document.createElement("h2");
    title.textContent = machine.name;
    const categoryLabel = document.createElement("span");
    categoryLabel.className = "dialog-machinery-category";
    categoryLabel.textContent = `${categoryInfoFor(machine.type).icon} ${machine.type}`;
    const info = document.createElement("div");
    info.className = "dialog-machinery-info";
    addDetailRow(info, "Brand", machine.brand);
    addDetailRow(info, "Model", machine.model);
    addDetailRow(info, "Description", machine.description);
    addDetailRow(info, "Condition", specificationsFor(machine).condition);
    addDetailRow(info, "Rental", `${money(machine.price)} per ${machine.price_unit || "day"}`);
    addDetailRow(info, "Availability", machine.availability ? "Available for the selected date and time" : null);
    addDetailRow(info, "Pickup location", machine.location);
    addDetailRow(info, "Owner", machine.owner_name);
    addDetailRow(info, "Owner contact", machine.owner_phone);
    addDetailRow(info, "Distance", `${distanceFromFarmer(machine).toFixed(1)} km from your confirmed location`);
    addDetailRow(info, "Listed dates", [machine.availability_start_date, machine.availability_end_date].filter(Boolean).join(" to ") || "No date limits provided");
    addDetailRow(info, "Listed hours", [machine.availability_start_time, machine.availability_end_time].filter(Boolean).map(value => String(value).slice(0, 5)).join(" to ") || "No daily time limits provided");
    Object.entries(specificationsFor(machine)).forEach(([key, value]) => {
        if (key === "condition") return;
        const label = specificationLabel(key);
        addDetailRow(info, label, Array.isArray(value) ? value.join(", ") : value);
    });
    dialogMachineDetails.append(image, categoryLabel, title, info);

    const bookingDateInput = document.getElementById("bookingDate");
    const bookingStartTimeInput = document.getElementById("bookingStartTime");
    const bookingEndTimeInput = document.getElementById("bookingEndTime");
    const notice = document.getElementById("bookingAvailabilityNotice");

    const availStartDate = machine.availability_start_date ? String(machine.availability_start_date).slice(0, 10) : null;
    const availEndDate = machine.availability_end_date ? String(machine.availability_end_date).slice(0, 10) : null;
    const availStartTime = machine.availability_start_time ? String(machine.availability_start_time).slice(0, 5) : null;
    const availEndTime = machine.availability_end_time ? String(machine.availability_end_time).slice(0, 5) : null;

    // Constrain date
    const today = localDateString(new Date());
    const minAllowedDate = availStartDate && availStartDate > today ? availStartDate : today;
    bookingDateInput.min = minAllowedDate;
    if (availEndDate) {
        bookingDateInput.max = availEndDate;
    } else {
        bookingDateInput.removeAttribute("max");
    }

    // Constrain times
    if (availStartTime) {
        bookingStartTimeInput.min = availStartTime;
        bookingEndTimeInput.min = availStartTime;
    } else {
        bookingStartTimeInput.removeAttribute("min");
        bookingEndTimeInput.removeAttribute("min");
    }
    if (availEndTime) {
        bookingStartTimeInput.max = availEndTime;
        bookingEndTimeInput.max = availEndTime;
    } else {
        bookingStartTimeInput.removeAttribute("max");
        bookingEndTimeInput.removeAttribute("max");
    }

    // Display availability notice
    if (notice) {
        notice.hidden = !bookingMode;
        if (bookingMode) {
            const timeDesc = (availStartTime && availEndTime)
                ? `Daily hours: ${availStartTime} to ${availEndTime}`
                : (availStartTime ? `Daily start time: ${availStartTime}` : (availEndTime ? `Daily end time: ${availEndTime}` : "No daily time limits"));
            const dateDesc = (availStartDate && availEndDate)
                ? ` · Dates: ${availStartDate} to ${availEndDate}`
                : (availStartDate ? ` · From date: ${availStartDate}` : (availEndDate ? ` · Until date: ${availEndDate}` : ""));
            notice.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg> <span>Owner availability: <strong>${timeDesc}${dateDesc}</strong></span>`;
        }
    }

    // Default dates and times
    const currentSchedule = selectedSchedule();
    let initialDate = currentSchedule.booking_date;
    if (!initialDate || initialDate < minAllowedDate || (availEndDate && initialDate > availEndDate)) {
        initialDate = minAllowedDate;
    }
    bookingDateInput.value = initialDate;

    let initialStart = currentSchedule.start_time;
    if (!initialStart || (availStartTime && initialStart < availStartTime) || (availEndTime && initialStart > availEndTime)) {
        initialStart = availStartTime || "08:00";
    }
    bookingStartTimeInput.value = initialStart;

    let initialEnd = currentSchedule.end_time;
    if (!initialEnd || initialEnd <= initialStart || (availEndTime && initialEnd > availEndTime) || (availStartTime && initialEnd < availStartTime)) {
        initialEnd = availEndTime || "17:00";
    }
    bookingEndTimeInput.value = initialEnd;

    bookingMessage.textContent = "";
    bookingMessage.className = "form-feedback";
    document.getElementById("confirmBookingSummary").checked = false;
    document.querySelector(".booking-dialog-fields").hidden = !bookingMode;
    document.querySelector(".booking-review").hidden = !bookingMode;
    document.querySelector(".booking-estimate").hidden = !bookingMode;
    document.querySelector(".booking-cancellation-policy").hidden = !bookingMode;
    bookingSubmit.hidden = !bookingMode;
    bookingSubmit.disabled = !bookingMode;
    updateBookingEstimate();
    dialog.showModal();
}

function updateBookingEstimate() {
    if (!selectedMachine) return;
    const date = document.getElementById("bookingDate").value;
    const start = document.getElementById("bookingStartTime").value;
    const end = document.getElementById("bookingEndTime").value;
    if (!validSchedule({
        booking_date: date,
        start_time: start,
        end_time: end
    })) {
        bookingEstimate.textContent = "Choose a valid time";
        bookingSummary.textContent = "Choose a booking date, start time, and end time.";
        return;
    }
    const availCheck = checkMachineAvailability(selectedMachine, date, start, end);
    if (!availCheck.ok) {
        bookingMessage.textContent = availCheck.message;
        bookingMessage.className = "form-feedback error";
        bookingSubmit.disabled = true;
        bookingEstimate.textContent = "Outside owner hours";
        bookingSummary.textContent = `${availCheck.message} Adjust your booking time to match the owner's availability.`;
        return;
    }
    bookingMessage.textContent = "";
    bookingMessage.className = "form-feedback";
    bookingSubmit.disabled = false;

    const [startHour, startMinute] = start.split(":").map(Number);
    const [endHour, endMinute] = end.split(":").map(Number);
    const durationHours = ((endHour * 60 + endMinute) - (startHour * 60 + startMinute)) / 60;
    const units = selectedMachine.price_unit === "hour"
        ? durationHours
        : Math.max(1, Math.ceil(durationHours / 24));
    const total = Number(selectedMachine.price) * units;
    bookingEstimate.textContent = `${money(total)} (estimate; ${units} ${selectedMachine.price_unit || "day"}${units === 1 ? "" : "s"})`;
    bookingSummary.textContent = `${selectedMachine.name} · ${date} · ${start}–${end} · ${money(selectedMachine.price)} per ${selectedMachine.price_unit || "day"} · Owner: ${selectedMachine.owner_name || "Owner details unavailable"}`;
}

function specificationLabel(key) {
    const labels = {
        horsepower_hp: "Horsepower (HP)",
        tractor_type: "Tractor type",
        harvesting_type: "Harvesting type",
        capacity: "Capacity",
        tiller_type: "Tiller / rotavator type",
        working_width_cm: "Working width (cm)",
        compatible_power_hp: "Compatible power (HP)",
        engine_power_hp: "Engine power (HP)",
        sprayer_type: "Sprayer type",
        tank_capacity_l: "Tank capacity (litres)",
        payload_capacity_kg: "Payload capacity (kg)",
        battery_endurance_minutes: "Battery endurance (minutes)",
        battery_details: "Battery details",
        trailer_type: "Trailer type",
        load_capacity_t: "Load capacity (tonnes)",
        dimensions: "Dimensions",
        supported_features: "Extra features"
    };
    return labels[key] || key.replace(/[_-]/g, " ");
}

async function loadMachinery() {
    const schedule = selectedSchedule();
    const hasScheduleFilter = Object.values(schedule).some(Boolean);
    if (hasScheduleFilter && !validSchedule(schedule)) {
        filterMessage.textContent = "Choose a future booking date and an end time later than the start time.";
        return;
    }
    if (
        minPriceInput.value && maxPriceInput.value &&
        Number(minPriceInput.value) > Number(maxPriceInput.value)
    ) {
        filterMessage.textContent = "Minimum price cannot exceed maximum price.";
        return;
    }
    filterMessage.textContent = "";
    setError("");
    resultsSummary.textContent = "Checking real owner listings and availability…";
    const params = new URLSearchParams({ radius: String(radiusKm), category });
    if (validSchedule(schedule)) {
        params.set("booking_date", schedule.booking_date);
        params.set("start_time", schedule.start_time);
        params.set("end_time", schedule.end_time);
    }
    if (availabilityFilterInput.value) {
        params.set("availability_mode", availabilityFilterInput.value);
    }
    if (minPriceInput.value) params.set("minPrice", minPriceInput.value);
    if (maxPriceInput.value) params.set("maxPrice", maxPriceInput.value);
    if (tankCapacityInput.value) params.set("tank_capacity_l", tankCapacityInput.value);
    if (horsepowerRangeInput.value) params.set("horsepower_range", horsepowerRangeInput.value);

    try {
        const data = await AgriMachApi.request(`/machinery?${params}`, {
            headers: apiHeaders()
        });
        if (!Array.isArray(data)) throw new Error("The machinery service returned an invalid response.");
        machinery = data;
        console.debug("Farmer machinery API response:", {
            count: data.length,
            listingIds: data.map(listing => listing.id),
            listingNames: data.map(listing => listing.name),
            droneListingsReturned: data.filter(listing =>
                String(listing.type || "").toLowerCase().includes("drone")
            ).map(listing => ({
                id: listing.id,
                name: listing.name,
                type: listing.type,
                latitude: listing.latitude,
                longitude: listing.longitude,
                distanceKm: listing.distance_km
            }))
        });
        renderMachinery();
    } catch (error) {
        console.error("Nearby machinery request failed:", error);
        machinery = [];
        machineryContainer.replaceChildren();
        setError(error instanceof Error ? error.message : "Nearby machinery could not be loaded.");
        resultsSummary.textContent = "Listings could not be loaded.";
        renderMachineryMap([]);
    }
}

function statusLabel(status) {
    if (status === "accepted") return "Booking Successfully Accepted";
    if (status === "pending") return "Pending owner response";
    if (status === "rejected") return "Request declined";
    if (status === "cancelled") return "Cancelled";
    if (status === "completed") return "Completed";
    return status;
}

async function loadFarmerBookings() {
    try {
        const data = await AgriMachApi.request("/bookings/farmer", { headers: apiHeaders() });
        bookingContainer.replaceChildren();
        if (!Array.isArray(data) || !data.length) {
            const empty = document.createElement("p");
            empty.className = "farmer-booking-empty";
            empty.textContent = "You have not sent any machinery booking requests yet.";
            bookingContainer.append(empty);
            return;
        }
        data.slice(0, 4).forEach(booking => {
            const item = document.createElement("article");
            item.className = "farmer-booking-item";
            const summary = document.createElement("div");
            const name = document.createElement("strong");
            name.textContent = booking.machinery_name;
            const time = document.createElement("span");
            time.textContent = `${readableBookingDate(booking.booking_date)} · ${String(booking.start_time).slice(0, 5)}–${String(booking.end_time).slice(0, 5)}`;
            summary.append(name, time);
            const status = document.createElement("span");
            status.className = `farmer-booking-status status-${booking.status}`;
            status.textContent = statusLabel(booking.status);
            item.append(summary, status);
            const amount = document.createElement("span");
            amount.textContent = `${money(booking.estimated_total)} estimated total`;
            item.append(amount);
            const cancellationDeadline = Date.parse(booking.cancellation_deadline);
            if (["pending", "accepted"].includes(booking.status)) {
                const remaining = cancellationDeadline - Date.now();
                const countdown = document.createElement("span");
                countdown.className = "cancellation-countdown";
                countdown.textContent = booking.cancellation_allowed && remaining > 0
                    ? `${formatRemaining(remaining)} left to cancel`
                    : "Cancellation period expired";
                item.append(countdown);
                const cancelButton = document.createElement("button");
                cancelButton.type = "button";
                cancelButton.className = "booking-cancel-button";
                cancelButton.textContent = "Cancel booking";
                cancelButton.disabled = booking.cancellation_allowed !== true || remaining <= 0;
                cancelButton.addEventListener("click", () => updateBookingStatus(booking.id, "cancelled"));
                item.append(cancelButton);
            }
            bookingContainer.append(item);
        });
    } catch (error) {
        console.error("Farmer bookings request failed:", error);
        bookingContainer.replaceChildren();
        const message = document.createElement("p");
        message.className = "farmer-booking-empty";
        message.textContent = error instanceof Error ? error.message : "Your bookings could not be loaded.";
        bookingContainer.append(message);
    }
}

async function updateBookingStatus(id, status) {
    if (status === "cancelled" && !window.confirm("Cancel this booking? The requested time slot will be released.")) return;
    try {
        await AgriMachApi.request(`/bookings/${encodeURIComponent(id)}/status`, {
            method: "PUT",
            headers: apiHeaders(true),
            body: JSON.stringify({ status })
        });
        await loadFarmerBookings();
    } catch (error) {
        console.error("Booking status change failed:", error);
        window.alert(error instanceof Error ? error.message : "Could not update the booking.");
    }
}

function formatRemaining(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}h ${minutes}m ${seconds}s`;
}

bookingForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!selectedMachine) return;
    const schedule = {
        booking_date: document.getElementById("bookingDate").value,
        start_time: document.getElementById("bookingStartTime").value,
        end_time: document.getElementById("bookingEndTime").value
    };
    if (!validSchedule(schedule)) {
        bookingMessage.textContent = "Choose a valid date and an end time later than the start time.";
        bookingMessage.className = "form-feedback error";
        return;
    }
    const availCheck = checkMachineAvailability(selectedMachine, schedule.booking_date, schedule.start_time, schedule.end_time);
    if (!availCheck.ok) {
        bookingMessage.textContent = availCheck.message;
        bookingMessage.className = "form-feedback error";
        return;
    }
    bookingSubmit.disabled = true;
    bookingSubmit.textContent = "Checking availability…";
    bookingMessage.textContent = "";
    try {
        const result = await AgriMachApi.request("/bookings", {
            method: "POST",
            headers: apiHeaders(true),
            body: JSON.stringify({ machinery_id: selectedMachine.id, ...schedule })
        });
        bookingMessage.textContent = `${result.message} Server-calculated estimate: ${money(result.booking.estimated_total)}.`;
        bookingMessage.className = "form-feedback success";
        bookingSubmit.textContent = "Request Sent";
        await loadFarmerBookings();
        await loadMachinery();
        window.setTimeout(() => dialog.close(), 1400);
    } catch (error) {
        console.error("Booking request failed:", error);
        bookingMessage.textContent = error instanceof Error ? error.message : "Booking failed. Your request was not saved.";
        bookingMessage.className = "form-feedback error";
        bookingSubmit.disabled = false;
        bookingSubmit.textContent = "Confirm Booking";
    }
});

document.getElementById("closeMachineryDialog").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", event => {
    if (event.target === dialog) dialog.close();
});
["bookingDate", "bookingStartTime", "bookingEndTime"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener("input", updateBookingEstimate);
        el.addEventListener("change", updateBookingEstimate);
    }
});

radiusButtons.forEach(button => {
    button.addEventListener("click", () => {
        radiusKm = Number(button.dataset.radius);
        radiusButtons.forEach(candidate => {
            const active = candidate === button;
            candidate.classList.toggle("active", active);
            candidate.setAttribute("aria-pressed", String(active));
        });
        loadMachinery();
    });
});

categoryCards.forEach(button => {
    button.addEventListener("click", () => {
        category = button.dataset.category;
        categoryCards.forEach(candidate => {
            const selected = candidate === button;
            candidate.classList.toggle("active", selected);
            candidate.setAttribute("aria-pressed", String(selected));
        });
        showAllCategoriesButton.setAttribute("aria-pressed", "false");
        tankCapacityInput.disabled = category !== "adike-sprayer";
        if (tankCapacityInput.disabled) tankCapacityInput.value = "";
        horsepowerFilter.hidden = category !== "tractor";
        horsepowerRangeInput.disabled = category !== "tractor";
        if (horsepowerRangeInput.disabled) horsepowerRangeInput.value = "";
        loadMachinery();
    });
});

showAllCategoriesButton.addEventListener("click", () => {
    category = "all";
    categoryCards.forEach(candidate => {
        candidate.classList.remove("active");
        candidate.setAttribute("aria-pressed", "false");
    });
    showAllCategoriesButton.setAttribute("aria-pressed", "true");
    tankCapacityInput.disabled = true;
    tankCapacityInput.value = "";
    horsepowerFilter.hidden = true;
    horsepowerRangeInput.disabled = true;
    horsepowerRangeInput.value = "";
    loadMachinery();
});

searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTerm = searchInput.value.trim();
    searchTimer = window.setTimeout(renderMachinery, 180);
});
villageFilterInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = window.setTimeout(renderMachinery, 180);
});
[minPriceInput, maxPriceInput, tankCapacityInput, horsepowerRangeInput, dateInput, startInput, endInput, availabilityFilterInput].forEach(input => {
    input.addEventListener("change", loadMachinery);
});
document.getElementById("showListView").addEventListener("click", () => setResultView("list"));
document.getElementById("showMapView").addEventListener("click", () => setResultView("map"));

async function initializeFarmerDashboard() {
    tankCapacityInput.disabled = true;
    horsepowerRangeInput.disabled = true;
    horsepowerFilter.hidden = true;
    try {
        signedInUser = JSON.parse(localStorage.getItem("user") || "null");
    } catch (error) {
        console.error("Saved farmer session could not be read:", error);
    }
    if (!token || !signedInUser) {
        window.location.replace("login.html");
        return;
    }
    if (signedInUser.role === "owner") {
        window.location.replace("owner-dashboard.html");
        return;
    }
    if (signedInUser.role !== "farmer") {
        window.location.replace("login.html");
        return;
    }
    const latitude = Number(signedInUser.selected_latitude ?? signedInUser.farm_latitude);
    const longitude = Number(signedInUser.selected_longitude ?? signedInUser.farm_longitude);
    if (
        !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180
    ) {
        window.location.replace("select-role-location.html");
        return;
    }
    farmerCoordinates = { latitude, longitude };
    farmerLocationName.textContent =
        signedInUser.selected_location ||
        signedInUser.farm_location ||
        `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    dateInput.min = localDateString(new Date());
    dateInput.value = "";
    document.getElementById("bookingDate").min = dateInput.min;
    initializeMap();
    await loadMachinery();
    await loadFarmerBookings();
    refreshTimer = window.setInterval(loadFarmerBookings, 30000);
}

window.addEventListener("beforeunload", () => clearInterval(refreshTimer));
initializeFarmerDashboard();
