const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
require('dotenv').config();

const sqliteFile = process.env.SQLITE_FILE || './data/school_management.db';
const resolved = path.isAbsolute(sqliteFile) ? sqliteFile : path.join(process.cwd(), sqliteFile);
fs.mkdirSync(path.dirname(resolved), { recursive: true });

const db = new Database(resolved);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

module.exports = db;
