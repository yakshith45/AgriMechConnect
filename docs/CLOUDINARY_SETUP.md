# Cloudinary Setup Guide for AgriMechConnect

This guide walks you through setting up a free [Cloudinary](https://cloudinary.com/) account, creating an upload preset for machinery photos, and connecting the backend & frontend.

---

## 1. Create a Cloudinary Account

1. Go to [https://cloudinary.com/](https://cloudinary.com/) and register for a free account.
2. Once logged in, go to your **Cloudinary Console (Dashboard)**.
3. Under **Product Environment Credentials**, copy:
   - **Cloud name**
   - **API Key**
   - **API Secret**

---

## 2. Configure an Upload Preset

1. In the Cloudinary Console, click the **Settings (gear icon)** at the bottom left.
2. Navigate to **Upload** -> scroll down to **Upload presets**.
3. Click **Add upload preset**:
   - **Name:** `agrimech_machinery`
   - **Signing Mode:** `Signed` (recommended if uploading via backend) or `Unsigned` (if uploading directly from browser).
   - **Folder:** `agrimech/machinery`
   - **Media analysis & AI:** Auto-format (`f_auto`) and Auto-quality (`q_auto`) enabled.
4. Click **Save**.

---

## 3. Backend Integration (`backend/src/config/cloudinary.js`)

Install the Cloudinary Node SDK:
```bash
npm install cloudinary multer
```

Setup the Cloudinary client:
```javascript
const cloudinary = require("cloudinary").v2;

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
});

module.exports = cloudinary;
```

---

## 4. Automatic Image Transformations

When rendering images on cards, use Cloudinary dynamic transformation URLs to deliver crisp, lightweight images without downloading full-resolution camera files:

```html
<!-- Example 16:10 aspect ratio card thumbnail -->
<img src="https://res.cloudinary.com/<CLOUD_NAME>/image/upload/c_fill,w_720,h_450,q_auto,f_auto/v1/<PUBLIC_ID>"
     alt="John Deere Tractor"
     loading="lazy" />
```

- `c_fill,w_720,h_450`: Cropped and scaled perfectly to match machinery card dimensions.
- `q_auto`: Automated smart compression.
- `f_auto`: Delivers WebP/AVIF depending on user's device.
