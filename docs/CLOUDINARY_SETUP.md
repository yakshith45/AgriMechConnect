# Cloudinary image hosting

User-uploaded machinery photos are sent from the owner dashboard to the authenticated Express API. The API validates the file, streams it to Cloudinary, and saves only the optimized HTTPS URL and Cloudinary public ID in Supabase. Image bytes are not written to the repository or stored in the database.

The site still keeps its own logos, icons, and bundled illustration/category assets in `frontend/assets/images/`. These are source-controlled website assets, not owner uploads.

## Configure credentials

1. Create a Cloudinary account and open the product environment credentials in its Console.
2. Add the Cloud name, API Key, and API Secret to `backend/.env` as `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`.
3. Keep the API Secret on the backend only. Uploads use the signed Cloudinary Node SDK; no unsigned browser preset or secret is exposed to the frontend.
4. Set `CLOUDINARY_FOLDER` if you want a different root folder. Each owner's uploaded images are placed in an owner-specific subfolder.

## Upload behavior

- The owner form accepts PNG, JPEG, and WebP files up to 3 MB.
- The API accepts uploads only for authenticated users with the Owner role.
- Cloudinary returns the HTTPS image URL and public ID. Supabase stores those references in `machinery.image_url` and `machinery.cloudinary_public_id`.
- Delivery URLs use automatic format and quality transformations.
- Replacing a listing photo removes the old Cloudinary asset after the database update succeeds. If the listing save is rejected, the browser asks the API to remove the unused new upload.

## Existing listings

For an existing Supabase database, run `npm.cmd --prefix backend run migrate:cloudinary` once to add the public ID column. For listings with old base64 images, run `npm.cmd --prefix backend run migrate:cloudinary-images` after transferring the records into Supabase. The migration reports each listing and does not delete legacy data when an image cannot be uploaded.
