# family-news

## Gotchas
- `connect-flash`: `req.flash()` initializes `req.session.flash={}` on every call, bypassing `saveUninitialized:false`. Always guard: `req.session.flash ? req.flash() : {}`
- `app.locals.latestChangelogAt` is loaded from `src/data/changelog-meta.json` at container startup — must commit + push the sidecar for changelog dot changes to take effect after deploy
- `scripts/add-changelog.js` runs on the Pi host (not in Docker) — use `timezone:'+00:00'` in any mysql2 pool added to host scripts
