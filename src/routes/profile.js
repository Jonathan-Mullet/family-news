// Legacy redirect: the old /profile page was merged into /settings. This
// router exists only so bookmarks and stale links keep working — there is no
// profile view anymore (src/views/profile.ejs was removed).
const express = require('express');
const router = express.Router();

router.get('*', (req, res) => res.redirect(301, '/settings'));

module.exports = router;
