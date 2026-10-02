import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { openDb } from "../src/db";
import { Service } from "../src/service";
import { explainPair, isCandidate } from "../src/rules";
import { ApiError, ItemRecord } from "../src/types";

function makeService(): { s: Service; dir: string; dbFile: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "laf-test-"));
  const dbFile = path.join(dir, "test.db");
  return { s: new Service(openDb(dbFile)), dir, dbFile };
}

function lost(s: Service, over: any = {}): ItemRecord {
  return s.createRecord({
    type: "lost", category: "雨伞", color: "黑", tags: ["长柄"],
    place: "图书馆二楼", area: "图书馆", dateFrom: "2026-09-10", dateTo: "2026-09-10",
    contactCode: "L-1", ...over,
  });
}

function found(s: Service, over: any = {}): ItemRecord {
  return s.createRecord({
    type: "found", category: "雨伞", color: "黑", tags: ["长柄"],
    place: "图书馆二楼", area: "图书馆", dateFrom: "2026-09-10",
    contactCode: "F-1", ...over,
  });
}

test("完全相符的记录得分最高且逐项解释", () => {
  const { s } = makeService();
  const l = lost(s);
  const f = found(s);
  const ex = s.explain(l.id, f.id);
  assert.equal(ex.eligible, true);
  assert.equal(ex.total, 30 + 20 + 15 + 5);
  assert.ok(ex.items.every((i) => i.detail.length > 0));
});

test("类别明显冲突不进入候选", () => {
  const { s } = makeService();
  const l = lost(s, { category: "手机" });
  const f = found(s);
  const ex = s.explain(l.id, f.id);
  assert.equal(ex.eligible, false);
  assert.equal(isCandidate(ex), false);
  assert.equal(s.candidatesFor(l.id).length, 0);
});

test("地点完全一致优先于仅同区域，同分按 id 稳定排序", () => {
  const { s } = makeService();
  const l = lost(s);
  const fArea = found(s, { place: "图书馆一楼", color: null, tags: [] });
  const fExact = found(s, { color: null, tags: [] });
  const fExact2 = found(s, { color: null, tags: [] });
  const cands = s.candidatesFor(l.id);
  assert.deepEqual(cands.map((c) => c.record.id), [fExact.id, fExact2.id, fArea.id]);
  assert.equal(cands[0].explanation.total, 50);
  assert.equal(cands[2].explanation.total, 35);
});

test("缺少信息不当作相符，仅注明信息缺失", () => {
  const { s } = makeService();
  const l = lost(s, { color: null, dateFrom: null, dateTo: null, tags: [] });
  const f = found(s);
  const ex = s.explain(l.id, f.id);
  const colorItem = ex.items.find((i) => i.rule === "颜色")!;
  const dateItem = ex.items.find((i) => i.rule === "日期")!;
  assert.equal(colorItem.points, 0);
  assert.match(colorItem.detail, /缺失/);
  assert.equal(dateItem.points, 0);
  assert.match(dateItem.detail, /缺失/);
});

test("日期边界：区间端点相接算重叠，间隔2天以内加分，3天不加", () => {
  const { s } = makeService();
  const base = { category: "钥匙", color: null, tags: [], place: null, area: null, contactCode: "X" };
  const l = s.createRecord({ type: "lost", ...base, dateFrom: "2026-09-10", dateTo: "2026-09-12" });
  const touch = s.createRecord({ type: "found", ...base, dateFrom: "2026-09-12", dateTo: "2026-09-12" });
  const gap2 = s.createRecord({ type: "found", ...base, dateFrom: "2026-09-14", dateTo: "2026-09-14" });
  const gap3 = s.createRecord({ type: "found", ...base, dateFrom: "2026-09-15", dateTo: "2026-09-15" });
  const pts = (f: ItemRecord) => explainPair(l, f).items.find((i) => i.rule === "日期")!.points;
  assert.equal(pts(touch), 20);
  assert.equal(pts(gap2), 10);
  assert.equal(pts(gap3), 0);
});

test("颜色同色系加分、明显不同扣分", () => {
  const { s } = makeService();
  const l = lost(s, { color: "藏青" });
  const same = found(s, { color: "蓝" });
  const diff = found(s, { color: "红" });
  const pts = (f: ItemRecord) => explainPair(l, f).items.find((i) => i.rule === "颜色")!.points;
  assert.equal(pts(same), 8);
  assert.equal(pts(diff), -10);
});

