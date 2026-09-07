const fs = require('fs');
const path = require('path');
const db = require('./connection');

const migrationsDir = path.join(__dirname, 'migrations');

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
`);

const applied = new Set(db.prepare('SELECT name FROM schema_migrations').all().map(r => r.name));
const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

let ran = 0;
for (const file of files) {
  if (applied.has(file)) continue;
  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  const runMigration = db.transaction(() => {
    db.exec(sql);
    db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
  });
  runMigration();
  console.log(`Applied migration: ${file}`);
  ran += 1;
}

if (ran === 0) {
  console.log('No pending migrations. Database is up to date.');
} else {
  console.log(`Applied ${ran} migration(s).`);
}
