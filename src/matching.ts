import type { Candidate, ItemRecord, ScoreItem } from "./types.js";

// 固定、公开的匹配规则（与 README 一致）。
// 规则总览：
//  1. 类别不同（含类别缺失视为非法输入，登记时即拒绝）直接排除，不进入候选。
//  2. 时间：遗失区间与拾获日期区间有交集 +35；无交集按最近间隔扣分；一侧日期信息缺失记“信息缺失”，不得分。
//  3. 地点：精确地点一致 +25；仅区域一致 +8 且标注 partial；区域不一致 -10；任一侧缺失不得分。
//  4. 颜色：颜色集合有交集，每个交集色 +7（上限 +21）；双方都填了但无交集 -10；一侧未填记缺失，不得分。
//  5. 特征标签：每命中一个标签 +8（上限 +24）；双方都填了但零命中 -6；一侧无标签记缺失。
//  6. 名称完全相同本身不加分，避免“同名即同物”的错误认定；名称只用于人工核对展示。
//  候选门槛：totalScore >= 20 才列为候选；同分按 (lost.id, found.id) 字典序稳定排序。

export const CANDIDATE_THRESHOLD = 20;

function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number) as [number, number, number];
  const [by, bm, bd] = b.split("-").map(Number) as [number, number, number];
  const da = Date.UTC(ay, am - 1, ad);
  const db2 = Date.UTC(by, bm - 1, bd);
  return Math.round((da - db2) / 86_400_000);
}

function scoreTime(lost: ItemRecord, found: ItemRecord): ScoreItem {
  if (!lost.dateFrom || !found.dateFrom) {
    return { dimension: "time", points: 0, result: "missing", detail: "遗失或拾获日期缺失，无法核对时间，按信息缺失处理（不加分）" };
  }
  const overlap = !(lost.dateTo < found.dateFrom || found.dateTo < lost.dateFrom);
  if (overlap) {
    return {
      dimension: "time",
      points: 35,
      result: "match",
      detail: `日期区间有交集：遗失 ${lost.dateFrom}~${lost.dateTo} 与 拾获 ${found.dateFrom}~${found.dateTo}`,
    };
  }
  const gap = Math.min(
    Math.abs(dayDiff(lost.dateFrom, found.dateTo)),
    Math.abs(dayDiff(found.dateFrom, lost.dateTo)),
  );
  const pts = gap <= 2 ? -6 : gap <= 7 ? -12 : -20;
  return {
    dimension: "time",
    points: pts,
    result: "mismatch",
    detail: `日期区间无交集，最近相差 ${gap} 天（遗失 ${lost.dateFrom}~${lost.dateTo}，拾获 ${found.dateFrom}~${found.dateTo}），扣 ${-pts} 分`,
  };
}

function scoreLocation(lost: ItemRecord, found: ItemRecord): ScoreItem {
  if (!lost.area || !found.area) {
    return { dimension: "location", points: 0, result: "missing", detail: "地点/区域信息缺失，无法核对地点（不加分）" };
  }
  if (lost.location === found.location && lost.location.length > 0) {
    return { dimension: "location", points: 25, result: "match", detail: `地点完全一致：${lost.location}` };
  }
  if (lost.area === found.area) {
    return {
      dimension: "location",
      points: 8,
      result: "partial",
      detail: `仅在同一区域「${lost.area}」（具体地点不同：${lost.location} vs ${found.location}），加 8 分`,
    };
  }
  return {
    dimension: "location",
    points: -10,
    result: "mismatch",
    detail: `区域不一致：${lost.area}/${lost.location} vs ${found.area}/${found.location}，扣 10 分`,
  };
}

function intersect(a: string[], b: string[]): string[] {
  const setB = new Set(b);
  return [...new Set(a)].filter((x) => setB.has(x));
}

function scoreColors(lost: ItemRecord, found: ItemRecord): ScoreItem {
  if (lost.colors.length === 0 || found.colors.length === 0) {
    return {
      dimension: "colors",
      points: 0,
      result: "missing",
      detail: `颜色信息不完整（遗失：${lost.colors.join("/") || "未填"}；拾获：${found.colors.join("/") || "未填"}），按缺失处理（不加分）`,
    };
  }
  const hit = intersect(lost.colors, found.colors);
  if (hit.length > 0) {
    const pts = Math.min(hit.length * 7, 21);
    return { dimension: "colors", points: pts, result: "match", detail: `颜色命中：${hit.join("、")}，加 ${pts} 分` };
  }
  return {
    dimension: "colors",
    points: -10,
    result: "mismatch",
    detail: `颜色无交集（遗失：${lost.colors.join("、")}；拾获：${found.colors.join("、")}），扣 10 分`,
  };
}

function scoreTags(lost: ItemRecord, found: ItemRecord): ScoreItem {
  if (lost.tags.length === 0 || found.tags.length === 0) {
    return {
      dimension: "tags",
      points: 0,
      result: "missing",
      detail: `特征标签不完整（遗失 ${lost.tags.length} 个；拾获 ${found.tags.length} 个），缺失项不得当作相符`,
    };
  }
  const hit = intersect(lost.tags, found.tags);
  if (hit.length > 0) {
    const pts = Math.min(hit.length * 8, 24);
    return { dimension: "tags", points: pts, result: "match", detail: `标签命中：${hit.join("、")}，加 ${pts} 分` };
  }
  return {
    dimension: "tags",
    points: -6,
    result: "mismatch",
    detail: `标签无共同项（遗失：${lost.tags.join("、")}；拾获：${found.tags.join("、")}），扣 6 分`,
  };
}

export function scorePair(lost: ItemRecord, found: ItemRecord): Candidate {
  const items = [scoreTime(lost, found), scoreLocation(lost, found), scoreColors(lost, found), scoreTags(lost, found)];
  const totalScore = items.reduce((s, it) => s + it.points, 0);
  const hasMissing = items.some((it) => it.result === "missing");
  const warning = hasMissing
    ? "存在信息缺失维度，缺失不等于相符；候选仅供参考，归还前必须人工核对。"
    : null;
  return { lostId: lost.id, foundId: found.id, totalScore, items, warning };
}

export function categoryCompatible(a: ItemRecord, b: ItemRecord): boolean {
  return a.category === b.category;
}

export interface GenerateOptions {
  lostId?: string;
  foundId?: string;
  includeClosed?: boolean;
  threshold?: number;
}

export function generateCandidates(records: ItemRecord[], opts: GenerateOptions = {}): Candidate[] {
  const losts = records.filter(
    (r) => r.kind === "lost" && (opts.includeClosed || r.status === "open") && (!opts.lostId || r.id === opts.lostId),
  );
  const founds = records.filter(
    (r) => r.kind === "found" && (opts.includeClosed || r.status === "open") && (!opts.foundId || r.id === opts.foundId),
  );
  const threshold = opts.threshold ?? CANDIDATE_THRESHOLD;
  const out: Candidate[] = [];
  for (const lost of losts) {
    for (const found of founds) {
      if (!categoryCompatible(lost, found)) continue; // 类别明显冲突直接排除
      const c = scorePair(lost, found);
      if (c.totalScore >= threshold) out.push(c);
    }
  }
  // 稳定次序：分数降序；同分按双方编号字典序，绝不依赖查询/插入偶然顺序。
  out.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if (a.lostId !== b.lostId) return a.lostId < b.lostId ? -1 : 1;
    return a.foundId < b.foundId ? -1 : a.foundId > b.foundId ? 1 : 0;
  });
  return out;
}
