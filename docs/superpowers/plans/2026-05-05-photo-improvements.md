# Photo Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix photo display so images preserve their natural aspect ratio, add a swipeable focused carousel for multi-photo posts, and add a full-screen lightbox for viewing photos at full size.

**Architecture:** The Sharp upload pipeline already stores photos at natural aspect ratio — all changes are on the display side. EJS templates output photo URLs into `data-photos` attributes; vanilla JS in `app.js` reads those and initializes carousels and lightboxes. The lightbox is a single body-level element (same pattern as the existing emoji picker), and the carousel initializes one instance per `.photo-carousel` DOM node on page load.

**Tech Stack:** EJS (photo markup), vanilla JS (carousel + lightbox in `app.js`), existing Sharp/multer upload pipeline (unchanged), Tailwind CDN for static classes (inline styles required for JS-driven show/hide per the Tailwind CDN limitation documented in the codebase).

---

### Task 1: Fix multi-photo upload input

**Files:**
- Modify: `src/views/feed.ejs`

The upload input currently lacks the `multiple` attribute, so users can only pick one file per dialog click. The backend already accepts up to 5 files (`upload.array('photos', 5)`). This task also updates the change handler to process all selected files at once.

- [ ] **Step 1: Add `multiple` to the file input and update button label**

  In `src/views/feed.ejs`, find line 11:
  ```html
  <input type="file" name="photos" id="photo-input" accept="image/*" class="hidden">
  ```
  Replace with:
  ```html
  <input type="file" name="photos" id="photo-input" accept="image/*" multiple class="hidden">
  ```

  Then find the "Add Photo" button text (around line 23):
  ```
  📷 Add Photo
  ```
  Replace with:
  ```
  📷 Add Photos
  ```

- [ ] **Step 2: Update the change handler to process multiple files**

  In `src/views/feed.ejs`, find the `photoInput.addEventListener('change', ...)` block in the `<script>` section:
  ```js
  photoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file || selectedPhotos.length >= MAX_PHOTOS) return;
    const reader = new FileReader();
    reader.onload = ev => {
      selectedPhotos.push({ thumbUrl: ev.target.result, file });
      renderThumbs();
      syncFiles();
      postExtras.classList.remove('hidden');
      extrasToggle.textContent = '− Less';
    };
    reader.readAsDataURL(file);
    photoInput.value = '';
  });
  ```
  Replace with:
  ```js
  photoInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files).slice(0, MAX_PHOTOS - selectedPhotos.length);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = ev => {
        selectedPhotos.push({ thumbUrl: ev.target.result, file });
        renderThumbs();
        syncFiles();
        postExtras.classList.remove('hidden');
        extrasToggle.textContent = '− Less';
      };
      reader.readAsDataURL(file);
    });
    photoInput.value = '';
  });
  ```

- [ ] **Step 3: Test multi-photo upload**

  Run the app (or deploy to the Pi — see Task 5). Open the feed. Click `+ More` to expand the post form, then click `📷 Add Photos`. Select 3 images in one dialog. Confirm:
  - All 3 thumbnail previews appear below the button
  - The button hides once 5 photos are selected
  - Submitting the form uploads all 3 photos (check `post_photos` table: `sudo docker compose exec mysql mysql -ufamilynews -pf32a85d6b04822d2c090ce1c1aeea698 family_news -e "SELECT * FROM post_photos ORDER BY id DESC LIMIT 10;" 2>/dev/null`)

- [ ] **Step 4: Commit**

  ```bash
  cd ~/projects/family-news
  git add src/views/feed.ejs
  git commit -m "feat: allow selecting multiple photos at once in post form"
  ```

---

### Task 2: Update post-card.ejs photo display

**Files:**
- Modify: `src/views/partials/post-card.ejs`

This replaces the current photo display (single photo with `max-h-80 object-cover` crop; multi-photo with fixed 176×176 squares) with markup that the JS carousel and lightbox will initialize. The JS in Task 4 reads `data-photos` from these elements.

