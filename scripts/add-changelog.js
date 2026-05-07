// Usage: node scripts/add-changelog.js --title "..." --body "..."
// Runs on the Pi directly (outside Docker), loading env from the Docker .env file.
require('dotenv').config({ path: '/home/jmull/docker/.env' });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : null;
}

const title = getArg('title');
const body = getArg('body');
if (!title || !body) {
  console.error('Usage: node scripts/add-changelog.js --title "..." --body "..."');
  process.exit(1);
}

(async () => {
  const pool = await mysql.createPool({
    host: '127.0.0.1',
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: 'family_news',
  });

  await pool.query('INSERT INTO changelog (title, body) VALUES (?, ?)', [title, body]);

  const [[row]] = await pool.query('SELECT MAX(published_at) AS latestAt FROM changelog');
  const latestAt = row.latestAt ? new Date(row.latestAt).toISOString() : null;
  const sidecarPath = path.join(__dirname, '../src/data/changelog-meta.json');
  fs.writeFileSync(sidecarPath, JSON.stringify({ latestAt }, null, 2) + '\n');

  console.log('✓ Entry published');
  await pool.end();
})();
