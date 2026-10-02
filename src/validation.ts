import { AppError, type RecordInput, type RecordKind } from "./types.js";

export const CATEGORIES = ["keys", "umbrella", "backpack", "phone", "wallet", "card", "other"] as const;

const CATEGORY_ALIASES: Record<string, string> = {
  钥匙: "keys",
  雨伞: "umbrella",
  背包: "backpack",
  手机: "phone",
  钱包: "wallet",
  卡片: "card",
  其他: "other",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CONTACT_RE = /^[A-Za-z0-9_-]{3,32}$/;

export function normalizeCategory(input: string): string {
  const v = (input ?? "").trim().toLowerCase();
  const mapped = CATEGORY_ALIASES[input?.trim()] ?? CATEGORY_ALIASES[v];
  const result = mapped ?? v;
  if (!(CATEGORIES as readonly string[]).includes(result)) {
    throw new AppError("INVALID_CATEGORY", `未知物品类别：${input}；允许：${CATEGORIES.join(", ")}（或中文别名）`);
  }
  return result;
}

export function normalizeTagList(value: unknown, field: string): string[] {
  let arr: unknown[];
  if (Array.isArray(value)) arr = value;
  else if (typeof value === "string") arr = value.split(/[,，、\s]+/);
  else throw new AppError("INVALID_FIELD", `${field} 必须是字符串数组或逗号分隔字符串`);
  const out = arr
    .map((t) => (typeof t === "string" ? t.trim().toLowerCase() : ""))
    .filter((t) => t.length > 0);
  if (out.some((t) => t.length > 20)) throw new AppError("INVALID_FIELD", `${field} 中标签长度不得超过 20`);
  return [...new Set(out)];
}

function requireText(value: unknown, field: string, max = 100): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError("INVALID_FIELD", `${field} 为必填字符串`);
  }
  const v = value.trim();
  if (v.length > max) throw new AppError("INVALID_FIELD", `${field} 长度不得超过 ${max}`);
  return v;
}

function checkDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !DATE_RE.test(value)) {
    throw new AppError("INVALID_DATE", `${field} 必须是 YYYY-MM-DD 格式日期`);
  }
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new AppError("INVALID_DATE", `${field} 不是有效日期：${value}`);
  }
  return value;
}

export function validateRecordInput(body: Record<string, unknown>): RecordInput {
  if (body === null || typeof body !== "object") {
    throw new AppError("INVALID_BODY", "请求体必须是 JSON 对象");
  }
  const kind = body.kind === "lost" || body.kind === "found" ? (body.kind as RecordKind) : undefined;
  if (!kind) throw new AppError("INVALID_FIELD", "kind 必须是 lost 或 found");

  const dateFrom = checkDate(body.dateFrom, "dateFrom");
  const dateTo = checkDate(body.dateTo ?? body.dateFrom, "dateTo");
  if (dateFrom > dateTo) throw new AppError("INVALID_DATE_RANGE", "dateFrom 不得晚于 dateTo");

  const location = requireText(body.location, "location", 100);
  const area = requireText(body.area, "area", 100);
  const contactCode = requireText(body.contactCode, "contactCode", 32);
  if (!CONTACT_RE.test(contactCode)) {
    throw new AppError("INVALID_CONTACT", "contactCode 仅允许 3-32 位字母、数字、下划线或连字符（匿名编号，不采集证件信息）");
  }

  const description = typeof body.description === "string" ? body.description.trim().slice(0, 500) : "";

  return {
    kind,
    category: normalizeCategory(String(body.category ?? "")),
    itemName: requireText(body.itemName, "itemName", 100),
    colors: normalizeTagList(body.colors ?? [], "colors"),
    tags: normalizeTagList(body.tags ?? [], "tags"),
    location,
    area,
    dateFrom,
    dateTo,
    contactCode,
    description,
  };
}

export function validateId(value: unknown, field = "id"): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(value)) {
    throw new AppError("INVALID_ID", `${field} 不是合法记录编号`);
  }
  return value;
}

export function validateReason(value: unknown): string {
  if (typeof value !== "string" || value.trim().length < 2) {
    throw new AppError("INVALID_FIELD", "reason 为必填，至少 2 个字符，说明人工确认/操作原因");
  }
  if (value.trim().length > 300) throw new AppError("INVALID_FIELD", "reason 不得超过 300 字符");
  return value.trim();
}