- [ ] **Step 1: Replace the photo section**

  In `src/views/partials/post-card.ejs`, find the entire `<%# Photos %>` block:
  ```html
  <%# Photos %>
  <% if (post.photos && post.photos.length) { %>
  <div class="mt-3">
    <% if (post.photos.length === 1) { %>
    <div class="rounded-xl overflow-hidden border border-slate-100 dark:border-slate-700">
      <img src="<%= post.photos[0] %>" alt="" class="w-full object-cover max-h-80" loading="lazy" onerror="this.parentElement.remove()">
    </div>
    <% } else { %>
    <div class="flex gap-2 overflow-x-auto pb-1">
      <% post.photos.forEach(url => { %>
      <div class="shrink-0 w-44 h-44 rounded-xl overflow-hidden border border-slate-100 dark:border-slate-700">
        <img src="<%= url %>" alt="" class="w-full h-full object-cover" loading="lazy" onerror="this.parentElement.remove()">
      </div>
      <% }) %>
    </div>
    <% } %>
  </div>
  <% } %>
  ```
  Replace with:
  ```html
  <%# Photos %>
  <% if (post.photos && post.photos.length) { %>
  <div class="mt-3">
    <% if (post.photos.length === 1) { %>
    <%# Single photo: natural aspect ratio, max 500px tall, tappable for lightbox %>
    <div class="photo-single-wrap rounded-xl overflow-hidden border border-slate-100 dark:border-slate-700 cursor-pointer"
         style="max-height:500px;"
         data-photos="<%= JSON.stringify(post.photos) %>">
      <img src="<%= post.photos[0] %>" alt="" class="w-full" style="height:auto;display:block;" loading="lazy" onerror="this.parentElement.remove()">
    </div>
    <% } else { %>
    <%# Multi-photo: focused carousel initialized by _initPhotoCarousels() in app.js %>
    <div class="photo-carousel" style="position:relative;" data-photos="<%= JSON.stringify(post.photos) %>">
      <div class="photo-carousel-track" style="display:flex;align-items:center;gap:5px;padding:4px;overflow:hidden;border-radius:8px;min-height:60px;"></div>
      <div class="photo-carousel-dots" style="display:flex;gap:4px;justify-content:center;margin-top:6px;padding-bottom:2px;"></div>
    </div>
    <% } %>
  </div>
  <% } %>
  ```

- [ ] **Step 2: Commit**

  ```bash
  cd ~/projects/family-news
  git add src/views/partials/post-card.ejs
  git commit -m "feat: update post-card photo markup for carousel and lightbox"
  ```

---

### Task 3: Update post.ejs photo display

**Files:**
- Modify: `src/views/post.ejs`

`post.ejs` (the single-post detail view) has its own independent photo section with the same square-cropping issues. Apply the same treatment.

- [ ] **Step 1: Replace the photo section in post.ejs**

  In `src/views/post.ejs`, find the photo block (starts around line 80):
  ```html
  <% if (post.photos && post.photos.length) { %>
  <div class="mt-4">
    <% if (post.photos.length === 1) { %>
    <div class="rounded-xl overflow-hidden border border-slate-100 dark:border-slate-700">
      <img src="<%= post.photos[0] %>" alt="" class="w-full object-cover" loading="lazy" onerror="this.parentElement.remove()">
    </div>
    <% } else { %>
    <div class="flex gap-2 overflow-x-auto pb-1">
      <% post.photos.forEach(url => { %>
      <div class="shrink-0 w-56 h-56 rounded-xl overflow-hidden border border-slate-100 dark:border-slate-700">
        <img src="<%= url %>" alt="" class="w-full h-full object-cover" loading="lazy" onerror="this.parentElement.remove()">
      </div>
      <% }) %>
    </div>
    <% } %>
  </div>
  <% } %>
  ```
  Replace with:
  ```html
  <% if (post.photos && post.photos.length) { %>
  <div class="mt-4">
    <% if (post.photos.length === 1) { %>
    <div class="photo-single-wrap rounded-xl overflow-hidden border border-slate-100 dark:border-slate-700 cursor-pointer"
         style="max-height:500px;"
         data-photos="<%= JSON.stringify(post.photos) %>">
      <img src="<%= post.photos[0] %>" alt="" class="w-full" style="height:auto;display:block;" loading="lazy" onerror="this.parentElement.remove()">
    </div>
    <% } else { %>
    <div class="photo-carousel" style="position:relative;" data-photos="<%= JSON.stringify(post.photos) %>">
      <div class="photo-carousel-track" style="display:flex;align-items:center;gap:5px;padding:4px;overflow:hidden;border-radius:8px;min-height:60px;"></div>
      <div class="photo-carousel-dots" style="display:flex;gap:4px;justify-content:center;margin-top:6px;padding-bottom:2px;"></div>
    </div>
    <% } %>
  </div>
  <% } %>
  ```

