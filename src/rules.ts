import { Explanation, ItemRecord, ScoreItem } from "./types";

// ---- 可解释匹配规则（固定规则，README 中有同样说明） ----
// 0. 类别明显冲突 -> 不进入候选（eligible=false）
// 1. 地点：place 完全一致 +30；仅同区域(area) +15；都不同 +0；缺信息 +0 并注明
// 2. 日期：遗失区间与拾获区间有重叠 +20；间隔<=2天 +10；否则 +0；缺信息 +0 并注明
// 3. 颜色：完全一致 +15；同色系 +8；明确不同色系 -10；缺信息 +0 并注明
// 4. 标签：每个共同标签 +5，封顶 +20；任一方无标签 +0 并注明
// 候选门槛：总分 >= 25；同分按拾获/遗失记录 id 升序稳定排序。

export const MIN_SCORE = 25;

const KNOWN_CATEGORIES = [
  "钥匙",
  "雨伞",
  "背包",
  "手机",
  "钱包",
  "证件卡",
  "衣物",
  "水杯",
  "眼镜",
  "耳机",
];

const COLOR_FAMILIES: string[][] = [
  ["黑", "深灰", "灰"],
  ["蓝", "藏青", "天蓝"],
  ["红", "酒红", "粉"],
  ["绿", "墨绿"],
  ["黄", "橙"],
  ["白", "米白", "米"],
  ["棕", "咖啡", "卡其"],
  ["紫"],
  ["银", "金"],
];

function norm(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = s.trim().toLowerCase();
  return t === "" ? null : t;
}

export function categoriesCompatible(a: string, b: string): boolean {
  const ca = norm(a);
  const cb = norm(b);
  if (!ca || !cb) return true; // 未知类别不视为明显冲突
  if (ca === cb) return true;
  if (ca === "其他" || cb === "其他") return true;
  const aKnown = KNOWN_CATEGORIES.includes(ca);
  const bKnown = KNOWN_CATEGORIES.includes(cb);
  // 两个都是已知且不同的具体类别 -> 明显冲突
  if (aKnown && bKnown) return false;
  return true;
}

function colorFamily(color: string): number {
  for (let i = 0; i < COLOR_FAMILIES.length; i++) {
    if (COLOR_FAMILIES[i].some((c) => color.includes(c))) return i;
  }
  return -1;
}

function parseDay(s: string): number {
  return Math.floor(Date.parse(s + "T00:00:00Z") / 86400000);
}

export function explainPair(lost: ItemRecord, found: ItemRecord): Explanation {
  const items: ScoreItem[] = [];
  const ex: Explanation = {
    lostId: lost.id,
    foundId: found.id,
    total: 0,
    eligible: true,
    items,
  };

  if (!categoriesCompatible(lost.category, found.category)) {
    ex.eligible = false;
    ex.ineligibleReason = `类别明显冲突：遗失为「${lost.category}」，拾获为「${found.category}」`;
    items.push({ rule: "类别", points: 0, detail: ex.ineligibleReason });
    return ex;
  }
  items.push({
    rule: "类别",
    points: 0,
    detail:
      norm(lost.category) === norm(found.category)
        ? `类别一致（${lost.category}），不加分也不排除`
        : `类别不冲突（${lost.category} / ${found.category}），不加分`,
  });

  // 地点
  const lp = norm(lost.place);
  const fp = norm(found.place);
  const la = norm(lost.area);
  const fa = norm(found.area);
  if (lp && fp && lp === fp) {
    items.push({ rule: "地点", points: 30, detail: `地点完全一致（${lost.place}）+30` });
  } else if (la && fa && la === fa) {
    items.push({
      rule: "地点",
      points: 15,
      detail: `仅同一区域（${lost.area}），具体地点${lp && fp ? "不同" : "缺失"} +15`,
    });
  } else if ((!lp || !fp) && (!la || !fa)) {
    items.push({ rule: "地点", points: 0, detail: "地点信息缺失，不能视为相符 +0" });
  } else {
    items.push({ rule: "地点", points: 0, detail: "地点与区域均不一致 +0" });
  }

  // 日期
  const ld1 = lost.dateFrom;
  const ld2 = lost.dateTo ?? lost.dateFrom;
  const fd1 = found.dateFrom;
  const fd2 = found.dateTo ?? found.dateFrom;
  if (ld1 && fd1) {
    const a1 = parseDay(ld1);
    const a2 = parseDay(ld2!);
    const b1 = parseDay(fd1);
    const b2 = parseDay(fd2!);
    if (a1 <= b2 && b1 <= a2) {
      items.push({ rule: "日期", points: 20, detail: "日期范围存在重叠 +20" });
    } else {
      const gap = a2 < b1 ? b1 - a2 : a1 - b2;
      if (gap <= 2) {
        items.push({ rule: "日期", points: 10, detail: `日期范围相近（间隔 ${gap} 天）+10` });
      } else {
        items.push({ rule: "日期", points: 0, detail: `日期范围间隔 ${gap} 天，过远 +0` });
      }
    }
  } else {
    items.push({ rule: "日期", points: 0, detail: "日期信息缺失，不能视为相符 +0" });
  }

  // 颜色
  const lc = norm(lost.color);
  const fc = norm(found.color);
  if (lc && fc) {
    if (lc === fc) {
      items.push({ rule: "颜色", points: 15, detail: `颜色完全一致（${lost.color}）+15` });
    } else {
      const lf = colorFamily(lc);
      const ff = colorFamily(fc);
      if (lf !== -1 && lf === ff) {
        items.push({ rule: "颜色", points: 8, detail: `颜色同色系（${lost.color} / ${found.color}）+8` });
      } else {
        items.push({ rule: "颜色", points: -10, detail: `颜色明显不同（${lost.color} / ${found.color}）-10` });
      }
    }
  } else {
    items.push({ rule: "颜色", points: 0, detail: "颜色信息缺失，不能视为相符 +0" });
  }

  // 标签
  if (lost.tags.length > 0 && found.tags.length > 0) {
    const foundSet = new Set(found.tags.map((t) => norm(t)));
    const common = lost.tags.filter((t) => foundSet.has(norm(t)));
    if (common.length > 0) {
      const pts = Math.min(common.length * 5, 20);
      items.push({ rule: "标签", points: pts, detail: `共同标签：${common.join("、")} +${pts}` });
    } else {
      items.push({ rule: "标签", points: 0, detail: "无共同标签 +0" });
    }
  } else {
    items.push({ rule: "标签", points: 0, detail: "特征标签缺失，不能视为相符 +0" });
  }

  ex.total = items.reduce((s, it) => s + it.points, 0);
  return ex;
}

export function isCandidate(ex: Explanation): boolean {
  return ex.eligible && ex.total >= MIN_SCORE;
}
