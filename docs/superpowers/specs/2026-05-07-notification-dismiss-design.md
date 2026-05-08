# Notification Dismiss Design

**Date:** 2026-05-07

## Goal

Let users permanently delete individual notifications (via X button or swipe) and all notifications at once (Clear all), without page reloads.

## Architecture

Two new DELETE routes in `src/routes/notifications.js`. All deletions are permanent (hard delete from DB). The frontend uses optimistic UI — the row is removed from the DOM immediately, then the DELETE request fires in the background. No page reload for any action.

## Backend

### Routes (added to `src/routes/notifications.js`)

**Delete one:**
```
DELETE /notifications/:id
```
- Verifies `user_id = req.session.user.id` in the WHERE clause (ownership check — users cannot delete each other's notifications)
- `DELETE FROM notifications WHERE id = ? AND user_id = ?`
- Returns `{ ok: true }` on success, `{ ok: false }` on error

**Delete all:**
```
DELETE /notifications
```
- `DELETE FROM notifications WHERE user_id = ?`
- Returns `{ ok: true }` on success, `{ ok: false }` on error

Both routes are protected by `requireAuth` (already applied at router level).

## Frontend — HTML Changes (`notifications.ejs`)

Each notification row is currently a bare `<a>` tag. Restructure to:

```html
<div class="notif-row relative" data-id="<%= n.id %>">
  <a href="/post/<%= n.post_id %>" class="flex items-start gap-3 ...">
    [avatar + text content — unchanged]
  </a>
  <button type="button" class="notif-dismiss" data-id="<%= n.id %>" aria-label="Dismiss notification" title="Dismiss">
    <svg ...>✕</svg>
  </button>
</div>
```

The wrapper `<div class="notif-row relative">` provides the positioning context. The `<a>` covers the main tap area. The `<button class="notif-dismiss">` is `position: absolute; top: 0.5rem; right: 0.5rem` and sits in the corner independently of the `<a>`.

**Clear all button** — rendered in the page header next to the "Notifications" h1, only when `notifications.length > 0`:

```html
<div class="flex items-center justify-between mb-1">
  <h1 ...>Notifications</h1>
  <% if (notifications.length > 0) { %>
  <button id="notif-clear-all" type="button" class="text-xs text-slate-400 hover:text-red-500 ...">Clear all</button>
  <% } %>
</div>
```

**Notification list wrapper** — wrap the `notifications.forEach` block in a container with `id="notif-list"`:

```html
<div id="notif-list">
  <% notifications.forEach(function(n) { %>
  ...
  <% }) %>
</div>
```

**Empty state** — always rendered but hidden when there are notifications or the changelog card is showing. JS reveals it when the list empties:

```html
<p id="notif-empty"
   style="<%= (notifications.length > 0 || showChangelogDot) ? 'display:none' : '' %>"
   class="text-sm text-slate-400 dark:text-slate-500 py-4">
  Nothing yet — you'll see comments, mentions, and reactions here.
</p>
```

## Frontend — CSS (in `notifications.ejs` `<style>` block or inline)

```css
.notif-dismiss {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: #94a3b8; /* slate-400 */
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  transition: background 0.15s, color 0.15s;
  z-index: 1;
}
.notif-dismiss:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}
.dark .notif-dismiss { color: #64748b; }
.dark .notif-dismiss:hover { background: rgba(239, 68, 68, 0.15); color: #f87171; }

/* Collapse animation */
.notif-row {
  overflow: hidden;
  transition: max-height 0.25s ease, opacity 0.2s ease, margin 0.25s ease;
  max-height: 200px;
}
.notif-row.notif-removing {
  opacity: 0;
  max-height: 0;
  margin-top: 0;
  margin-bottom: 0;
}
```

## Frontend — JavaScript (in `notifications.ejs` before `</body>`)

Added in a `<script>` block after `<script src="/js/app.js"></script>`.

### Dismiss single (X button)

```js
document.querySelectorAll('.notif-dismiss').forEach(function(btn) {
  btn.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    var row = btn.closest('.notif-row');
    dismissRow(row, '/notifications/' + btn.dataset.id);
  });
});
```

### Clear all

```js
var clearBtn = document.getElementById('notif-clear-all');
if (clearBtn) {
  clearBtn.addEventListener('click', function() {
    var rows = document.querySelectorAll('.notif-row');
    rows.forEach(function(row) { row.classList.add('notif-removing'); });
    fetch('/notifications', { method: 'DELETE', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
      .catch(function() {
        rows.forEach(function(row) { row.classList.remove('notif-removing'); });
      });
    setTimeout(function() {
      rows.forEach(function(row) { row.remove(); });
      document.getElementById('notif-empty').style.display = '';
      clearBtn.remove();
    }, 250);
  });
}
```

### `dismissRow` helper

```js
function dismissRow(row, url) {
  row.classList.add('notif-removing');
  fetch(url, { method: 'DELETE', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
    .catch(function() { row.classList.remove('notif-removing'); });
  setTimeout(function() {
    row.remove();
    if (!document.querySelector('.notif-row')) {
      document.getElementById('notif-empty').style.display = '';
      var cb = document.getElementById('notif-clear-all');
      if (cb) cb.remove();
    }
  }, 250);
}
```

### Swipe to dismiss (touch only)

```js
document.querySelectorAll('.notif-row').forEach(function(row) {
  var startX = 0, startY = 0, dragging = false;
  var link = row.querySelector('a');

  row.addEventListener('touchstart', function(e) {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dragging = false;
  }, { passive: true });

  row.addEventListener('touchmove', function(e) {
    var dx = e.touches[0].clientX - startX;
    var dy = e.touches[0].clientY - startY;
    if (!dragging && Math.abs(dy) > Math.abs(dx)) return; // vertical scroll
    if (dx >= 0) return; // only left swipe
    dragging = true;
    e.preventDefault();
    link.style.transform = 'translateX(' + dx + 'px)';
    link.style.opacity = 1 + (dx / 200);
  }, { passive: false });

  row.addEventListener('touchend', function(e) {
    var dx = e.changedTouches[0].clientX - startX;
    if (dragging && dx < -80) {
      var id = row.dataset.id;
      dismissRow(row, '/notifications/' + id);
    } else {
      link.style.transform = '';
      link.style.opacity = '';
    }
    dragging = false;
  });
});
```

Swipe applies `translateX` directly to the inner `<a>` tag so the `notif-dismiss` button stays in place. Threshold is −80px. Vertical scrolling is detected by comparing `|dy| > |dx|` and aborts the swipe.

## Tailwind Note

The empty-state `<p>` is always server-rendered (hidden via inline `style` when there are notifications), then revealed by JS when the list empties. This avoids injecting Tailwind utility classes from JS strings, which Tailwind CDN wouldn't process.

In JS when list empties: `document.getElementById('notif-empty').style.display = ''`.

## Files to Modify

- `src/routes/notifications.js` — add DELETE /:id and DELETE / routes
- `src/views/notifications.ejs` — restructure rows, add X buttons, clear-all button, CSS, JS

## Non-Goals

- No undo / restore (permanent delete is intentional)
- No swipe on desktop (touch events only)
- No confirmation prompt before "Clear all" (lightweight family app, not high-stakes)
- No pagination (already limited to 50 rows)