- [ ] **Step 2: Commit**

  ```bash
  cd ~/projects/family-news
  git add src/views/post.ejs
  git commit -m "feat: update post detail view photo markup for carousel and lightbox"
  ```

---

### Task 4: Add photo carousel and lightbox JS to app.js

**Files:**
- Modify: `src/public/js/app.js`

Add a new section between `// ── Emoji picker bottom sheet ──` and `// ── Feed auto-refresh ──`. This section adds:
1. A body-level lightbox element (same pattern as `_reactionSheet` and `_pickerSheet`)
2. `_openLightbox(urls, startIdx)` — opens lightbox at a given photo index
3. `_closeLightbox()` — closes and restores scroll
4. `_renderLightbox()` — updates the displayed image and navigation state
5. `_makeCarouselArrow(label, handler)` — creates a styled arrow button
6. `_initPhotoCarousels()` — initializes all `.photo-carousel` elements on the page
7. Wire `.photo-single-wrap` click → lightbox
8. Call `_initPhotoCarousels()`

**Important:** Tailwind CDN cannot style dynamically-created elements. All carousel and lightbox styles must use inline `style` attributes.

- [ ] **Step 1: Find the insertion point in app.js**

  In `src/public/js/app.js`, find the line that reads:
  ```js
  // ── Feed auto-refresh ─────────────────────────────────────────────────────────
  ```
  Insert the entire block below immediately before that line.

