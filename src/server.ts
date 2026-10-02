import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { openDb } from "./db.js";
import { LostFoundService } from "./service.js";
import { AppError } from "./types.js";
import {
  validateId,
  validateReason,
  validateRecordInput,
} from "./validation.js";

export interface ServerOptions {
  dbPath: string;
  port: number; // 0 表示由操作系统分配空闲端口
  host?: string;
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(new AppError("BODY_TOO_LARGE", "请求体超过 1MB", 413));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (!raw) return resolve({});
      try {
        const obj = JSON.parse(raw) as unknown;
        if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
          reject(new AppError("INVALID_BODY", "请求体必须是 JSON 对象"));
          return;
        }
        resolve(obj as Record<string, unknown>);
      } catch {
        reject(new AppError("INVALID_JSON", "请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(json);
}

export function createApp(svc: LostFoundService): Server {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname.replace(/\/+$/, "") || "/";
      const method = req.method ?? "GET";

      if (method === "GET" && path === "/health") {
        send(res, 200, { ok: true });
        return;
      }
      if (method === "GET" && (path === "/records" || path === "/api/records")) {
        const kindParam = url.searchParams.get("kind");
        if (kindParam && kindParam !== "lost" && kindParam !== "found") {
          throw new AppError("INVALID_FIELD", "kind 必须是 lost 或 found");
        }
        const kind: "lost" | "found" | undefined =
          kindParam === "lost" || kindParam === "found" ? kindParam : undefined;
        send(res, 200, { records: svc.list(kind) });
        return;
      }
      if (method === "POST" && (path === "/records" || path === "/api/records")) {
        const body = await readJson(req);
        send(res, 201, { record: svc.create(validateRecordInput(body)) });
        return;
      }
      const recordMatch = /^\/(?:api\/)?records\/([^/]+)$/.exec(path);
      if (recordMatch) {
        const id = validateId(decodeURIComponent(recordMatch[1]!));
        if (method === "GET") {
          send(res, 200, { record: svc.get(id) });
          return;
        }
        if (method === "PATCH" || method === "PUT") {
          const body: Record<string, unknown> = await readJson(req);
          // 允许部分字段更新，但仍走完整校验后合并
          const current = svc.get(id);
          const merged: Record<string, unknown> = {
            kind: current.kind,
            category: body.category ?? current.category,
            itemName: body.itemName ?? current.itemName,
            colors: body.colors ?? current.colors,
            tags: body.tags ?? current.tags,
            location: body.location ?? current.location,
            area: body.area ?? current.area,
            dateFrom: body.dateFrom ?? current.dateFrom,
            dateTo: body.dateTo ?? current.dateTo,
            contactCode: body.contactCode ?? current.contactCode,
            description: body.description ?? current.description,
          };
          validateRecordInput(merged as Parameters<typeof validateRecordInput>[0]);
          send(res, 200, { record: svc.update(id, merged as Partial<import("./types.js").RecordInput>) });
          return;
        }
      }
      const closeMatch = /^\/(?:api\/)?records\/([^/]+)\/close$/.exec(path);
      if (closeMatch && method === "POST") {
        const id = validateId(decodeURIComponent(closeMatch[1]!));
        const body: Record<string, unknown> = await readJson(req).catch(() => ({}));
        const reason = validateReason(body.reason);
        send(res, 200, { record: svc.close(id, reason) });
        return;
      }
      if (method === "GET" && (path === "/candidates" || path === "/api/candidates")) {
        const lostId = url.searchParams.get("lostId") ?? undefined;
        const foundId = url.searchParams.get("foundId") ?? undefined;
        const includeClosed = url.searchParams.get("includeClosed") === "true";
        send(res, 200, { candidates: svc.candidates({ lostId, foundId, includeClosed }) });
        return;
      }
      if (method === "GET" && (path === "/explain" || path === "/api/explain")) {
        const lostId = validateId(url.searchParams.get("lostId") ?? "", "lostId");
        const foundId = validateId(url.searchParams.get("foundId") ?? "", "foundId");
        send(res, 200, { explanation: svc.explain(lostId, foundId) });
        return;
      }
      if (method === "POST" && (path === "/returns" || path === "/api/returns")) {
        const body = await readJson(req);
        const lostId = validateId(body.lostId, "lostId");
        const foundId = validateId(body.foundId, "foundId");
        const reason = validateReason(body.reason);
        const operator = typeof body.operator === "string" && body.operator.trim()
          ? body.operator.trim().slice(0, 64)
          : "anonymous-clerk";
        send(res, 201, { returnEvent: svc.confirmReturn(lostId, foundId, reason, operator, body.confirm === true) });
        return;
      }
      if (method === "GET" && (path === "/returns" || path === "/api/returns")) {
        send(res, 200, { returns: svc.returns() });
        return;
      }
      send(res, 404, { error: { code: "NOT_FOUND", message: `无此路由：${method} ${path}` } });
    } catch (e) {
      if (e instanceof AppError) {
        send(res, e.statusCode, { error: { code: e.code, message: e.message, details: e.details ?? null } });
      } else {
        send(res, 500, { error: { code: "INTERNAL", message: (e as Error).message } });
      }
    }
  });
}

export async function startServer(opts: ServerOptions): Promise<{ server: Server; port: number }> {
  const db = openDb(opts.dbPath);
  const svc = new LostFoundService(db);
  const server = createApp(svc);
  await new Promise<void>((resolve) => server.listen(opts.port, opts.host ?? "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, port };
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value === "") return 0;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new Error(`端口必须是 0-65535 的整数，收到：${value}`);
  }
  return n;
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = parsePort(process.env.PORT);
  const dbPath = process.env.DB_PATH ?? join(process.cwd(), "data", "lostfound.db");
  startServer({ dbPath, port }).then(({ port: actual }) => {
    console.log(`失物招领后端已启动：http://127.0.0.1:${actual}`);
    console.log(`数据库：${dbPath}`);
  }).catch((e: Error) => {
    console.error("启动失败：", e.message);
    process.exit(1);
  });
}
