const express = require("express");
const multer = require("multer");
const { deleteMachineryImage, uploadMachineryImage } = require("../config/cloudinary");
const pool = require("../config/db");
const {
    isWithinLocationRadius,
    LOCATION_RADIUS_KM
} = require("../config/location");
const {
    authenticateToken,
    requireRole
} = require("../middleware/authMiddleware");

const router = express.Router();
const PRICE_UNITS = ["hour", "day"];
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const allowedImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const imageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0 }
});
const MACHINERY_CATEGORIES = [
    "Tractor",
    "Harvester",
    "Tiller / Rotavator",
    "Power Tiller",
    "Adike (Arecanut) Sprayer",
    "Agricultural Drone",
    "Trailer"
];

router.use(authenticateToken, requireRole("owner"));

function imageFolderForOwner(ownerId) {
    const folder = (process.env.CLOUDINARY_FOLDER || "agrimech/machinery").replace(/^\/+|\/+$/g, "");
    return `${folder}/owner-${ownerId}/`;
}

function parseImageUpload(req, res, next) {
    imageUpload.single("photo")(req, res, error => {
        if (!error) return next();
        if (error.code === "LIMIT_FILE_SIZE") {
            return res.status(413).json({ message: "Machinery photos must be 3 MB or smaller." });
        }
        return res.status(400).json({ message: "Choose one PNG, JPEG, or WebP photo." });
    });
}

router.post("/images/upload", parseImageUpload, async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "Choose a machinery photo to upload." });
    if (!allowedImageTypes.has(req.file.mimetype)) {
        return res.status(400).json({ message: "Choose a PNG, JPEG, or WebP image." });
    }
    try {
        const image = await uploadMachineryImage(req.file.buffer, req.user.id);
        res.status(201).json({ image });
    } catch (error) {
        console.error("Cloudinary machinery image upload failed:", error.message);
        res.status(error.code === "CLOUDINARY_NOT_CONFIGURED" ? 503 : 502).json({
            message: error.code === "CLOUDINARY_NOT_CONFIGURED"
                ? "Image hosting is not configured. Add the Cloudinary credentials to backend/.env."
                : "The machinery photo could not be uploaded. Check Cloudinary configuration and try again."
        });
    }
});

router.post("/images/cleanup", async (req, res) => {
    const publicId = typeof req.body?.cloudinary_public_id === "string"
        ? req.body.cloudinary_public_id
        : "";
    if (!publicId || !publicId.startsWith(imageFolderForOwner(req.user.id))) {
        return res.status(400).json({ message: "Invalid uploaded image reference." });
    }
    try {
        await deleteMachineryImage(publicId);
        res.status(204).end();
    } catch (error) {
        console.error("Unused Cloudinary machinery image cleanup failed:", error.message);
        res.status(502).json({ message: "The unused image could not be removed from Cloudinary." });
    }
});

function optionalText(value, field, maxLength) {
    if (value == null) return { value: null };
    if (typeof value !== "string" || value.trim().length > maxLength) {
        return { error: `${field} must be text no longer than ${maxLength} characters.` };
    }
    return { value: value.trim() || null };
}

function parseSpecifications(value) {
    if (value == null || value === "") return { value: {} };
    let specifications = value;
    if (typeof value === "string") {
        try {
            specifications = JSON.parse(value);
        } catch {
            return { error: "Specifications must be valid JSON." };
        }
    }
    if (
        !specifications ||
        typeof specifications !== "object" ||
        Array.isArray(specifications) ||
        Object.keys(specifications).length > 20 ||
        Object.values(specifications).some(item =>
            !["string", "number", "boolean"].includes(typeof item) &&
                !(Array.isArray(item) && item.length <= 20 && item.every(feature => typeof feature === "string" && feature.length <= 100)) ||
            (typeof item === "string" && item.length > 300) ||
            (typeof item === "number" && !Number.isFinite(item))
        )
    ) {
        return { error: "Specifications must be an object with up to 20 simple values." };
    }
    return { value: specifications };
}