- [ ] **Step 2: Add the photo carousel + lightbox section**

  Insert this block:
  ```js
  // ── Photo carousel + lightbox ─────────────────────────────────────────────────
  // Lightbox: body-level overlay (same pattern as reaction sheet / emoji picker).
  // Carousel: initialized per .photo-carousel element; active photo shows at
  // natural aspect ratio, inactive photos are 52×52 squares. Swipe to navigate
  // on touch; hover to reveal ‹ › arrows on desktop.

  const _lightbox = (() => {
    const el = document.createElement('div');
    el.style.cssText = 'display:none;position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.92);flex-direction:column;align-items:center;justify-content:center;touch-action:none;';
    el.innerHTML = [
      '<button id="lb-close" type="button" style="position:absolute;top:16px;right:16px;background:rgba(255,255,255,0.15);border:none;border-radius:50%;width:36px;height:36px;color:white;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2;">✕</button>',
      '<button id="lb-prev" type="button" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.15);border:none;border-radius:50%;width:44px;height:44px;color:white;font-size:24px;cursor:pointer;display:none;align-items:center;justify-content:center;">‹</button>',
      '<img id="lb-img" src="" alt="" style="max-width:92vw;max-height:85vh;object-fit:contain;border-radius:4px;user-select:none;">',
      '<button id="lb-next" type="button" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.15);border:none;border-radius:50%;width:44px;height:44px;color:white;font-size:24px;cursor:pointer;display:none;align-items:center;justify-content:center;">›</button>',
      '<div id="lb-dots" style="position:absolute;bottom:20px;left:0;right:0;display:flex;gap:6px;justify-content:center;"></div>',
    ].join('');
    document.body.appendChild(el);
    return el;
  })();

  let _lbUrls = [];
  let _lbIdx = 0;
  const _lbImg = document.getElementById('lb-img');
  const _lbDotsEl = document.getElementById('lb-dots');
  const _lbPrev = document.getElementById('lb-prev');
  const _lbNext = document.getElementById('lb-next');

  function _renderLightbox() {
    _lbImg.src = _lbUrls[_lbIdx];
    _lbPrev.style.display = _lbIdx > 0 ? 'flex' : 'none';
    _lbNext.style.display = _lbIdx < _lbUrls.length - 1 ? 'flex' : 'none';
    _lbDotsEl.innerHTML = '';
    if (_lbUrls.length > 1) {
      _lbUrls.forEach((_, i) => {
        const d = document.createElement('div');
        d.style.cssText = `width:${i === _lbIdx ? '16' : '6'}px;height:6px;border-radius:3px;background:${i === _lbIdx ? 'white' : 'rgba(255,255,255,0.35)'};transition:all 0.2s;`;
        _lbDotsEl.appendChild(d);
      });
    }
  }

  function _openLightbox(urls, startIdx) {
    _lbUrls = urls;
    _lbIdx = startIdx;
    _renderLightbox();
    _lightbox.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function _closeLightbox() {
    _lightbox.style.display = 'none';
    document.body.style.overflow = '';
  }

  document.getElementById('lb-close').addEventListener('click', _closeLightbox);
  _lbPrev.addEventListener('click', () => { if (_lbIdx > 0) { _lbIdx--; _renderLightbox(); } });
  _lbNext.addEventListener('click', () => { if (_lbIdx < _lbUrls.length - 1) { _lbIdx++; _renderLightbox(); } });
  _lightbox.addEventListener('click', e => { if (e.target === _lightbox) _closeLightbox(); });

  let _lbTouchX = 0;
  _lightbox.addEventListener('touchstart', e => { _lbTouchX = e.touches[0].clientX; }, { passive: true });
  _lightbox.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - _lbTouchX;
    if (dx < -50 && _lbIdx < _lbUrls.length - 1) { _lbIdx++; _renderLightbox(); }
    else if (dx > 50 && _lbIdx > 0) { _lbIdx--; _renderLightbox(); }
  });

  function _makeCarouselArrow(label, handler) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.style.cssText = 'display:none;position:absolute;top:45%;transform:translateY(-50%);z-index:5;background:rgba(255,255,255,0.85);border:none;border-radius:50%;width:28px;height:28px;font-size:16px;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.2);align-items:center;justify-content:center;';
    btn.addEventListener('click', handler);
    return btn;
  }

  function _initPhotoCarousels() {
    const THUMB = 52;
    const GAP = 5;
    const MAX_H = 280;

    document.querySelectorAll('.photo-carousel').forEach(container => {
      const urls = JSON.parse(container.dataset.photos || '[]');
      if (urls.length < 2) return;

      const track = container.querySelector('.photo-carousel-track');
      const dotsEl = container.querySelector('.photo-carousel-dots');
      let current = 0;

      const imgs = urls.map((url, i) => {
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        img.loading = i === 0 ? 'eager' : 'lazy';
        img.style.cssText = 'flex-shrink:0;border-radius:8px;object-fit:cover;transition:width 0.3s ease,height 0.3s ease,opacity 0.3s ease;cursor:pointer;';
        img.addEventListener('load', () => { if (i === current) render(); });
        img.addEventListener('click', () => { if (i === current) _openLightbox(urls, current); else goto(i); });
        track.appendChild(img);
        return img;
      });

      const dots = urls.map((_, i) => {
        const d = document.createElement('div');
        d.style.cssText = 'height:6px;border-radius:3px;background:#cbd5e1;cursor:pointer;transition:width 0.2s ease,background 0.2s ease;';
        d.addEventListener('click', () => goto(i));
        dotsEl.appendChild(d);
        return d;
      });

      const LA = _makeCarouselArrow('‹', () => { if (current > 0) goto(current - 1); });
      const RA = _makeCarouselArrow('›', () => { if (current < urls.length - 1) goto(current + 1); });
      LA.style.left = '6px';
      RA.style.right = '6px';
      container.appendChild(LA);
      container.appendChild(RA);

      container.addEventListener('mouseenter', () => {
        if (!('ontouchstart' in window)) { LA.style.display = 'flex'; RA.style.display = 'flex'; }
      });
      container.addEventListener('mouseleave', () => { LA.style.display = 'none'; RA.style.display = 'none'; });

      let touchX = 0;
      track.addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
      track.addEventListener('touchend', e => {
        const dx = e.changedTouches[0].clientX - touchX;
        if (dx < -40 && current < urls.length - 1) goto(current + 1);
        else if (dx > 40 && current > 0) goto(current - 1);
      });

      function goto(i) { current = i; render(); }

      function render() {
        // Always put active photo first in the flex row so layout is [ACTIVE][THUMB][THUMB]...
        track.insertBefore(imgs[current], track.firstChild);

        const cw = container.offsetWidth || 320;
        const inactiveTotal = (urls.length - 1) * (THUMB + GAP);
        const activeW = Math.max(80, cw - inactiveTotal - GAP * 2);
        const nr = (imgs[current].naturalWidth && imgs[current].naturalHeight)
          ? imgs[current].naturalWidth / imgs[current].naturalHeight
          : 4 / 3;
        const activeH = Math.min(MAX_H, activeW / nr);

        imgs.forEach((img, i) => {
          if (i === current) {
            img.style.width = Math.round(activeH * nr) + 'px';
            img.style.height = Math.round(activeH) + 'px';
            img.style.opacity = '1';
          } else {
            img.style.width = THUMB + 'px';
            img.style.height = THUMB + 'px';
            img.style.opacity = '0.6';
          }
        });

        dots.forEach((d, i) => {
          d.style.width = i === current ? '16px' : '6px';
          d.style.background = i === current ? '#8b5e3c' : '#cbd5e1';
        });
      }

      render();
    });
  }

  // Wire single-photo click → lightbox
  document.querySelectorAll('.photo-single-wrap').forEach(wrap => {
    const urls = JSON.parse(wrap.dataset.photos || '[]');
    wrap.addEventListener('click', () => _openLightbox(urls, 0));
  });

  _initPhotoCarousels();
  ```

