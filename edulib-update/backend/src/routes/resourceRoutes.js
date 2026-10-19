'use strict';
const express = require('express');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');   // JWT middleware from Objective 1; sets req.user.id
const { upload } = require('../config/upload');
const c = require('../controllers/resourceController');

const router = express.Router();

// Signed-link endpoint: authorised by the signature, so it must sit before authenticate.
router.get('/:id/stream', c.stream);

router.use(authenticate);

// Wrap multer so its errors become clean JSON responses instead of stack traces.
const handleUpload = (req, res, next) =>
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE')
      return res.status(413).json({ error: 'File is too large' });
    return res.status(err.status || 400).json({ error: err.message });
  });

router.post('/', handleUpload, c.upload);
router.get('/', c.list);
router.get('/facets', c.facets);          // static routes must come before '/:id'
router.get('/subjects', c.subjects);
router.get('/recommended', c.recommended);
router.get('/recent', c.recent);
router.get('/:id', c.getOne);
router.get('/:id/related', c.related);
router.post('/:id/view-link', c.viewLink);
router.patch('/:id', c.update);
router.post('/:id/reanalyze', c.reanalyze);
router.delete('/:id', c.remove);

module.exports = router;
