import type { DatabaseSync } from "node:sqlite";
import { insertRecord, listRecords } from "./db.js";
import type { RecordInput } from "./types.js";

// 全部为虚构演示数据，联系人均为匿名编号。
export const SEED: RecordInput[] = [
  {
    kind: "lost",
    category: "keys",
    itemName: "一串钥匙",
    colors: ["silver", "black"],
    tags: ["卡通挂件", "三把"],
    location: "中央图书馆 三楼自习区",
    area: "中央图书馆",
    dateFrom: "2026-09-25",
    dateTo: "2026-09-26",
    contactCode: "ANON-L-001",
    description: "钥匙串上有黄色卡通挂件（虚构）",
  },
  {
    kind: "found",
    category: "keys",
    itemName: "一串钥匙",
    colors: ["silver", "yellow"],
    tags: ["卡通挂件", "三把", "门禁卡"],
    location: "中央图书馆 三楼自习区",
    area: "中央图书馆",
    dateFrom: "2026-09-26",
    dateTo: "2026-09-26",
    contactCode: "ANON-F-001",
  },
  {
    kind: "found",
    category: "keys",
    itemName: "一串钥匙", // 同名但不同地点、不同特征，用于演示不能仅靠名称匹配
    colors: ["gold"],
    tags: ["皮质绳"],
    location: "第二食堂 门口",
    area: "第二食堂",
    dateFrom: "2026-09-26",
    dateTo: "2026-09-27",
    contactCode: "ANON-F-002",
  },
  {
    kind: "lost",
    category: "umbrella",
    itemName: "折叠伞",
    colors: ["blue"],
    tags: ["木柄"],
    location: "教学楼A 二层连廊",
    area: "教学楼A",
    dateFrom: "2026-09-28",
    dateTo: "2026-09-29",
    contactCode: "ANON-L-002",
  },
  {
    kind: "found",
    category: "umbrella",
    itemName: "折叠伞",
    colors: [], // 资料不全：颜色缺失
    tags: ["木柄"],
    location: "教学楼A 二层连廊",
    area: "教学楼A",
    dateFrom: "2026-09-29",
    dateTo: "2026-09-29",
    contactCode: "ANON-F-003",
  },
  {
    kind: "lost",
    category: "backpack",
    itemName: "双肩背包",
    colors: ["black", "gray"],
    tags: ["侧袋水杯", "校徽贴"],
    location: "体育馆 羽毛球馆",
    area: "体育馆",
    dateFrom: "2026-09-30",
    dateTo: "2026-10-01",
    contactCode: "ANON-L-003",
  },
  {
    kind: "found",
    category: "backpack",
    itemName: "双肩背包",
    colors: ["black"],
    tags: ["侧袋水杯", "校徽贴", "雨衣"],
    location: "体育馆 羽毛球馆 12号场",
    area: "体育馆",
    dateFrom: "2026-10-01",
    dateTo: "2026-10-01",
    contactCode: "ANON-F-004",
  },
  {
    kind: "lost",
    category: "wallet",
    itemName: "短款钱包",
    colors: ["brown"],
    tags: ["拉链"],
    location: "地铁站B口",
    area: "校外地铁站",
    dateFrom: "2026-09-20",
    dateTo: "2026-09-20",
    contactCode: "ANON-L-004",
  },
  {
    kind: "found",
    category: "wallet",
    itemName: "短款钱包",
    colors: ["brown"],
    tags: ["拉链"],
    location: "地铁站B口",
    area: "校外地铁站",
    dateFrom: "2026-09-20",
    dateTo: "2026-09-20",
    contactCode: "ANON-F-005",
  },
];

export function seedDatabase(db: DatabaseSync): { inserted: number; records: ReturnType<typeof listRecords> } {
  const existing = listRecords(db);
  if (existing.length > 0) return { inserted: 0, records: existing };
  const now = new Date().toISOString();
  for (const input of SEED) {
    insertRecord(db, input, deterministicId(input, now), now);
  }
  return { inserted: SEED.length, records: listRecords(db) };
}

// 稳定编号，便于演示与文档引用：L-SEED-001 ... F-SEED-002 ...
function deterministicId(input: RecordInput, _now: string): string {
  const idx = SEED.indexOf(input);
  const kindNo = Math.floor(idx / 2) + 1;
  const side = input.kind === "lost" ? "L" : "F";
  const perKind = SEED.slice(0, idx + 1).filter((r) => r.kind === input.kind).length;
  void kindNo;
  return `${side}-SEED-${String(perKind).padStart(3, "0")}`;
}
