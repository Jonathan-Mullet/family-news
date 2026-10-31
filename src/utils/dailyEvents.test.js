const { test } = require('node:test');
const assert = require('node:assert');
const { postDailyEvents, familyDate } = require('./dailyEvents');

const TZ = 'America/Los_Angeles';

// A tiny fake pool: answers the few queries postDailyEvents makes, records inserts.
function fakeDb({ users = [], events = [], existing = [] } = {}) {
  const posts = [...existing];
  const queries = [];
  return {
    posts,
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (/FROM users WHERE email = 'system@/.test(sql)) return [[{ id: 99 }]];
      if (/FROM users WHERE active = 1/.test(sql)) {
        const [m, d] = params;
        return [users.filter((u) => u.month === m && u.day === d).map((u) => ({ id: u.id, name: u.name, birthday: u.birthday }))];
      }
      if (/FROM events WHERE/.test(sql)) {
        const [m, d] = params;
        return [events.filter((e) => e.month === m && e.day === d)];
      }
      if (/SELECT 1 FROM posts/.test(sql)) return [posts.some((p) => p.content === params[1]) ? [{ 1: 1 }] : []];
      if (/INSERT INTO posts/.test(sql)) { posts.push({ user_id: params[0], content: params[1] }); return [{ insertId: posts.length }]; }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

test('familyDate is the date where the family is, not UTC', () => {
  // 9 pm Pacific on Oct 30 is already Oct 31 in UTC.
  assert.deepStrictEqual(familyDate(new Date('2026-10-31T04:00:00Z'), TZ), { y: 2026, m: 10, d: 30, hour: 21 });
});

test('posts a birthday with the right age, once', async () => {
  const db = fakeDb({ users: [{ id: 1, name: 'Emma', month: 12, day: 17, birthday: new Date('1972-12-17T00:00:00Z') }] });
  const now = new Date('2026-12-17T16:00:00Z'); // 8 am Pacific
  const r1 = await postDailyEvents(db, { now, tz: TZ });
  assert.deepStrictEqual(r1.posted, ["🎂 Today is Emma's birthday — turning 54! 🎉"]);
  const r2 = await postDailyEvents(db, { now, tz: TZ });
  assert.deepStrictEqual(r2.posted, [], 'running again (catch-up, retry) does not double-post');
  assert.equal(db.posts.length, 1);
});

test('a late catch-up uses the family date even when UTC has rolled over', async () => {
  const db = fakeDb({ users: [{ id: 1, name: 'Martin', month: 2, day: 9, birthday: new Date('1963-02-09T00:00:00Z') }] });
  // 9 pm Pacific on Feb 9 = Feb 10 in UTC: still Martin's birthday at home.
  const r = await postDailyEvents(db, { now: new Date('2026-02-10T05:00:00Z'), tz: TZ });
  assert.deepStrictEqual(r.posted, ["🎂 Today is Martin's birthday — turning 63! 🎉"]);
});

test('a post that was already made (even if later deleted) is not made again', async () => {
  const db = fakeDb({
    users: [{ id: 1, name: 'Lucy', month: 3, day: 21, birthday: new Date('1998-03-21T00:00:00Z') }],
    existing: [{ user_id: 99, content: "🎂 Today is Lucy's birthday — turning 28! 🎉", deleted: true }],
  });
  const r = await postDailyEvents(db, { now: new Date('2026-03-21T15:00:00Z'), tz: TZ });
  assert.deepStrictEqual(r.posted, []);
});

test('Feb 29 birthdays are celebrated on Feb 28 in other years, on Feb 29 in leap years', async () => {
  const leapling = { id: 1, name: 'Ari', month: 2, day: 29, birthday: new Date('2004-02-29T00:00:00Z') };
  const db = fakeDb({ users: [leapling] });
  const r = await postDailyEvents(db, { now: new Date('2027-02-28T16:00:00Z'), tz: TZ });
  assert.equal(r.posted.length, 1);
  const leap = fakeDb({ users: [leapling] });
  assert.equal((await postDailyEvents(leap, { now: new Date('2028-02-28T16:00:00Z'), tz: TZ })).posted.length, 0);
  assert.equal((await postDailyEvents(leap, { now: new Date('2028-02-29T16:00:00Z'), tz: TZ })).posted.length, 1);
});

test('events table: anniversaries and birthdays without accounts, with notes', async () => {
  const db = fakeDb({ events: [{ month: 6, day: 1, type: 'anniversary', name: 'Paul & Lucy', note: 'Five years!' }] });
  const r = await postDailyEvents(db, { now: new Date('2026-06-01T15:00:00Z'), tz: TZ });
  assert.deepStrictEqual(r.posted, ['💍 Happy anniversary, Paul & Lucy! 🎊\nFive years!']);
});

test('no system account: nothing is posted, and it says why', async () => {
  const db = fakeDb();
  db.query = async (sql) => (/system@/.test(sql) ? [[]] : [[]]);
  const r = await postDailyEvents(db, { now: new Date('2026-06-01T15:00:00Z'), tz: TZ });
  assert.equal(r.skippedReason, 'no system user');
});
