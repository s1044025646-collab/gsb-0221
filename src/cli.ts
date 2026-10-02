import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "./db.js";
import { seedDatabase } from "./seed.js";
import { LostFoundService } from "./service.js";
import { AppError, type Candidate, type ItemRecord, type RecordInput, type ReturnEvent } from "./types.js";
import { validateId, validateReason, validateRecordInput } from "./validation.js";

const dataDir = process.env.DB_DIR ?? join(process.cwd(), "data");
const dbPath = process.env.DB_PATH ?? join(dataDir, "lostfound.db");

function getSvc(): LostFoundService {
  mkdirSync(dataDir, { recursive: true });
  return new LostFoundService(openDb(dbPath));
}

function fmtRecord(r: ItemRecord): string {
  return [
    `[${r.id}] (${r.kind}/${r.status}) ${r.category} “${r.itemName}” v${r.version}`,
    `  颜色: ${r.colors.join(",") || "-"} | 标签: ${r.tags.join(",") || "-"}`,
    `  地点: ${r.area} / ${r.location}`,
    `  日期: ${r.dateFrom}~${r.dateTo} | 联系人(匿名): ${r.contactCode}`,
  ].join("\n");
}

function fmtCandidate(c: Candidate, records: Map<string, ItemRecord>): string {
  const lost = records.get(c.lostId)!;
  const found = records.get(c.foundId)!;
  const lines = [
    `总分 ${c.totalScore}  ${c.lostId} ↔ ${c.foundId}  （${lost.itemName} / ${found.itemName}）`,
    ...c.items.map((it) => {
      const icon = it.result === "match" ? "✓" : it.result === "partial" ? "~" : it.result === "mismatch" ? "✗" : "?";
      const sign = it.points > 0 ? `+${it.points}` : `${it.points}`;
      return `   ${icon} [${it.dimension}] ${sign} ${it.detail}`;
    }),
  ];
  if (c.warning) lines.push(`   ⚠ ${c.warning}`);
  return lines.join("\n");
}

function fmtReturn(ev: ReturnEvent): string {
  return [
    `归还事件 #${ev.id} ${ev.lostId} ↔ ${ev.foundId}`,
    `  时间: ${ev.createdAt}  操作员: ${ev.operator}`,
    `  原因: ${ev.reason}`,
    `  确认时分数: ${ev.scoreAtReturn?.totalScore ?? "-"}`,
    `  遗失快照: ${ev.lostSnapshot.itemName} @ ${ev.lostSnapshot.location} (${ev.lostSnapshot.dateFrom}~${ev.lostSnapshot.dateTo})`,
    `  拾获快照: ${ev.foundSnapshot.itemName} @ ${ev.foundSnapshot.location} (${ev.foundSnapshot.dateFrom}~${ev.foundSnapshot.dateTo})`,
  ].join("\n");
}

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }
  return flags;
}

function flagsToRecordBody(flags: Record<string, string>): Record<string, unknown> {
  const body: Record<string, unknown> = { ...flags };
  if (typeof flags.colors === "string") body.colors = flags.colors.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
  if (typeof flags.tags === "string") body.tags = flags.tags.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
  return body;
}

const HELP = `失物招领 CLI（数据文件：${dbPath}）

用法:
  npm run cli -- seed                          写入虚构演示数据（已存在数据则跳过）
  npm run cli -- list [--kind lost|found]
  npm run cli -- add --kind found --category keys --itemName 钥匙串 \\
      --colors silver,black --tags 卡通挂件,三把 --area 中央图书馆 \\
      --location "中央图书馆 三楼" --dateFrom 2026-09-26 --dateTo 2026-09-26 \\
      --contactCode ANON-F-100
  npm run cli -- update --id F-SEED-001 --colors silver,yellow
  npm run cli -- close --id F-SEED-001 --reason "无人认领，移交保卫处"
  npm run cli -- candidates [--lostId L-SEED-001] [--includeClosed true]
  npm run cli -- explain --lostId L-SEED-001 --foundId F-SEED-001
  npm run cli -- confirm --lostId L-SEED-004 --foundId F-SEED-005 \\
      --reason "现场核对挂件与门禁卡一致，匿名编号互认" --confirm true
  npm run cli -- returns [--export data/checks.json]
  npm run cli -- demo                          一键完整流程演示

注意：候选只是建议；confirm 必须显式带 --confirm true。
类别: keys(钥匙) umbrella(雨伞) backpack(背包) phone(手机) wallet(钱包) card(卡片) other(其他)`;

