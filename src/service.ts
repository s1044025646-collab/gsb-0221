import { DatabaseSync } from "node:sqlite";
import { openDb, rowToRecord } from "./db";
import { explainPair, isCandidate } from "./rules";
import {
  ApiError,
  Explanation,
  ItemRecord,
  RecordInput,
  ReturnEvent,
} from "./types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function now(): string {
  return new Date().toISOString();
}

function validDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export class Service {
  constructor(public db: DatabaseSync = openDb()) {}

  private validateInput(input: any, partial: boolean): RecordInput {
    if (input == null || typeof input !== "object") {
      throw new ApiError("VALIDATION_ERROR", "请求体必须是对象");
    }
    const out: any = {};
    const req = (cond: boolean, msg: string) => {
      if (cond) throw new ApiError("VALIDATION_ERROR", msg);
    };
    if (!partial || input.type !== undefined) {
      req(input.type !== "lost" && input.type !== "found", "type 必须是 lost 或 found");
      out.type = input.type;
    }
    if (!partial || input.category !== undefined) {
      req(typeof input.category !== "string" || input.category.trim() === "", "category 必须是非空字符串");
      out.category = input.category.trim();
    }
    if (!partial || input.contactCode !== undefined) {
      req(
        typeof input.contactCode !== "string" || input.contactCode.trim() === "",
        "contactCode 必须是非空的匿名联系人编号"
      );
      out.contactCode = input.contactCode.trim();
    }
    for (const key of ["color", "place", "area", "description"] as const) {
      if (input[key] !== undefined) {
        req(input[key] !== null && typeof input[key] !== "string", `${key} 必须是字符串或 null`);
        out[key] = input[key] === null ? null : input[key].trim() || null;
      }
    }
    if (input.tags !== undefined) {
      req(!Array.isArray(input.tags) || input.tags.some((t: any) => typeof t !== "string"), "tags 必须是字符串数组");
      out.tags = [...new Set(input.tags.map((t: string) => t.trim()).filter(Boolean))];
    }
    for (const key of ["dateFrom", "dateTo"] as const) {
      if (input[key] !== undefined) {
        req(input[key] !== null && (typeof input[key] !== "string" || !validDate(input[key])), `${key} 必须是 YYYY-MM-DD 格式的有效日期或 null`);
        out[key] = input[key];
      }
    }
    const df = out.dateFrom ?? input.dateFrom;
    const dt = out.dateTo ?? input.dateTo;
    if (df && dt && df > dt) {
      throw new ApiError("VALIDATION_ERROR", "dateFrom 不能晚于 dateTo");
    }
    return out as RecordInput;
  }

  createRecord(input: any): ItemRecord {
    const v = this.validateInput(input, false);
    const ts = now();
    const r = this.db
      .prepare(
        `INSERT INTO records (type, category, color, tags, place, area, date_from, date_to, contact_code, description, status, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,'open',?,?)`
      )
      .run(
        v.type,
        v.category,
        v.color ?? null,
        JSON.stringify(v.tags ?? []),
        v.place ?? null,
        v.area ?? null,
        v.dateFrom ?? null,
        v.dateTo ?? null,
        v.contactCode,
        v.description ?? null,
        ts,
        ts
      );
    return this.getRecord(Number(r.lastInsertRowid));
  }

  getRecord(id: number): ItemRecord {
    const row = this.db.prepare("SELECT * FROM records WHERE id = ?").get(id);
    if (!row) throw new ApiError("NOT_FOUND", `记录 ${id} 不存在`, 404);
    return rowToRecord(row);
  }

  listRecords(filter: { type?: string; status?: string } = {}): ItemRecord[] {
    const cond: string[] = [];
    const args: any[] = [];
    if (filter.type) {
      cond.push("type = ?");
      args.push(filter.type);
    }
    if (filter.status) {
      cond.push("status = ?");
      args.push(filter.status);
    }
    const sql = `SELECT * FROM records ${cond.length ? "WHERE " + cond.join(" AND ") : ""} ORDER BY id`;
    return (this.db.prepare(sql).all(...args) as any[]).map(rowToRecord);
  }

  updateRecord(id: number, input: any): ItemRecord {
    const rec = this.getRecord(id);
    if (rec.status !== "open") {
      throw new ApiError("BAD_STATE", `记录 ${id} 已${rec.status === "closed" ? "关闭" : "归还"}，不能修改`, 409);
    }
    const v: any = this.validateInput(input, true);
    const merged = { ...rec, ...v };
    if (merged.dateFrom && merged.dateTo && merged.dateFrom > merged.dateTo) {
      throw new ApiError("VALIDATION_ERROR", "dateFrom 不能晚于 dateTo");
    }
    const colMap: Record<string, string> = {
      category: "category",
      color: "color",
      tags: "tags",
      place: "place",
      area: "area",
      dateFrom: "date_from",
      dateTo: "date_to",
      contactCode: "contact_code",
      description: "description",
    };
    const sets: string[] = [];
    const args: any[] = [];
    for (const [k, col] of Object.entries(colMap)) {
      if (v[k] !== undefined) {
        sets.push(`${col} = ?`);
        args.push(k === "tags" ? JSON.stringify(v[k]) : v[k]);
      }
    }
    if (sets.length === 0) throw new ApiError("VALIDATION_ERROR", "没有需要更新的字段");
    sets.push("updated_at = ?");
    args.push(now(), id);
    this.db.prepare(`UPDATE records SET ${sets.join(", ")} WHERE id = ?`).run(...args);
    return this.getRecord(id);
  }

  closeRecord(id: number): ItemRecord {
    const rec = this.getRecord(id);
    if (rec.status === "returned") {
      throw new ApiError("BAD_STATE", `记录 ${id} 已归还，不能关闭`, 409);
    }
    if (rec.status === "closed") return rec;
    this.db.prepare("UPDATE records SET status='closed', updated_at=? WHERE id=?").run(now(), id);
    return this.getRecord(id);
  }

  explain(lostId: number, foundId: number): Explanation {
    const lost = this.getRecord(lostId);
    const found = this.getRecord(foundId);
    if (lost.type !== "lost") throw new ApiError("VALIDATION_ERROR", `记录 ${lostId} 不是遗失记录`);
    if (found.type !== "found") throw new ApiError("VALIDATION_ERROR", `记录 ${foundId} 不是拾获记录`);
    return explainPair(lost, found);
  }

  candidatesFor(id: number): { record: ItemRecord; explanation: Explanation }[] {
    const rec = this.getRecord(id);
    const otherType = rec.type === "lost" ? "found" : "lost";
    const others = this.listRecords({ type: otherType, status: "open" });
    const out: { record: ItemRecord; explanation: Explanation }[] = [];
    for (const other of others) {
      const ex =
        rec.type === "lost" ? explainPair(rec, other) : explainPair(other, rec);
      if (isCandidate(ex)) out.push({ record: other, explanation: ex });
    }
    // 稳定次序：总分降序，同分按对方记录 id 升序
    out.sort((a, b) => b.explanation.total - a.explanation.total || a.record.id - b.record.id);
    return out;
  }

  confirmReturn(lostId: number, foundId: number, reason: string, confirm: boolean): ReturnEvent {
    if (confirm !== true) {
      throw new ApiError("VALIDATION_ERROR", "必须显式设置 confirm=true 才能确认归还");
    }
    if (typeof reason !== "string" || reason.trim() === "") {
      throw new ApiError("VALIDATION_ERROR", "必须提供非空的归还原因 reason");
    }
    const lost = this.getRecord(lostId);
    const found = this.getRecord(foundId);
    if (lost.type !== "lost") throw new ApiError("VALIDATION_ERROR", `记录 ${lostId} 不是遗失记录`);
    if (found.type !== "found") throw new ApiError("VALIDATION_ERROR", `记录 ${foundId} 不是拾获记录`);

    this.db.exec("BEGIN IMMEDIATE");
    try {
      // 事务内重新检查状态，双方状态一起提交
      const l = this.getRecord(lostId);
      const f = this.getRecord(foundId);
      if (l.status === "returned") throw new ApiError("CONFLICT", `遗失记录 ${lostId} 已被归还，不能重复归还`, 409);
      if (f.status === "returned") throw new ApiError("CONFLICT", `拾获记录 ${foundId} 已归还，不能再次匹配`, 409);
      if (l.status === "closed") throw new ApiError("CONFLICT", `遗失记录 ${lostId} 已关闭`, 409);
      if (f.status === "closed") throw new ApiError("CONFLICT", `拾获记录 ${foundId} 已关闭`, 409);
      const ts = now();
      const r = this.db
        .prepare(
          `INSERT INTO returns (lost_id, found_id, reason, lost_snapshot, found_snapshot, created_at)
           VALUES (?,?,?,?,?,?)`
        )
        .run(lostId, foundId, reason.trim(), JSON.stringify(l), JSON.stringify(f), ts);
      this.db.prepare("UPDATE records SET status='returned', updated_at=? WHERE id IN (?,?)").run(ts, lostId, foundId);
      this.db.exec("COMMIT");
      return this.getReturn(Number(r.lastInsertRowid));
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  getReturn(id: number): ReturnEvent {
    const row: any = this.db.prepare("SELECT * FROM returns WHERE id = ?").get(id);
    if (!row) throw new ApiError("NOT_FOUND", `归还事件 ${id} 不存在`, 404);
    return {
      id: row.id,
      lostId: row.lost_id,
      foundId: row.found_id,
      reason: row.reason,
      lostSnapshot: JSON.parse(row.lost_snapshot),
      foundSnapshot: JSON.parse(row.found_snapshot),
      createdAt: row.created_at,
    };
  }

  listReturns(): ReturnEvent[] {
    const rows = this.db.prepare("SELECT id FROM returns ORDER BY id").all() as any[];
    return rows.map((r) => this.getReturn(r.id));
  }

  exportReturnsCsv(): string {
    const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    const lines = ["id,lost_id,found_id,reason,lost_category,found_category,created_at"];
    for (const ev of this.listReturns()) {
      lines.push(
        [
          ev.id,
          ev.lostId,
          ev.foundId,
          esc(ev.reason),
          esc(ev.lostSnapshot.category),
          esc(ev.foundSnapshot.category),
          esc(ev.createdAt),
        ].join(",")
      );
    }
    return lines.join("\r\n");
  }
}
