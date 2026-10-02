import * as http from "node:http";
import { Service } from "./service";
import { ApiError } from "./types";

function send(res: http.ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(json);
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError("VALIDATION_ERROR", "请求体不是合法 JSON");
  }
}

export function createServer(service: Service): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      const method = req.method ?? "GET";
      const body = method === "POST" || method === "PATCH" ? await readBody(req) : undefined;

      if (method === "GET" && url.pathname === "/health") {
        return send(res, 200, { ok: true });
      }
      if (method === "POST" && url.pathname === "/records") {
        return send(res, 201, service.createRecord(body));
      }
      if (method === "GET" && url.pathname === "/records") {
        return send(
          res,
          200,
          service.listRecords({
            type: url.searchParams.get("type") ?? undefined,
            status: url.searchParams.get("status") ?? undefined,
          })
        );
      }
      if (parts[0] === "records" && parts[1]) {
        const id = Number(parts[1]);
        if (!Number.isInteger(id)) throw new ApiError("VALIDATION_ERROR", "记录 id 必须是整数");
        if (method === "GET" && parts.length === 2) return send(res, 200, service.getRecord(id));
        if (method === "PATCH" && parts.length === 2) return send(res, 200, service.updateRecord(id, body));
        if (method === "POST" && parts[2] === "close") return send(res, 200, service.closeRecord(id));
        if (method === "GET" && parts[2] === "candidates") return send(res, 200, service.candidatesFor(id));
      }
      if (method === "GET" && url.pathname === "/explain") {
        const lostId = Number(url.searchParams.get("lostId"));
        const foundId = Number(url.searchParams.get("foundId"));
        if (!Number.isInteger(lostId) || !Number.isInteger(foundId)) {
          throw new ApiError("VALIDATION_ERROR", "需要整数参数 lostId 与 foundId");
        }
        return send(res, 200, service.explain(lostId, foundId));
      }
      if (method === "POST" && url.pathname === "/returns") {
        return send(
          res,
          201,
          service.confirmReturn(Number(body.lostId), Number(body.foundId), body.reason, body.confirm)
        );
      }
      if (method === "GET" && url.pathname === "/returns") {
        return send(res, 200, service.listReturns());
      }
      if (method === "GET" && url.pathname === "/export/returns") {
        if ((url.searchParams.get("format") ?? "json") === "csv") {
          res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8" });
          return res.end(service.exportReturnsCsv());
        }
        return send(res, 200, service.listReturns());
      }
      throw new ApiError("NOT_FOUND", `路由不存在：${method} ${url.pathname}`, 404);
    } catch (e: any) {
      if (e instanceof ApiError) {
        return send(res, e.status, { error: { code: e.code, message: e.message } });
      }
      return send(res, 500, { error: { code: "INTERNAL", message: String(e?.message ?? e) } });
    }
  });
}

export function startServer(port?: number): Promise<{ server: http.Server; port: number }> {
  const service = new Service();
  const server = createServer(service);
  const p = port ?? (process.env.PORT ? Number(process.env.PORT) : 0);
  return new Promise((resolve) => {
    server.listen(p, () => {
      const addr = server.address() as any;
      resolve({ server, port: addr.port });
    });
  });
}

if (require.main === module) {
  const idx = process.argv.indexOf("--port");
  const port = idx >= 0 ? Number(process.argv[idx + 1]) : undefined;
  startServer(port).then((result) => {
    console.log(`失物招领服务已启动: http://localhost:${result.port}`);
  });
}
