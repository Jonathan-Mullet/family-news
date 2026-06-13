// Pure coalescing logic for reaction push notifications. No timers/IO here —
// the service layer drives tick()/flush with real time. `key` groups by
// (recipient, targetType, targetId).
function summarizeReactors(reactors, targetType) {
  // De-dup by name, latest emoji wins, preserving first-seen order.
  const order = [];
  const byName = new Map();
  for (const r of reactors) {
    if (!byName.has(r.name)) order.push(r.name);
    byName.set(r.name, r.emoji);
  }
  const names = order;
  const first = names[0];
  if (names.length === 1) return `${first} reacted ${byName.get(first)} to your ${targetType}`;
  return `${first} + ${names.length - 1} others reacted to your ${targetType}`;
}

class ReactionBuffer {
  constructor({ quietMs, capMs, now, onFlush }) {
    this.quietMs = quietMs; this.capMs = capMs; this.now = now; this.onFlush = onFlush;
    this.groups = new Map(); // key -> { items:[], firstAt, lastAt }
  }
  add(key, item) {
    const t = this.now();
    let g = this.groups.get(key);
    if (!g) { g = { items: [], firstAt: t, lastAt: t }; this.groups.set(key, g); }
    g.items.push(item); g.lastAt = t;
  }
  drop(key, name) {
    const g = this.groups.get(key);
    if (!g) return;
    g.items = g.items.filter(i => i.name !== name);
    if (!g.items.length) this.groups.delete(key);
  }
  tick() {
    const t = this.now();
    for (const [key, g] of [...this.groups]) {
      const quiet = (t - g.lastAt) >= this.quietMs;
      const capped = (t - g.firstAt) >= this.capMs;
      if (quiet || capped) {
        this.groups.delete(key);
        if (g.items.length) this.onFlush(g.items, key);
      }
    }
  }
}
module.exports = { summarizeReactors, ReactionBuffer };