- [ ] **Step 3: Verify the section was inserted in the right place**

  Open `src/public/js/app.js` and confirm that `// ── Photo carousel + lightbox ──` appears BEFORE `// ── Feed auto-refresh ──`.

- [ ] **Step 4: Test single-photo lightbox**

  Navigate to a post with one photo. The photo should display at natural aspect ratio (no square cropping), capped at 500px tall. Tap/click the photo — the lightbox overlay should open showing the full image. Tap the ✕ or the dark backdrop to close.

- [ ] **Step 5: Test multi-photo carousel**

  Navigate to a post with 2–5 photos (create one via the upload fix in Task 1 if needed). Confirm:
  - Active photo shows at natural aspect ratio (not square-cropped)
  - Inactive photos are 52×52 squares
  - On desktop: hovering reveals ‹ › arrows
  - Clicking an inactive photo navigates to it (it becomes active, others shrink)
  - Swiping left/right on mobile changes the active photo
  - Dots track the current photo
  - Tapping the active photo opens the lightbox at that index
  - Swiping in the lightbox navigates between all photos in the post

- [ ] **Step 6: Commit**

  ```bash
  cd ~/projects/family-news
  git add src/public/js/app.js
  git commit -m "feat: add photo carousel and lightbox"
  ```

---

### Task 5: Deploy

- [ ] **Step 1: Push to GitHub**

  ```bash
  cd ~/projects/family-news && git push origin main
  ```

- [ ] **Step 2: Wait for CI build**

  ```bash
  cd ~/projects/family-news && gh run watch --exit-status
  ```

  Expected: build completes in ~35s.

- [ ] **Step 3: Pull and restart container**

  ```bash
  cd ~/docker && sudo docker compose pull family-news && sudo docker compose up -d family-news
  ```

- [ ] **Step 4: Smoke test on device**

  Open the live site on an Android device or desktop. Confirm:
  - Existing single-photo posts display without square cropping
  - Existing multi-photo posts show the focused carousel
  - Tapping any photo opens the lightbox
  - Selecting multiple photos in the post creation dialog works
