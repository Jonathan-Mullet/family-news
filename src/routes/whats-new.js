const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const [entries] = await pool.query(
      'SELECT id, title, body, published_at FROM changelog ORDER BY published_at DESC'
    );
    await pool.query('UPDATE users SET whats_new_seen_at = NOW() WHERE id = ?', [req.session.user.id]);
    req.session.user.whats_new_seen_at = new Date();
    res.render('whats-new', { entries });
  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Could not load changelog.' });
  }
});

module.exports = router;
