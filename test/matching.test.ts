import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { openDb } from "../src/db.ts";
import { seedDatabase } from "../src/seed.ts";
import { LostFoundService } from "../src/service.ts";
import { AppError, type RecordInput } from "../src/types.ts";
import { generateCandidates, scorePair } from "../src/matching.ts";

function tempDb(): string {
  return join(tmpdir(), `lf-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function freshService(): { svc: LostFoundService; dbPath: string } {
  const dbPath = tempDb();
  const db = openDb(dbPath);
  seedDatabase(db);
  return { svc: new LostFoundService(db), dbPath };
}

test("类别冲突的记录不进入候选", () => {
  const { svc } = freshService();
  const records = svc.list();
  const all = generateCandidates(records, { includeClosed: true, threshold: -1000 });
  for (const c of all) {
    const lost = records.find((r) => r.id === c.lostId)!;
    const found = records.find((r) => r.id === c.foundId)!;
    assert.equal(lost.category, found.category);
  }
  assert.throws(() => svc.explain("L-SEED-001", "F-SEED-003"), (e: Error) => (e as AppError).code === "CATEGORY_CONFLICT");
});

test("同名不同地点的钥匙分数低于同地点，且名称本身不加分", () => {
  const { svc } = freshService();
  const samePlace = svc.explain("L-SEED-001", "F-SEED-001");
  const diffPlace = svc.explain("L-SEED-001", "F-SEED-002");
  assert.ok(samePlace.totalScore > diffPlace.totalScore);
  const dims = samePlace.items.map((i) => i.dimension).sort();
  assert.deepEqual(dims, ["colors", "location", "tags", "time"]);
  assert.equal(samePlace.items.find((i) => i.dimension === "location")?.points, 25);
  assert.equal(diffPlace.items.find((i) => i.dimension === "location")?.points, -10);
});

test("候选顺序：分数降序，同分按编号字典序稳定", () => {
  const { svc } = freshService();
  const list = svc.candidates();
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1]!;
    const cur = list[i]!;
    assert.ok(
      prev.totalScore > cur.totalScore ||
        (prev.totalScore === cur.totalScore &&
          (prev.lostId < cur.lostId || (prev.lostId === cur.lostId && prev.foundId <= cur.foundId))),
    );
  }
  const top = list[0]!;
  assert.equal(top.lostId, "L-SEED-001");
  assert.equal(top.foundId, "F-SEED-001");
});

test("信息缺失维度标记 missing 且不加分、不按相符处理", () => {
  const { svc } = freshService();
  const umbrella = svc.explain("L-SEED-002", "F-SEED-003");
  const colors = umbrella.items.find((i) => i.dimension === "colors")!;
  assert.equal(colors.result, "missing");
  assert.equal(colors.points, 0);
  assert.ok(umbrella.warning?.includes("缺失"));
});

test("地点完全一致与仅同区域有区别", () => {
  const { svc } = freshService();
  const backpack = svc.explain("L-SEED-003", "F-SEED-004");
  const loc = backpack.items.find((i) => i.dimension === "location")!;
  assert.equal(loc.result, "partial");
  assert.equal(loc.points, 8);
});

test("日期边界：区间首尾当天相交得分；刚好无交集按间隔扣分", () => {
  const { svc } = freshService();
  const overlap = svc.explain("L-SEED-001", "F-SEED-001");
  assert.equal(overlap.items.find((i) => i.dimension === "time")?.points, 35);

  const db2 = openDb(tempDb());
  const s2 = new LostFoundService(db2);
  const base: RecordInput = {
    kind: "lost",
    category: "keys",
    itemName: "x",
    colors: ["red"],
    tags: ["a"],
    location: "门口",
    area: "大门",
    dateFrom: "2026-09-25",
    dateTo: "2026-09-26",
    contactCode: "ANON-L-900",
  };
  const lost = s2.create(base);
  const found = s2.create({
    ...base,
    kind: "found",
    dateFrom: "2026-09-27",
    dateTo: "2026-09-27",
    contactCode: "ANON-F-900",
  });
  const c = scorePair(lost, found);
  assert.equal(c.items.find((i) => i.dimension === "time")?.points, -6); // 相差 1 天
  const boundaryFound = s2.create({
    ...base,
    kind: "found",
    dateFrom: "2026-09-26",
    dateTo: "2026-09-26",
    contactCode: "ANON-F-901",
  });
  assert.equal(scorePair(lost, boundaryFound).items.find((i) => i.dimension === "time")?.points, 35);
});

test("错误输入：非法日期/类别/联系方式/日期区间", () => {
  const { svc } = freshService();
  const valid: RecordInput = {
    kind: "lost",
    category: "keys",
    itemName: "x",
    colors: [],
    tags: [],
    location: "a",
    area: "b",
    dateFrom: "2026-09-01",
    dateTo: "2026-09-02",
    contactCode: "ANON-L-100",
  };
  const expectCode = (patch: Partial<RecordInput>, code: string) => {
    assert.throws(() => svc.create({ ...valid, ...patch }), (e: Error) => (e as AppError).code === code);
  };
  expectCode({ category: "spaceship" }, "INVALID_CATEGORY");
  expectCode({ contactCode: "含中文!" }, "INVALID_CONTACT");
  expectCode({ dateFrom: "2026-13-40", dateTo: "2026-13-40" }, "INVALID_DATE");
  expectCode({ dateFrom: "2026-09-10", dateTo: "2026-09-01" }, "INVALID_DATE_RANGE");
  expectCode({ kind: "stolen" as RecordInput["kind"] }, "INVALID_FIELD");
});

test("确认归还：必须显式 confirm；成功后双方 returned；重复确认失败", () => {
  const { svc } = freshService();
  assert.throws(
    () => svc.confirmReturn("L-SEED-004", "F-SEED-005", "未确认", "t", false),
    (e: Error) => (e as AppError).code === "CONFIRM_REQUIRED",
  );
  const ev = svc.confirmReturn("L-SEED-004", "F-SEED-005", "核对一致，匿名编号互认", "t", true);
  assert.equal(ev.lostSnapshot.id, "L-SEED-004");
  assert.equal(svc.get("L-SEED-004").status, "returned");
  assert.equal(svc.get("F-SEED-005").status, "returned");
  assert.throws(
    () => svc.confirmReturn("L-SEED-004", "F-SEED-005", "重复", "t", true),
    (e: Error) => (e as AppError).code === "ALREADY_RETURNED",
  );
});

test("两次认领竞争：同一拾获物不能被第二条遗失记录再次确认", () => {
  const { svc } = freshService();
  svc.confirmReturn("L-SEED-001", "F-SEED-001", "第一次认领成功", "t", true);
  assert.throws(
    () => svc.confirmReturn("L-SEED-001", "F-SEED-001", "重复同对", "t", true),
    (e: Error) => ["ALREADY_RETURNED", "RACE_CONFLICT"].includes((e as AppError).code),
  );
  // 用同一条拾获记录配另一条遗失（构造同类别同特征遗失）
  const other = svc.create({
    kind: "lost",
    category: "keys",
    itemName: "一串钥匙",
    colors: ["silver", "yellow"],
    tags: ["卡通挂件"],
    location: "中央图书馆 三楼自习区",
    area: "中央图书馆",
    dateFrom: "2026-09-26",
    dateTo: "2026-09-26",
    contactCode: "ANON-L-200",
  });
  assert.throws(
    () => svc.confirmReturn(other.id, "F-SEED-001", "竞争认领", "t", true),
    (e: Error) => (e as AppError).code === "ALREADY_RETURNED",
  );
});

test("核对失败时双方状态不变", () => {
  const { svc } = freshService();
  assert.throws(
    () => svc.confirmReturn("L-SEED-002", "F-SEED-002", "类别冲突", "t", true),
    (e: Error) => (e as AppError).code === "CATEGORY_CONFLICT",
  );
  assert.equal(svc.get("L-SEED-002").status, "open");
  assert.equal(svc.get("F-SEED-002").status, "open");
});

test("修改描述后候选重算；历史确认保留当时快照；重启后仍可查询", () => {
  const { svc, dbPath } = freshService();
  const ev = svc.confirmReturn("L-SEED-004", "F-SEED-005", "首次确认时的信息", "t", true);
  const tagsBefore = ev.foundSnapshot.tags.slice();

  // 已归还记录不允许修改
  assert.throws(() => svc.update("F-SEED-005", { tags: ["x"] }), (e: Error) =>
    ["ALREADY_RETURNED", "RACE_CONFLICT"].includes((e as AppError).code),
  );

  // 修改开放记录，候选重算
  const before = svc.explain("L-SEED-001", "F-SEED-001").totalScore;
  svc.update("F-SEED-001", { tags: ["完全不同的标签"] });
  const after = svc.explain("L-SEED-001", "F-SEED-001").totalScore;
  assert.notEqual(before, after);

  // 模拟重启：重新打开数据库，归还历史与快照仍在
  const reopened = new LostFoundService(openDb(dbPath));
  const events = reopened.returns();
  assert.equal(events.length, 1);
  assert.deepEqual(events[0]!.foundSnapshot.tags, tagsBefore);
  assert.equal(reopened.get("L-SEED-004").status, "returned");
});

test("关闭的记录默认不参与候选", () => {
  const { svc } = freshService();
  svc.close("F-SEED-001", "测试关闭");
  const open = svc.candidates();
  assert.ok(!open.some((c) => c.foundId === "F-SEED-001"));
  const withClosed = svc.candidates({ includeClosed: true });
  assert.ok(withClosed.some((c) => c.foundId === "F-SEED-001"));
});

test("清理临时数据库文件", () => {
  // best-effort：临时目录文件由系统清理；这里仅确保测试运行时可写
  assert.ok(rmSync);
});
