const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { sendFeedbackNotification } = require('../email');

router.use(requireAuth);

router.get('/', (req, res) => {
  const submitted = req.query.submitted || null;
  const error = req.query.error || null;
  const raw = submitted || req.query.from;
  const autoOpen = ['bug', 'feature'].includes(raw) ? raw : null;
  res.render('feedback', { submitted, error, autoOpen });
});

router.post('/bug', async (req, res) => {
  const title = req.body.title?.trim();
  const description = req.body.description?.trim();
  const severity = ['low', 'medium', 'high'].includes(req.body.severity) ? req.body.severity : 'low';
  if (!title || !description) return res.redirect('/feedback?error=1&from=bug');
  if (title.length > 150) return res.redirect('/feedback?error=1&from=bug');
  if (description.length > 5000) return res.redirect('/feedback?error=1&from=bug');
  try {
    await pool.query(
      'INSERT INTO feedback (user_id, type, title, description, severity) VALUES (?, "bug", ?, ?, ?)',
      [req.session.user.id, title, description, severity]
    );
    const [[admin]] = await pool.query('SELECT email FROM users WHERE role = "admin" LIMIT 1');
    if (admin) {
      (async () => {
        await sendFeedbackNotification(admin.email, req.session.user.name, { type: 'bug', title, description, severity });
      })().catch(console.error);
    }
  } catch (err) {
    console.error(err);
    return res.redirect('/feedback?error=1&from=bug');
  }
  res.redirect('/feedback?submitted=bug');
});

router.post('/feature', async (req, res) => {
  const title = req.body.title?.trim();
  const description = req.body.description?.trim();
  if (!title || !description) return res.redirect('/feedback?error=1&from=feature');
  if (title.length > 150) return res.redirect('/feedback?error=1&from=feature');
  if (description.length > 5000) return res.redirect('/feedback?error=1&from=feature');
  try {
    await pool.query(
      'INSERT INTO feedback (user_id, type, title, description) VALUES (?, "feature", ?, ?)',
      [req.session.user.id, title, description]
    );
    const [[admin]] = await pool.query('SELECT email FROM users WHERE role = "admin" LIMIT 1');
    if (admin) {
      (async () => {
        await sendFeedbackNotification(admin.email, req.session.user.name, { type: 'feature', title, description, severity: null });
      })().catch(console.error);
    }
  } catch (err) {
    console.error(err);
    return res.redirect('/feedback?error=1&from=feature');
  }
  res.redirect('/feedback?submitted=feature');
});

module.exports = router;