function cmdSeed(svc: LostFoundService): void {
  const db = (svc as unknown as { db: import("node:sqlite").DatabaseSync }).db;
  const result = seedDatabase(db);
  console.log(result.inserted > 0 ? `已写入 ${result.inserted} 条演示记录` : "数据库已有记录，跳过写入");
  result.records.forEach((r) => console.log(fmtRecord(r)));
}

function cmdCandidates(svc: LostFoundService, flags: Record<string, string>): void {
  const list = svc.candidates({
    lostId: flags.lostId,
    foundId: flags.foundId,
    includeClosed: flags.includeClosed === "true",
  });
  const map = new Map(svc.list().map((r) => [r.id, r]));
  if (list.length === 0) {
    console.log("没有达到候选门槛（20 分）的配对；类别冲突的记录已直接排除。");
    return;
  }
  console.log(`候选（按总分降序，同分按编号稳定排序），共 ${list.length} 对：`);
  list.forEach((c, i) => console.log(`#${i + 1}\n${fmtCandidate(c, map)}`));
}

function cmdExplain(svc: LostFoundService, flags: Record<string, string>): void {
  const c = svc.explain(validateId(flags.lostId, "lostId"), validateId(flags.foundId, "foundId"));
  const map = new Map(svc.list().map((r) => [r.id, r]));
  console.log(fmtCandidate(c, map));
}

function cmdConfirm(svc: LostFoundService, flags: Record<string, string>): void {
  const ev = svc.confirmReturn(
    validateId(flags.lostId, "lostId"),
    validateId(flags.foundId, "foundId"),
    validateReason(flags.reason),
    flags.operator ?? "cli-clerk",
    flags.confirm === "true",
  );
  console.log("已确认归还：");
  console.log(fmtReturn(ev));
}

function cmdReturns(svc: LostFoundService, flags: Record<string, string>): void {
  const events = svc.returns();
  if (events.length === 0) console.log("暂无归还事件。");
  events.forEach((ev) => console.log(fmtReturn(ev) + "\n"));
  if (flags.export) {
    const outPath = flags.export;
    writeFileSync(outPath, JSON.stringify({ exportedAt: new Date().toISOString(), returns: events }, null, 2), "utf-8");
    console.log(`核对记录已导出：${outPath}`);
  }
}

