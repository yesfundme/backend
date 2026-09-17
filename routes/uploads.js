const express = require('express');
const multer = require('multer');
const { nanoid } = require('nanoid');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  }
});

const BUCKET = 'campaign-images';
const ID_BUCKET = 'id-documents';

// POST /api/uploads/campaign-image
// multipart/form-data, field name: "image"
router.post('/campaign-image', requireAuth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file was provided' });

    const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase();
    const path = `${req.user.id}/${Date.now()}-${nanoid(8)}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    res.json({ url: data.publicUrl });
  } catch (err) {
    console.error('Image upload error:', err.message || err);
    res.status(500).json({ error: err.message || 'Could not upload image. Please try again.' });
  }
});

// POST /api/uploads/id-document
// multipart/form-data, field name: "image". Uploaded to a PRIVATE bucket -
// unlike campaign images, this returns only a storage path, never a public
// URL. The file can only be viewed later via an admin-only signed URL
// (see GET /api/admin/withdrawals/:id/id-document).
router.post('/id-document', requireAuth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file was provided' });

    const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase();
    const path = `${req.user.id}/${Date.now()}-${nanoid(8)}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(ID_BUCKET)
      .upload(path, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      });

    if (uploadError) throw uploadError;

    res.json({ path });
  } catch (err) {
    console.error('ID document upload error:', err.message || err);
    res.status(500).json({ error: err.message || 'Could not upload ID document. Please try again.' });
  }
});

module.exports = router;
