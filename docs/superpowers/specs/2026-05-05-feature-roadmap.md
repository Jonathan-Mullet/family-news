# Family News — Feature Roadmap

**Date:** 2026-05-05

This document captures the agreed-upon feature backlog. Each tier-1/tier-2 feature will get its own design spec and implementation plan when work begins.

---

## Tier 1 — High impact, clear gaps

### Multi-photo posts + display fixes
- Posts can contain multiple photos (gallery/carousel per post)
- Photos displayed at natural aspect ratio (landscape/portrait preserved, not cropped to square)
- Lightbox: tap any photo to view full-size

### Moderator role
- New `moderator` role between `member` and `admin`
- **Moderator powers:** pin/unpin posts, delete any post, toggle Big News, send Big News email blasts, basic activity visibility
- **Admin-only:** user management, role assignment, full analytics/read receipts, invite management, site settings, birthday event config
- **Role guide page:** shown to mods and admins, tailored to their level — mods see what they can do vs. regular members; admins see the full picture including what mods can't touch
- **Promotion notification:** push notification + email sent when a member is promoted to moderator or admin

---

## Tier 2 — Meaningful additions

### Expanded admin panel
- Site analytics: post/reaction/comment counts, active member stats
- Read receipts per post (admin-only): see which members have viewed a post
- Push subscriber management: see all subscribed devices, send test notification
- Invite link management: see outstanding invites, revoke individual links
- Scheduled post management: view and cancel all pending scheduled posts

### Photo library page
- A dedicated page browsing every photo posted across all members
- Filterable by member, date range

### Video link embed
- Paste a YouTube or Vimeo URL into a post and it renders as an inline player
- No video stored on the Pi — links only

### @mentions in comments
- Type `@Name` in a comment to notify that member via push + email

### What's New / site changelog
- Admin-maintained page listing site updates and new features
- Accessible from the nav for all members

### Feedback page
- Single `/feedback` page accessible from the nav for all members
- Two sections: "Report a Bug" (title + severity + description) and "Request a Feature" (title + description)
- Submissions stored in DB + email notification to admin
- Admin panel Feedback tab: review open/resolved items, mark resolved with optional personal message
- Courtesy email sent to submitter when item is resolved

---

## Tier 3 — Nice but lower urgency

- **Family polls** — "vote on Thanksgiving location" style posts
- **Search** — find old posts by keyword
- **Memory export** — download a ZIP of all family posts and photos

---

## Roles summary

| Capability | Member | Moderator | Admin |
|---|---|---|---|
| Post, comment, react | ✓ | ✓ | ✓ |
| Edit/delete own posts | ✓ | ✓ | ✓ |
| Pin posts | | ✓ | ✓ |
| Delete any post | | ✓ | ✓ |
| Toggle Big News | | ✓ | ✓ |
| Send Big News email blast | | ✓ | ✓ |
| Basic activity visibility | | ✓ | ✓ |
| Full analytics + read receipts | | | ✓ |
| User management | | | ✓ |
| Role assignment | | | ✓ |
| Invite management | | | ✓ |
| Site settings / birthday config | | | ✓ |