test("确认归还需要显式 confirm 与原因，成功后双方状态为 returned", () => {
  const { s } = makeService();
  const l = lost(s);
  const f = found(s);
  assert.throws(() => s.confirmReturn(l.id, f.id, "核对无误", false), ApiError);
  assert.throws(() => s.confirmReturn(l.id, f.id, "", true), ApiError);
  const ev = s.confirmReturn(l.id, f.id, "现场核对特征一致", true);
  assert.equal(ev.lostSnapshot.id, l.id);
  assert.equal(ev.reason, "现场核对特征一致");
  assert.equal(s.getRecord(l.id).status, "returned");
  assert.equal(s.getRecord(f.id).status, "returned");
});

test("重复确认与两次认领竞争返回 CONFLICT，失败后状态不变", () => {
  const { s } = makeService();
  const l1 = lost(s);
  const l2 = lost(s, { contactCode: "L-2" });
  const f = found(s);
  s.confirmReturn(l1.id, f.id, "第一次确认", true);
  assert.throws(() => s.confirmReturn(l2.id, f.id, "竞争认领", true), (e: ApiError) => e.code === "CONFLICT");
  const f2 = found(s, { contactCode: "F-2" });
  assert.throws(() => s.confirmReturn(l1.id, f2.id, "重复归还", true), (e: ApiError) => e.code === "CONFLICT");
  assert.equal(s.getRecord(l2.id).status, "open");
  assert.equal(s.getRecord(f2.id).status, "open");
  assert.equal(s.candidatesFor(l2.id).some((c) => c.record.id === f.id), false);
  assert.equal(s.listReturns().length, 1);
});

test("历史确认保留当时快照，之后查询不变", () => {
  const { s } = makeService();
  const l = lost(s);
  const f = found(s);
  const ev = s.confirmReturn(l.id, f.id, "核对后归还", true);
  const again = s.getReturn(ev.id);
  assert.equal(again.lostSnapshot.status, "open");
  assert.equal(again.reason, "核对后归还");
});

test("重启后仍能查询归还历史", () => {
  const { s, dbFile } = makeService();
  const l = lost(s);
  const f = found(s);
  s.confirmReturn(l.id, f.id, "持久化验证", true);
  const s2 = new Service(openDb(dbFile));
  const events = s2.listReturns();
  assert.equal(events.length, 1);
  assert.equal(events[0].reason, "持久化验证");
  assert.equal(s2.getRecord(l.id).status, "returned");
});

test("错误输入返回明确校验错误", () => {
  const { s } = makeService();
  assert.throws(() => s.createRecord({ type: "xxx" }), (e: ApiError) => e.code === "VALIDATION_ERROR");
  assert.throws(
    () => lost(s, { dateFrom: "2026-13-40" }),
    (e: ApiError) => e.code === "VALIDATION_ERROR"
  );
  assert.throws(
    () => lost(s, { dateFrom: "2026-09-20", dateTo: "2026-09-10" }),
    (e: ApiError) => e.code === "VALIDATION_ERROR"
  );
  assert.throws(() => s.getRecord(9999), (e: ApiError) => e.code === "NOT_FOUND");
  assert.throws(() => s.updateRecord(9999, { color: "红" }), (e: ApiError) => e.code === "NOT_FOUND");
});

test("已归还或已关闭记录不能修改；修改后候选重新计算", () => {
  const { s } = makeService();
  const l = lost(s);
  const f = found(s);
  assert.equal(s.candidatesFor(l.id).length, 1);
  s.updateRecord(f.id, { category: "手机" });
  assert.equal(s.candidatesFor(l.id).length, 0);
  s.updateRecord(f.id, { category: "雨伞" });
  s.confirmReturn(l.id, f.id, "归还", true);
  assert.throws(() => s.updateRecord(f.id, { color: "红" }), (e: ApiError) => e.code === "BAD_STATE");
  assert.throws(() => s.closeRecord(f.id), (e: ApiError) => e.code === "BAD_STATE");
});

test("关闭的记录不再参与候选", () => {
  const { s } = makeService();
  const l = lost(s);
  const f = found(s);
  s.closeRecord(f.id);
  assert.equal(s.candidatesFor(l.id).length, 0);
});

test("导出 CSV 包含核对记录", () => {
  const { s } = makeService();
  const l = lost(s);
  const f = found(s);
  s.confirmReturn(l.id, f.id, "导出,测试", true);
  const csv = s.exportReturnsCsv();
  assert.match(csv, /lost_id,found_id/);
  assert.match(csv, /"导出,测试"/);
});