function validAvailabilityDate(value) {
    if (value == null || value === "") return true;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeAvailabilityTime(value) {
    if (value == null || value === "") return null;
    if (typeof value !== "string") return null;
    const match = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/);
    return match ? `${match[1]}:${match[2]}` : null;
}

function validCloudinaryImage(imageUrl, publicId, ownerId) {
    if (typeof imageUrl !== "string" || typeof publicId !== "string") return false;
    if (imageUrl.length > 2048 || publicId.length > 512) return false;
    let parsedUrl;
    try {
        parsedUrl = new URL(imageUrl);
    } catch {
        return false;
    }
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
    const folder = (process.env.CLOUDINARY_FOLDER || "agrimech/machinery").replace(/^\/+|\/+$/g, "");
    return Boolean(cloudName) &&
        parsedUrl.protocol === "https:" &&
        parsedUrl.hostname === "res.cloudinary.com" &&
        parsedUrl.pathname.startsWith(`/${cloudName}/image/upload/`) &&
        publicId.startsWith(`${folder}/owner-${ownerId}/`);
}

function validCoordinates(latitude, longitude) {
    const valid = (value, min, max) => {
        if (
            (typeof value !== "number" && typeof value !== "string") ||
            (typeof value === "string" && !value.trim())
        ) {
            return false;
        }
        const coordinate = Number(value);
        return Number.isFinite(coordinate) && coordinate >= min && coordinate <= max;
    };
    return valid(latitude, -90, 90) && valid(longitude, -180, 180);
}

function validateListing(body, { partial = false, ownerId } = {}) {
    const fields = {};
    const required = ["name", "type", "price", "location", "latitude", "longitude"];
    for (const key of required) {
        if (!partial && (body[key] === undefined || body[key] === null || body[key] === "")) {
            return { error: `${key} is required.` };
        }
    }
    for (const key of ["name", "type", "location"]) {
        if (body[key] !== undefined) {
            if (typeof body[key] !== "string" || !body[key].trim() || body[key].trim().length > 200) {
                return { error: `${key} must be non-empty text no longer than 200 characters.` };
            }
            const value = body[key].trim();
            if (key === "type" && !MACHINERY_CATEGORIES.includes(value)) {
                return { error: "Choose one of the seven supported machinery categories." };
            }
            fields[key] = value;
        }
    }
    if (body.price !== undefined) {
        if (!Number.isFinite(Number(body.price)) || Number(body.price) <= 0) {
            return { error: "Rental price must be a positive number." };
        }
        fields.price = Number(body.price);
    }
    if (body.price_unit !== undefined || !partial) {
        const priceUnit = body.price_unit ?? "day";
        if (!PRICE_UNITS.includes(priceUnit)) {
            return { error: "Pricing unit must be per hour or per day." };
        }
        fields.price_unit = priceUnit;
    }
    for (const [key, label, maxLength] of [
        ["brand", "Brand", 100],
        ["model", "Model", 100],
        ["description", "Description", 2000]
    ]) {
        if (body[key] !== undefined) {
            const parsed = optionalText(body[key], label, maxLength);
            if (parsed.error) return parsed;
            fields[key] = parsed.value;
        }
    }
    if (body.specifications !== undefined || !partial) {
        const parsed = parseSpecifications(body.specifications);
        if (parsed.error) return parsed;
        fields.specifications = parsed.value;
    }
    if (body.image_url !== undefined || body.cloudinary_public_id !== undefined) {
        if (body.image_url == null && body.cloudinary_public_id == null && partial) {
            fields.image_url = null;
            fields.cloudinary_public_id = null;
        } else if (!validCloudinaryImage(body.image_url, body.cloudinary_public_id, ownerId)) {
            return { error: "Upload a PNG, JPEG, or WebP image using the machinery photo uploader." };
        } else {
            fields.image_url = body.image_url;
            fields.cloudinary_public_id = body.cloudinary_public_id;
        }
    }
    if (body.availability !== undefined) {
        if (typeof body.availability !== "boolean") {
            return { error: "Availability must be true or false." };
        }
        fields.availability = body.availability;
    }
    const availabilityKeys = [
        "availability_start_date",
        "availability_end_date",
        "availability_start_time",
        "availability_end_time"
    ];
    for (const key of availabilityKeys) {
        if (body[key] !== undefined || !partial) {
            const value = body[key] || null;
            if (key.endsWith("_date")) {
                if (!validAvailabilityDate(value)) {
                    return { error: `Provide a valid ${key.replaceAll("_", " ")}.` };
                }
                fields[key] = value;
            } else {
                const normalizedTime = normalizeAvailabilityTime(value);
                if (value !== null && normalizedTime === null) {
                    return { error: `Provide a valid ${key.replaceAll("_", " ")}.` };
                }
                fields[key] = normalizedTime;
            }
        }
    }
    const availabilityStartDate = fields.availability_start_date ?? body.availability_start_date;
    const availabilityEndDate = fields.availability_end_date ?? body.availability_end_date;
    const availabilityStartTime = fields.availability_start_time ?? body.availability_start_time;
    const availabilityEndTime = fields.availability_end_time ?? body.availability_end_time;
    if (availabilityStartDate && availabilityEndDate && availabilityStartDate > availabilityEndDate) {
        return { error: "Availability end date cannot be before the start date." };
    }
    if (availabilityStartTime && availabilityEndTime && availabilityStartTime >= availabilityEndTime) {
        return { error: "Availability end time must be later than the start time." };
    }
    if (body.latitude !== undefined || body.longitude !== undefined || !partial) {
        if (!validCoordinates(body.latitude, body.longitude)) {
            return { error: "Valid machinery latitude and longitude are required." };
        }
        fields.latitude = Number(body.latitude);
        fields.longitude = Number(body.longitude);
        if (!isWithinLocationRadius(fields.latitude, fields.longitude)) {
            return { error: `Machinery location must be within ${LOCATION_RADIUS_KM} km of Sullia, Karnataka.` };
        }
    }
    return { fields };
}

