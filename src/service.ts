import { DatabaseSync } from "node:sqlite";
import {
  getRecord,
  insertRecord,
  insertReturn,
  listRecords,
  listReturns,
  newId,
  setStatus,
  updateRecord,
} from "./db.js";
import { generateCandidates, scorePair } from "./matching.js";
import { AppError, type Candidate, type ItemRecord, type RecordInput, type ReturnEvent } from "./types.js";
import { validateRecordInput } from "./validation.js";

export class LostFoundService {
  constructor(private readonly db: DatabaseSync) {}

  create(input: RecordInput): ItemRecord {
    validateRecordInput({ ...input });
    const now = new Date().toISOString();
    return insertRecord(this.db, input, newId(input.kind), now);
  }

  get(id: string): ItemRecord {
    const r = getRecord(this.db, id);
    if (!r) throw new AppError("NOT_FOUND", `记录不存在：${id}`, 404);
    return r;
  }

  list(kind?: "lost" | "found"): ItemRecord[] {
    return listRecords(this.db, kind);
  }

  update(id: string, patch: Partial<RecordInput>): ItemRecord {
    this.get(id);
    try {
      return updateRecord(this.db, id, patch, new Date().toISOString());
    } catch (e) {
      throw mapDbError(e);
    }
  }

  close(id: string, reason: string): ItemRecord {
    const rec = this.get(id);
    if (rec.status === "returned") {
      throw new AppError("ALREADY_RETURNED", `记录 ${id} 已归还，不能关闭/修改`);
    }
    if (rec.status === "closed") {
      throw new AppError("ALREADY_CLOSED", `记录 ${id} 已处于关闭状态`);
    }
    setStatus(this.db, id, "closed", new Date().toISOString());
    void reason;
    return this.get(id);
  }

  candidates(opts: { lostId?: string; foundId?: string; includeClosed?: boolean } = {}): Candidate[] {
    if (opts.lostId) this.get(opts.lostId);
    if (opts.foundId) this.get(opts.foundId);
    return generateCandidates(this.list(), opts);
  }

  explain(lostId: string, foundId: string): Candidate {
    const lost = this.get(lostId);
    const found = this.get(foundId);
    if (lost.kind !== "lost") throw new AppError("INVALID_PAIR", `${lostId} 不是遗失记录`);
    if (found.kind !== "found") throw new AppError("INVALID_PAIR", `${foundId} 不是拾获记录`);
    if (lost.category !== found.category) {
      throw new AppError(
        "CATEGORY_CONFLICT",
        `类别明显冲突（${lost.category} vs ${found.category}），按规则不生成候选/解释`,
        422,
      );
    }
    return scorePair(lost, found);
  }

  /**
   * 人工确认归还。显式传入一对记录 + 操作原因；
   * 双方状态与归还事件在同一事务内提交，任一步失败则全部回滚（核对失败双方状态不变）。
   */
  confirmReturn(lostId: string, foundId: string, reason: string, operator: string, confirm: boolean): ReturnEvent {
    if (confirm !== true) {
      throw new AppError(
        "CONFIRM_REQUIRED",
        "候选只是建议；必须在请求中显式传 confirm:true 才能确认归还",
        409,
      );
    }
    const lost = this.get(lostId);
    const found = this.get(foundId);
    if (lost.kind !== "lost" || found.kind !== "found") {
      throw new AppError("INVALID_PAIR", "必须指定一条遗失记录和一条拾获记录");
    }
    if (lost.category !== found.category) {
      throw new AppError("CATEGORY_CONFLICT", "类别明显冲突，不能确认归还", 422);
    }
    if (lost.status === "returned" || found.status === "returned") {
      throw new AppError(
        "ALREADY_RETURNED",
        `记录已归还（遗失状态=${lost.status}，拾获状态=${found.status}），不能重复归还`,
        409,
      );
    }

    const score = scorePair(lost, found);
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const freshLost = this.get(lostId);
      const freshFound = this.get(foundId);
      if (freshLost.status === "returned" || freshFound.status === "returned") {
        throw new AppError("RACE_CONFLICT", "并发竞争：其中一条记录刚刚已被归还，请刷新候选后重试", 409);
      }
      const ev = insertReturn(this.db, {
        lostId,
        foundId,
        reason,
        operator,
        scoreAtReturn: score,
        lostSnapshot: freshLost,
        foundSnapshot: freshFound,
        createdAt: now,
      });
      setStatus(this.db, lostId, "returned", now);
      setStatus(this.db, foundId, "returned", now);
      this.db.exec("COMMIT");
      return ev;
    } catch (e) {
      this.db.exec("ROLLBACK");
      if (e instanceof AppError) throw e;
      throw mapDbError(e);
    }
  }

  returns(): ReturnEvent[] {
    return listReturns(this.db);
  }
}

function mapDbError(e: unknown): Error {
  if (e instanceof AppError) return e;
  const code = (e as { code?: string } | null)?.code;
  const msg = (e as Error)?.message ?? String(e);
  if (code === "SQLITE_CONSTRAINT_UNIQUE") {
    return new AppError("RACE_CONFLICT", "唯一性冲突：同一遗失或拾获记录不能重复归还", 409);
  }
  if (code === "ALREADY_RETURNED") {
    return new AppError("ALREADY_RETURNED", msg, 409);
  }
  if (code === "NOT_FOUND") {
    return new AppError("NOT_FOUND", msg, 404);
  }
  return e instanceof Error ? e : new Error(msg);
}
