// Multer + Sharp image processing middleware for single photo, multi-photo gallery, and avatar uploads.
const multer = require('multer');
const sharp = require('sharp');
const heicConvert = require('heic-convert');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// This path is a Docker volume mount: /app/uploads inside the container maps to a persistent directory on the Pi host.
const UPLOADS_DIR = '/app/uploads';

// iPhones default to HEIC, which sharp's bundled libheif can't decode (no HEVC
// decoder plugin) — it would silently write a 0-byte file. Detect HEIC by its
// ISO-BMFF `ftyp` brand and convert to a JPEG buffer (pure-JS, libheif WASM)
// before handing off to sharp. JPEG/PNG pass through untouched.
const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs', 'mif1', 'msf1']);
function isHeic(buffer) {
  if (!buffer || buffer.length < 12) return false;
  if (buffer.toString('latin1', 4, 8) !== 'ftyp') return false;
  return HEIC_BRANDS.has(buffer.toString('latin1', 8, 12));
}
async function toProcessableBuffer(buffer) {
  if (!isHeic(buffer)) return buffer;
  // libheif applies the rotation transforms while decoding, so the JPEG comes out
  // upright; sharp's later .rotate() then becomes a harmless no-op.
  return heicConvert({ buffer, format: 'JPEG', quality: 1 });
}

// Ensure uploads directory exists
try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch {}

// Store files temporarily in memory, then process with sharp
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max upload
  fileFilter(req, file, cb) {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

async function processAndSave(buffer) {
  // Unguessable name: upload URLs act like capability tokens for family photos,
  // so use a CSPRNG — the old Date.now()+Math.random() prefix was predictable.
  const filename = `${crypto.randomBytes(16).toString('hex')}.jpg`;
  const outPath = path.join(UPLOADS_DIR, filename);
  const src = await toProcessableBuffer(buffer);
  await sharp(src)
    // .rotate() with no argument reads the EXIF orientation tag and auto-rotates the image,
    // which fixes sideways or upside-down photos taken on phones.
    .rotate()
    .resize({ width: 1200, withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toFile(outPath);
  return filename;
}

// Middleware: multer + sharp processing
function handleUpload(req, res, next) {
  upload.single('photo')(req, res, async (err) => {
    if (err) {
      console.error('Upload error:', err.message);
      req.uploadError = err.message;
      return next();
    }
    if (!req.file) return next();
    try {
      const filename = await processAndSave(req.file.buffer);
      req.uploadedPath = `/uploads/${filename}`;
    } catch (e) {
      console.error('Sharp processing error:', e.message);
      req.uploadError = 'Could not process image.';
    }
    next();
  });
}

async function processAndSaveAvatar(buffer) {
  const filename = `avatar-${crypto.randomBytes(16).toString('hex')}.jpg`;
  const outPath = path.join(UPLOADS_DIR, filename);
  const src = await toProcessableBuffer(buffer);
  await sharp(src)
    // .rotate() auto-corrects EXIF orientation so selfies aren't sideways.
    .rotate()
    .resize(256, 256, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 85 })
    .toFile(outPath);
  return filename;
}

// Middleware: process a single avatar upload, crop to 256x256, and attach the path to the request.
function handleAvatarUpload(req, res, next) {
  upload.single('avatar')(req, res, async (err) => {
    if (err) { req.uploadError = err.message; return next(); }
    if (!req.file) return next();
    try {
      const filename = await processAndSaveAvatar(req.file.buffer);
      req.uploadedPath = `/uploads/${filename}`;
    } catch (e) {
      console.error('Sharp avatar error:', e.message);
      req.uploadError = 'Could not process image.';
    }
    next();
  });
}

// Middleware: process up to 5 photos for a gallery post and attach an array of paths to the request.
function handleMultiUpload(req, res, next) {
  upload.array('photos', 5)(req, res, async (err) => {
    if (err) { req.uploadError = err.message; return next(); }
    if (!req.files || !req.files.length) return next();
    try {
      const paths = [];
      for (const file of req.files) {
        paths.push(`/uploads/${await processAndSave(file.buffer)}`);
      }
      req.uploadedPaths = paths;
    } catch (e) {
      console.error('Multi-upload error:', e.message);
      req.uploadError = 'Could not process images.';
    }
    next();
  });
}

// Delete an uploaded file from the uploads volume by its URL path; silently ignores missing files.
function deleteUploadedFile(photoUrl) {
  if (!photoUrl || !photoUrl.startsWith('/uploads/')) return;
  const filename = path.basename(photoUrl);
  const fullPath = path.join(UPLOADS_DIR, filename);
  fs.unlink(fullPath, (err) => {
    if (err && err.code !== 'ENOENT') console.error('Error deleting file:', err.message);
  });
}

module.exports = { handleUpload, handleMultiUpload, handleAvatarUpload, deleteUploadedFile };