export function runDemo(svc: LostFoundService): void {
  console.log("=== 1. 写入虚构演示数据 ===");
  cmdSeed(svc);

  console.log("\n=== 2. 候选匹配（钥匙 L-SEED-001）===");
  cmdCandidates(svc, { lostId: "L-SEED-001" });

  console.log("\n=== 3. 同名不同地点的解释：图书馆钥匙 vs 食堂钥匙 ===");
  cmdExplain(svc, { lostId: "L-SEED-001", foundId: "F-SEED-002" });

  console.log("\n=== 4. 资料不全（雨伞颜色缺失，缺失不加分）===");
  cmdExplain(svc, { lostId: "L-SEED-002", foundId: "F-SEED-003" });

  console.log("\n=== 5. 仅同区域、地点不完全一致（背包）===");
  cmdExplain(svc, { lostId: "L-SEED-003", foundId: "F-SEED-004" });

  console.log("\n=== 6. 未显式 confirm 时应被拒绝 ===");
  try {
    svc.confirmReturn("L-SEED-004", "F-SEED-005", "演示：缺少显式确认", "demo", false);
  } catch (e) {
    console.log(`已拒绝：${(e as AppError).code} - ${(e as Error).message}`);
  }

  console.log("\n=== 7. 显式确认钱包归还（双方状态同一事务提交）===");
  const ev = svc.confirmReturn(
    "L-SEED-004",
    "F-SEED-005",
    "演示：双方匿名编号互认，现场核对拉链与外观一致",
    "demo-clerk",
    true,
  );
  console.log(fmtReturn(ev));

  console.log("\n=== 8. 重复确认同一对记录应失败 ===");
  try {
    svc.confirmReturn("L-SEED-004", "F-SEED-005", "演示：重复确认", "demo", true);
  } catch (e) {
    console.log(`已拒绝：${(e as AppError).code} - ${(e as Error).message}`);
  }

  console.log("\n=== 9. 已归还记录不再出现在开放候选中 ===");
  cmdCandidates(svc, {});

  console.log("\n=== 10. 修改钥匙描述后重新计算候选（历史快照不受影响）===");
  svc.update("F-SEED-001", { tags: ["卡通挂件", "三把", "门禁卡", "新增红色挂绳"] });
  cmdCandidates(svc, {});

  console.log("\n=== 11. 导出核对记录 ===");
  cmdReturns(svc, { export: join(process.cwd(), "data", "checks-demo.json") });
}

function main(argv: string[]): void {
  const [command, ...rest] = argv;
  const flags = parseFlags(rest);
  const svc = getSvc();
  try {
    switch (command) {
      case "seed":
        cmdSeed(svc);
        break;
      case "list": {
        const kind: "lost" | "found" | undefined = flags.kind === "lost" || flags.kind === "found" ? flags.kind : undefined;
        if (flags.kind && kind === undefined) throw new AppError("INVALID_FIELD", "kind 必须是 lost 或 found");
        svc.list(kind).forEach((r) => console.log(fmtRecord(r) + "\n"));
        break;
      }
      case "add":
        console.log(fmtRecord(svc.create(validateRecordInput(flagsToRecordBody(flags) as Record<string, unknown>))));
        break;
      case "update": {
        const id = validateId(flags.id);
        const current = svc.get(id);
        const body = flagsToRecordBody(flags) as Record<string, unknown>;
        delete body.id;
        const str = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback);
        const strList = (v: unknown, fallback: string[]): string[] => (Array.isArray(v) ? (v as string[]) : fallback);
        const merged: RecordInput = {
          kind: current.kind,
          category: str(body.category, current.category),
          itemName: str(body.itemName, current.itemName),
          colors: strList(body.colors, current.colors),
          tags: strList(body.tags, current.tags),
          location: str(body.location, current.location),
          area: str(body.area, current.area),
          dateFrom: str(body.dateFrom, current.dateFrom),
          dateTo: str(body.dateTo, current.dateTo),
          contactCode: str(body.contactCode, current.contactCode),
          description: str(body.description, current.description),
        };
        validateRecordInput({ ...merged });
        console.log(fmtRecord(svc.update(id, merged)));
        break;
      }
      case "close":
        console.log(fmtRecord(svc.close(validateId(flags.id), validateReason(flags.reason))));
        break;
      case "candidates":
        cmdCandidates(svc, flags);
        break;
      case "explain":
        cmdExplain(svc, flags);
        break;
      case "confirm":
        cmdConfirm(svc, flags);
        break;
      case "returns":
        cmdReturns(svc, flags);
        break;
      case "demo":
        runDemo(svc);
        break;
      default:
        console.log(HELP);
        if (command) process.exitCode = 1;
    }
  } catch (e) {
    if (e instanceof AppError) {
      console.error(`错误 [${e.code}] ${e.message}`);
    } else {
      console.error("错误：", (e as Error).message);
    }
    process.exitCode = 1;
  }
}

main(process.argv.slice(2));
