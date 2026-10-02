import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { ItemRecord } from "./types";

export const DATA_DIR = process.env.LAF_DATA_DIR
  ? path.resolve(process.env.LAF_DATA_DIR)
  : path.join(__dirname, "..", "data");

export function openDb(dbPath?: string): DatabaseSync {
  const file = dbPath ?? path.join(DATA_DIR, "lostfound.db");
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK (type IN ('lost','found')),
      category TEXT NOT NULL,
      color TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      place TEXT,
      area TEXT,
      date_from TEXT,
      date_to TEXT,
      contact_code TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','returned')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lost_id INTEGER NOT NULL,
      found_id INTEGER NOT NULL,
      reason TEXT NOT NULL,
      lost_snapshot TEXT NOT NULL,
      found_snapshot TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

export function rowToRecord(row: any): ItemRecord {
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    color: row.color,
    tags: JSON.parse(row.tags),
    place: row.place,
    area: row.area,
    dateFrom: row.date_from,
    dateTo: row.date_to,
    contactCode: row.contact_code,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