router.get("/", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM machinery
             WHERE owner_id = $1
             ORDER BY created_at DESC`,
            [req.user.id]
        );
        console.info("Owner machinery listings loaded:", {
            ownerId: req.user.id,
            totalListings: result.rows.length,
            availableListings: result.rows.filter(listing => listing.availability === true).length,
            listingIds: result.rows.map(listing => listing.id)
        });
        res.json(result.rows);
    } catch (error) {
        console.error("Owner listing fetch failed:", error.message);
        res.status(500).json({ message: "Failed to fetch your listings" });
    }
});

router.post("/", async (req, res) => {
    const parsed = validateListing(req.body, { ownerId: req.user.id });
    if (parsed.error) return res.status(400).json({ message: parsed.error });
    const listing = parsed.fields;

    try {
        const result = await pool.query(
            `INSERT INTO machinery
                (owner_id, name, type, brand, model, description, price,
                 price_unit, specifications, location, latitude, longitude,
                 image_url, cloudinary_public_id, availability, availability_start_date,
                 availability_end_date, availability_start_time, availability_end_time)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::JSONB,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
             RETURNING *`,
            [
                req.user.id,
                listing.name,
                listing.type,
                listing.brand ?? null,
                listing.model ?? null,
                listing.description ?? null,
                listing.price,
                listing.price_unit,
                JSON.stringify(listing.specifications),
                listing.location,
                listing.latitude,
                listing.longitude,
                listing.image_url ?? null,
                listing.cloudinary_public_id ?? null,
                listing.availability ?? true,
                listing.availability_start_date,
                listing.availability_end_date,
                listing.availability_start_time,
                listing.availability_end_time
            ]
        );
        res.status(201).json({
            message: "Machinery added successfully",
            machinery: result.rows[0]
        });
    } catch (error) {
        console.error("Machinery listing creation failed:", error.message);
        res.status(500).json({ message: "Failed to add machinery" });
    }
});

router.put("/:id", async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) {
        return res.status(400).json({ message: "Invalid machinery listing ID." });
    }
    const parsed = validateListing(req.body, { partial: true, ownerId: req.user.id });
    if (parsed.error) return res.status(400).json({ message: parsed.error });
    const listing = parsed.fields;
    if (!Object.keys(listing).length) {
        return res.status(400).json({ message: "Provide at least one listing field to update." });
    }

    try {
        const previousImageResult = await pool.query(
            "SELECT cloudinary_public_id FROM machinery WHERE id = $1 AND owner_id = $2",
            [req.params.id, req.user.id]
        );
        if (!previousImageResult.rows.length) {
            return res.status(404).json({ message: "Machinery listing not found" });
        }
        const previousPublicId = previousImageResult.rows[0].cloudinary_public_id;
        const result = await pool.query(
            `UPDATE machinery
             SET name = COALESCE($1, name),
                 type = COALESCE($2, type),
                 brand = COALESCE($3, brand),
                 model = COALESCE($4, model),
                 description = COALESCE($5, description),
                 price = COALESCE($6, price),
                 price_unit = COALESCE($7, price_unit),
                 specifications = COALESCE($8::JSONB, specifications),
                 location = COALESCE($9, location),
                 latitude = COALESCE($10, latitude),
                 longitude = COALESCE($11, longitude),
                 image_url = COALESCE($12, image_url),
                 cloudinary_public_id = COALESCE($13, cloudinary_public_id),
                 availability = COALESCE($14, availability),
                 availability_start_date = CASE WHEN $15 THEN $16::DATE ELSE availability_start_date END,
                 availability_end_date = CASE WHEN $17 THEN $18::DATE ELSE availability_end_date END,
                 availability_start_time = CASE WHEN $19 THEN $20::TIME ELSE availability_start_time END,
                 availability_end_time = CASE WHEN $21 THEN $22::TIME ELSE availability_end_time END
             WHERE id = $23 AND owner_id = $24
             RETURNING *`,
            [
                listing.name ?? null,
                listing.type ?? null,
                listing.brand ?? null,
                listing.model ?? null,
                listing.description ?? null,
                listing.price ?? null,
                listing.price_unit ?? null,
                listing.specifications === undefined ? null : JSON.stringify(listing.specifications),
                listing.location ?? null,
                listing.latitude ?? null,
                listing.longitude ?? null,
                listing.image_url ?? null,
                listing.cloudinary_public_id ?? null,
                listing.availability ?? null,
                listing.availability_start_date !== undefined,
                listing.availability_start_date ?? null,
                listing.availability_end_date !== undefined,
                listing.availability_end_date ?? null,
                listing.availability_start_time !== undefined,
                listing.availability_start_time ?? null,
                listing.availability_end_time !== undefined,
                listing.availability_end_time ?? null,
                req.params.id,
                req.user.id
            ]
        );
        if (!result.rows.length) {
            return res.status(404).json({ message: "Machinery listing not found" });
        }
        const updatedPublicId = result.rows[0].cloudinary_public_id;
        if (previousPublicId && previousPublicId !== updatedPublicId) {
            deleteMachineryImage(previousPublicId).catch(error => {
                console.error("Previous Cloudinary machinery image cleanup failed:", error.message);
            });
        }
        res.json({ message: "Machinery updated successfully", machinery: result.rows[0] });
    } catch (error) {
        console.error("Machinery listing update failed:", error.message);
        res.status(500).json({ message: "Failed to update machinery" });
    }
});

router.delete("/:id", async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) {
        return res.status(400).json({ message: "Invalid machinery listing ID." });
    }
    try {
        const result = await pool.query(
            `UPDATE machinery
             SET availability = FALSE
             WHERE id = $1 AND owner_id = $2
             RETURNING id`,
            [req.params.id, req.user.id]
        );
        if (!result.rows.length) {
            return res.status(404).json({ message: "Machinery listing not found." });
        }
        res.json({ message: "Listing marked unavailable. Its record and booking history were preserved." });
    } catch (error) {
        console.error("Machinery listing deactivation failed:", error.message);
        res.status(500).json({ message: "Failed to mark listing unavailable." });
    }
});

module.exports = router;
