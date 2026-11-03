const { randomUUID } = require("node:crypto");
const cloudinary = require("cloudinary").v2;

function configuredCloudinary() {
    const required = [
        "CLOUDINARY_CLOUD_NAME",
        "CLOUDINARY_API_KEY",
        "CLOUDINARY_API_SECRET"
    ];
    const missing = required.filter(name => !process.env[name]?.trim());
    if (missing.length) {
        const error = new Error(`Cloudinary is not configured. Add ${missing.join(", ")} to backend/.env.`);
        error.code = "CLOUDINARY_NOT_CONFIGURED";
        throw error;
    }
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME.trim(),
        api_key: process.env.CLOUDINARY_API_KEY.trim(),
        api_secret: process.env.CLOUDINARY_API_SECRET.trim(),
        secure: true
    });
    return cloudinary;
}

function uploadMachineryImage(buffer, ownerId) {
    const client = configuredCloudinary();
    const folder = (process.env.CLOUDINARY_FOLDER || "agrimech/machinery").replace(/^\/+|\/+$/g, "");
    const publicId = `${folder}/owner-${ownerId}/${randomUUID()}`;

    return new Promise((resolve, reject) => {
        const stream = client.uploader.upload_stream({
            public_id: publicId,
            resource_type: "image",
            overwrite: false,
            allowed_formats: ["jpg", "jpeg", "png", "webp"],
            transformation: [{ quality: "auto", fetch_format: "auto" }]
        }, (error, result) => {
            if (error) return reject(error);
            if (!result?.secure_url || !result?.public_id) {
                return reject(new Error("Cloudinary returned an incomplete upload result."));
            }
            resolve({
                image_url: client.url(result.public_id, {
                    secure: true,
                    transformation: [{ quality: "auto", fetch_format: "auto" }]
                }),
                cloudinary_public_id: result.public_id
            });
        });
        stream.end(buffer);
    });
}

async function deleteMachineryImage(publicId) {
    if (!publicId) return;
    const result = await configuredCloudinary().uploader.destroy(publicId, {
        resource_type: "image",
        invalidate: true
    });
    if (result.result !== "ok" && result.result !== "not found") {
        throw new Error(`Cloudinary could not delete image ${publicId}.`);
    }
}

module.exports = { configuredCloudinary, deleteMachineryImage, uploadMachineryImage };
