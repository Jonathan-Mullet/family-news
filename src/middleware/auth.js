/**
 * Auth middleware for Express routes.
 *
 * Provides two route guards: `requireAuth` for any logged-in user and
 * `requireAdmin` for admin-only routes. Both are intended to be used as
 * Express middleware functions (passed directly to router.get/post/use).
 */

// ── Route guards ──────────────────────────────────────────────────────────────

/**
 * Ensures the request comes from a logged-in user.
 * Redirects to /login if no session user is present.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

/**
 * Ensures the request comes from a logged-in admin user.
 * Checks both that a session user exists AND that their role is 'admin',
 * so it can be used standalone without chaining `requireAuth` first.
 * Responds with 403 if the check fails.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin')
    return res.status(403).render('error', { message: 'Access denied.' });
  next();
}

module.exports = { requireAuth, requireAdmin };
