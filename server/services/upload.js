const cloudinary = require('cloudinary').v2;
require('dotenv').config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function uploadImage(dataUrl) {
  try {
    const result = await cloudinary.uploader.upload(dataUrl, {
      folder: 'shop-ai-wardrobe',
      resource_type: 'image',
    });
    return result.secure_url;
  } catch (err) {
    console.error('Cloudinary upload error:', err);
    throw new Error('Image upload failed');
  }
}

module.exports = { uploadImage };