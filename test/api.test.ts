import { test, after } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { openDb } from "../src/db.ts";
import { seedDatabase } from "../src/seed.ts";
import { LostFoundService } from "../src/service.ts";
import { createApp } from "../src/server.ts";

async function startTestServer(): Promise<{ base: string; close: () => Promise<void> }> {
  const dbPath = join(tmpdir(), `lf-api-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = openDb(dbPath);
  seedDatabase(db);
  const server: Server = createApp(new LostFoundService(db));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  return { base, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

test("API: 健康检查、候选、显式确认与重复确认错误码", async () => {
  const { base, close } = await startTestServer();
  after(() => void close());

  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);

  const cand = await fetch(`${base}/candidates`).then((r) => r.json() as Promise<{ candidates: Array<{ totalScore: number }> }>);
  assert.ok(cand.candidates.length > 0);
  assert.ok(cand.candidates[0]!.totalScore >= cand.candidates.at(-1)!.totalScore);

  const noConfirm = await fetch(`${base}/returns`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lostId: "L-SEED-004", foundId: "F-SEED-005", reason: "未显式确认" }),
  });
  assert.equal(noConfirm.status, 409);
  assert.equal((await noConfirm.json() as { error: { code: string } }).error.code, "CONFIRM_REQUIRED");

  const ok = await fetch(`${base}/returns`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      lostId: "L-SEED-004",
      foundId: "F-SEED-005",
      reason: "API 端到端核对一致",
      confirm: true,
    }),
  });
  assert.equal(ok.status, 201);

  const dup = await fetch(`${base}/returns`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      lostId: "L-SEED-004",
      foundId: "F-SEED-005",
      reason: "重复确认",
      confirm: true,
    }),
  });
  assert.equal(dup.status, 409);
  assert.equal((await dup.json() as { error: { code: string } }).error.code, "ALREADY_RETURNED");

  const badJson = await fetch(`${base}/records`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "lost",
      category: "nope",
      itemName: "x",
      location: "a",
      area: "b",
      dateFrom: "2026-09-01",
      dateTo: "2026-09-02",
      contactCode: "ANON-L-100",
    }),
  });
  assert.equal(badJson.status, 400);
  assert.equal((await badJson.json() as { error: { code: string } }).error.code, "INVALID_CATEGORY");
});
