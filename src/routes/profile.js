const express = require('express');
const router = express.Router();

router.get('*', (req, res) => res.redirect(301, '/settings'));

module.exports = router;
