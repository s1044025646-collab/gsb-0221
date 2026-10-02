import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Candidate, ItemRecord, RecordInput, ReturnEvent } from "./types.js";

let counter = 0;

export function newId(kind: "lost" | "found"): string {
  counter = (counter + 1) % 1_000_000;
  const rand = Math.random().toString(36).slice(2, 6);
  return `${kind === "lost" ? "L" : "F"}${Date.now().toString(36).toUpperCase()}${counter.toString(36).toUpperCase().padStart(3, "0")}${rand.toUpperCase()}`;
}

export function openDb(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('lost','found')),
      category TEXT NOT NULL,
      item_name TEXT NOT NULL,
      colors TEXT NOT NULL,
      tags TEXT NOT NULL,
      location TEXT NOT NULL,
      area TEXT NOT NULL,
      date_from TEXT NOT NULL,
      date_to TEXT NOT NULL,
      contact_code TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','returned')),
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lost_id TEXT NOT NULL REFERENCES records(id),
      found_id TEXT NOT NULL REFERENCES records(id),
      reason TEXT NOT NULL,
      operator TEXT NOT NULL,
      score_json TEXT,
      lost_snapshot TEXT NOT NULL,
      found_snapshot TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (lost_id),
      UNIQUE (found_id)
    );
  `);
  return db;
}

interface RecordRow {
  id: string;
  kind: "lost" | "found";
  category: string;
  item_name: string;
  colors: string;
  tags: string;
  location: string;
  area: string;
  date_from: string;
  date_to: string;
  contact_code: string;
  description: string;
  status: "open" | "closed" | "returned";
  version: number;
  created_at: string;
  updated_at: string;
}

export function rowToRecord(row: RecordRow): ItemRecord {
  return {
    id: row.id,
    kind: row.kind,
    category: row.category,
    itemName: row.item_name,
    colors: JSON.parse(row.colors) as string[],
    tags: JSON.parse(row.tags) as string[],
    location: row.location,
    area: row.area,
    dateFrom: row.date_from,
    dateTo: row.date_to,
    contactCode: row.contact_code,
    description: row.description,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function insertRecord(db: DatabaseSync, input: RecordInput, id: string, nowIso: string): ItemRecord {
  db.prepare(`
    INSERT INTO records
      (id, kind, category, item_name, colors, tags, location, area, date_from, date_to,
       contact_code, description, status, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 1, ?, ?)
  `).run(
    id, input.kind, input.category, input.itemName,
    JSON.stringify(input.colors), JSON.stringify(input.tags),
    input.location, input.area, input.dateFrom, input.dateTo,
    input.contactCode, input.description ?? "", nowIso, nowIso,
  );
  return getRecordOrThrow(db, id);
}

export function getRecord(db: DatabaseSync, id: string): ItemRecord | null {
  const row = db.prepare("SELECT * FROM records WHERE id = ?").get(id) as unknown as RecordRow | undefined;
  return row ? rowToRecord(row) : null;
}

export function getRecordOrThrow(db: DatabaseSync, id: string): ItemRecord {
  const rec = getRecord(db, id);
  if (!rec) {
    const err = new Error(`记录不存在：${id}`) as Error & { code?: string };
    err.code = "NOT_FOUND";
    throw err;
  }
  return rec;
}

export function listRecords(db: DatabaseSync, kind?: "lost" | "found"): ItemRecord[] {
  const rows = kind
    ? (db.prepare("SELECT * FROM records WHERE kind = ? ORDER BY created_at, id").all(kind) as unknown as RecordRow[])
    : (db.prepare("SELECT * FROM records ORDER BY created_at, id").all() as unknown as RecordRow[]);
  return rows.map(rowToRecord);
}

export function updateRecord(db: DatabaseSync, id: string, patch: Partial<RecordInput>, nowIso: string): ItemRecord {
  const current = getRecordOrThrow(db, id);
  if (current.status === "returned") {
    const err = new Error("已归还的记录不可修改（历史信息保留）") as Error & { code?: string };
    err.code = "ALREADY_RETURNED";
    throw err;
  }
  const merged: RecordInput = {
    kind: current.kind,
    category: patch.category ?? current.category,
    itemName: patch.itemName ?? current.itemName,
    colors: patch.colors ?? current.colors,
    tags: patch.tags ?? current.tags,
    location: patch.location ?? current.location,
    area: patch.area ?? current.area,
    dateFrom: patch.dateFrom ?? current.dateFrom,
    dateTo: patch.dateTo ?? current.dateTo,
    contactCode: patch.contactCode ?? current.contactCode,
    description: patch.description !== undefined ? patch.description : current.description,
  };
  db.prepare(`
    UPDATE records SET
      category = ?, item_name = ?, colors = ?, tags = ?, location = ?, area = ?,
      date_from = ?, date_to = ?, contact_code = ?, description = ?,
      version = version + 1, updated_at = ?
    WHERE id = ?
  `).run(
    merged.category, merged.itemName, JSON.stringify(merged.colors), JSON.stringify(merged.tags),
    merged.location, merged.area, merged.dateFrom, merged.dateTo, merged.contactCode,
    merged.description ?? "", nowIso, id,
  );
  return getRecordOrThrow(db, id);
}

export function setStatus(db: DatabaseSync, id: string, status: ItemRecord["status"], nowIso: string): void {
  db.prepare("UPDATE records SET status = ?, version = version + 1, updated_at = ? WHERE id = ?")
    .run(status, nowIso, id);
}

interface ReturnRow {
  id: number;
  lost_id: string;
  found_id: string;
  reason: string;
  operator: string;
  score_json: string | null;
  lost_snapshot: string;
  found_snapshot: string;
  created_at: string;
}

function rowToReturn(row: ReturnRow): ReturnEvent {
  return {
    id: row.id,
    lostId: row.lost_id,
    foundId: row.found_id,
    reason: row.reason,
    operator: row.operator,
    scoreAtReturn: row.score_json ? (JSON.parse(row.score_json) as Candidate) : null,
    lostSnapshot: JSON.parse(row.lost_snapshot) as ItemRecord,
    foundSnapshot: JSON.parse(row.found_snapshot) as ItemRecord,
    createdAt: row.created_at,
  };
}

export function insertReturn(
  db: DatabaseSync,
  ev: Omit<ReturnEvent, "id">,
): ReturnEvent {
  const info = db.prepare(`
    INSERT INTO returns
      (lost_id, found_id, reason, operator, score_json, lost_snapshot, found_snapshot, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ev.lostId, ev.foundId, ev.reason, ev.operator,
    ev.scoreAtReturn ? JSON.stringify(ev.scoreAtReturn) : null,
    JSON.stringify(ev.lostSnapshot), JSON.stringify(ev.foundSnapshot), ev.createdAt,
  );
  const row = db.prepare("SELECT * FROM returns WHERE id = ?").get(Number(info.lastInsertRowid)) as unknown as ReturnRow;
  return rowToReturn(row);
}

export function listReturns(db: DatabaseSync): ReturnEvent[] {
  const rows = db.prepare("SELECT * FROM returns ORDER BY id").all() as unknown as ReturnRow[];
  return rows.map(rowToReturn);
}
