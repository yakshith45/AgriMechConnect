const pool = require("../../config/db");
const { deleteMachineryImage, uploadMachineryImage } = require("../../config/cloudinary");

const dataUrlPattern = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const maxImageBytes = 3 * 1024 * 1024;

async function migrateLegacyImages() {
    const result = await pool.query(
        `SELECT id, owner_id, image_url
         FROM machinery
         WHERE cloudinary_public_id IS NULL
           AND image_url LIKE 'data:image/%'
         ORDER BY id`
    );
    let migrated = 0;

    for (const listing of result.rows) {
        const match = listing.image_url.match(dataUrlPattern);
        if (!match) {
            throw new Error(`Machinery listing ${listing.id} has an unsupported legacy image data URL.`);
        }
        const imageBuffer = Buffer.from(match[2], "base64");
        if (!imageBuffer.length || imageBuffer.length > maxImageBytes) {
            throw new Error(`Machinery listing ${listing.id} has an image outside the 3 MB migration limit.`);
        }

        const image = await uploadMachineryImage(imageBuffer, listing.owner_id);
        try {
            const update = await pool.query(
                `UPDATE machinery
                 SET image_url = $1, cloudinary_public_id = $2
                 WHERE id = $3 AND owner_id = $4 AND cloudinary_public_id IS NULL`,
                [image.image_url, image.cloudinary_public_id, listing.id, listing.owner_id]
            );
            if (update.rowCount !== 1) {
                await deleteMachineryImage(image.cloudinary_public_id);
                throw new Error(`Machinery listing ${listing.id} changed during image migration; its new upload was removed.`);
            }
        } catch (error) {
            if (error.message.includes("changed during image migration")) throw error;
            await deleteMachineryImage(image.cloudinary_public_id).catch(cleanupError => {
                console.error(`Could not remove an unused Cloudinary image for listing ${listing.id}:`, cleanupError.message);
            });
            throw error;
        }

        migrated += 1;
        console.log(`Migrated machinery image for listing ${listing.id}.`);
    }

    console.log(`Cloudinary image migration complete. ${migrated} legacy image(s) migrated.`);
}

async function main() {
    try {
        await migrateLegacyImages();
    } catch (error) {
        console.error("Cloudinary image migration stopped:", error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

if (require.main === module) main();

module.exports = { migrateLegacyImages };
