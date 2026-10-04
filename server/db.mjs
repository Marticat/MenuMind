import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tagCatalog } from './tags.mjs';

export const defaultSettings = {
  restraint: 88,
  sensory: 64,
  strictness: 100,
  limits: { yandex: 250, wolt: 180, website: 450, print: 300 },
  samples: [],
};
export function defaultProfile(restaurantName) {
  return {
    restaurantName,
    cuisine: '',
    brandInstructions: '',
    language: 'ru',
    tone: 'editorial',
    preferredTags: [],
    avoidedTags: [],
    settings: structuredClone(defaultSettings),
  };
}
export function openDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
  `);
  if (!db.prepare('SELECT 1 FROM migrations WHERE version = 1').get()) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE profiles (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
        CREATE INDEX sessions_user ON sessions(user_id);
        CREATE TABLE api_keys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, prefix TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, last_used_at TEXT);
        CREATE TABLE recipes (id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (user_id, id));
        CREATE TABLE tags (id TEXT PRIMARY KEY, label TEXT NOT NULL, kind TEXT NOT NULL);
        CREATE TABLE recipe_tags (user_id TEXT NOT NULL, recipe_id TEXT NOT NULL, tag_id TEXT NOT NULL REFERENCES tags(id), evidence TEXT NOT NULL, PRIMARY KEY(user_id, recipe_id, tag_id), FOREIGN KEY(user_id, recipe_id) REFERENCES recipes(user_id, id) ON DELETE CASCADE);
        CREATE TABLE generations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, recipe_id TEXT, data TEXT NOT NULL, feedback INTEGER NOT NULL DEFAULT 0 CHECK(feedback IN (-1,0,1)), created_at TEXT NOT NULL);
        CREATE INDEX generations_user ON generations(user_id, created_at DESC);
        CREATE TABLE idempotency (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL, request_hash TEXT NOT NULL, generation_id TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, PRIMARY KEY(user_id, key));
      `);
      db.prepare('INSERT INTO migrations VALUES (1, ?)').run(new Date().toISOString());
    })();
  }
  const insertTag = db.prepare('INSERT OR REPLACE INTO tags VALUES (?, ?, ?)');
  db.transaction(() => tagCatalog.forEach((tag) => insertTag.run(tag.id, tag.label, tag.kind)))();
  return db;
}
