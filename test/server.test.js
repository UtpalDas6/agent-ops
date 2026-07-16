import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { start } from "../server.js";

const { server, port } = await start({
  port: 0,
  dataDir: mkdtempSync(path.join(tmpdir(), "agent-ops-test-")),
});
const base = `http://127.0.0.1:${port}`;
test.after(() => server.close());

test("health check", async () => {
  const r = await fetch(`${base}/api/health`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
});

test("serves the app at /", async () => {
  const r = await fetch(`${base}/`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/html/);
  assert.match(await r.text(), /Mission Control/);
});

test("state is null before first save", async () => {
  const r = await fetch(`${base}/api/state`);
  assert.equal(r.status, 200);
  assert.equal(await r.json(), null);
});

test("state roundtrip", async () => {
  const state = {
    cur: "p1",
    projects: { p1: { name: "Test", tasks: [], log: [], history: [], budget: 10 } },
  };
  const put = await fetch(`${base}/api/state`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
  });
  assert.equal(put.status, 204);
  const get = await fetch(`${base}/api/state`);
  assert.deepEqual(await get.json(), state);
});

test("rejects invalid JSON", async () => {
  const r = await fetch(`${base}/api/state`, { method: "PUT", body: "{nope" });
  assert.equal(r.status, 400);
});

test("rejects non-board payloads", async () => {
  const r = await fetch(`${base}/api/state`, { method: "PUT", body: JSON.stringify({ hello: 1 }) });
  assert.equal(r.status, 400);
});

test("caps body size at 2MB", async () => {
  const huge = `{"projects":{"x":"${"a".repeat(2.5 * 1024 * 1024)}"}}`;
  const r = await fetch(`${base}/api/state`, { method: "PUT", body: huge });
  assert.equal(r.status, 413);
});

test("unknown routes 404", async () => {
  const r = await fetch(`${base}/api/nope`);
  assert.equal(r.status, 404);
});
