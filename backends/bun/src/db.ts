import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';

export function openDb(path: string, schemaPath: string): Database {
  const db = new Database(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(readFileSync(schemaPath, 'utf8'));
  return db;
}
