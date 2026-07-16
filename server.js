import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 2 * 1024 * 1024; // board state is a small document; 2MB is generous

// Live agent execution: tasks dispatched here run Claude Code headless in the
// project's workspace directory. Requires the `claude` CLI on the host.
const MODEL_IDS = { haiku: "claude-haiku-4-5", sonnet: "claude-sonnet-5", opus: "claude-opus-4-8", fable: "claude-fable-5" };
const MAX_CONCURRENT_RUNS = 2;
const RUN_TIMEOUT_MS = 10 * 60 * 1000; // ponytail: hard kill at 10min; make configurable when long tasks show up
// Strip CLAUDE* vars so a nested CLI run starts clean when the server itself
// was launched from inside a Claude Code session.
const RUN_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("CLAUDE")));

export function start({
  port = Number(process.env.PORT) || 3000,
  host = process.env.HOST || "127.0.0.1",
  dataDir = process.env.DATA_DIR || path.join(ROOT, "data"),
} = {}) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "agent-ops.db"));
  // ponytail: whole-board document store; normalize into project/task tables when auth + multi-user land
  db.exec(`CREATE TABLE IF NOT EXISTS board_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  const getState = db.prepare("SELECT json FROM board_state WHERE id = 1");
  const putState = db.prepare(`INSERT INTO board_state (id, json, updated_at) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`);

  const page = readFileSync(path.join(ROOT, "agent-board.html"));
  const json = (res, code, body) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  // Resolves to the parsed body, or undefined after having already responded 4xx.
  const readJson = (req, res) => new Promise((resolve) => {
    let size = 0;
    let chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) chunks = null; // keep draining, reject at end
      else chunks.push(c);
    });
    req.on("end", () => {
      if (chunks === null) { json(res, 413, { error: "body too large" }); return resolve(undefined); }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { json(res, 400, { error: "invalid JSON" }); resolve(undefined); }
    });
  });

  const runs = new Map(); // taskId -> {status, startedAt, tokens?, usd?, summary?, error?} — in-memory; clients treat a 404 after restart as failed

  const server = createServer(async (req, res) => {
    const t0 = Date.now();
    res.on("finish", () =>
      console.log(`${new Date().toISOString()} ${req.method} ${req.url} ${res.statusCode} ${Date.now() - t0}ms`));
    const { pathname } = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(page);
    }
    if (req.method === "GET" && pathname === "/api/health") return json(res, 200, { ok: true });

    if (pathname === "/api/state") {
      if (req.method === "GET") {
        const row = getState.get();
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(row ? row.json : "null");
      }
      if (req.method === "PUT") {
        const state = await readJson(req, res);
        if (state === undefined) return;
        if (!state || typeof state !== "object" || !state.projects) {
          return json(res, 400, { error: "not a board state" });
        }
        putState.run(JSON.stringify(state), new Date().toISOString());
        res.writeHead(204);
        return res.end();
      }
    }

    if (pathname === "/api/run" && req.method === "POST") {
      const body = await readJson(req, res);
      if (body === undefined) return;
      const { id, title = "", desc = "", model, cwd } = body;
      if (!id || typeof id !== "string" || !MODEL_IDS[model]) {
        return json(res, 400, { error: "id and a known model are required" });
      }
      let dirOk = false;
      try { dirOk = typeof cwd === "string" && statSync(cwd).isDirectory(); } catch {}
      if (!dirOk) return json(res, 400, { error: "workspace is not a directory" });
      if (runs.get(id)?.status === "running") return json(res, 409, { error: "task already running" });
      const active = [...runs.values()].filter((r) => r.status === "running").length;
      if (active >= MAX_CONCURRENT_RUNS) return json(res, 429, { error: "worker slots full" });

      const run = { status: "running", startedAt: Date.now() };
      runs.set(id, run);
      const prompt = `${title}\n\n${desc}`.trim();
      const child = spawn("claude",
        ["-p", prompt, "--model", MODEL_IDS[model], "--permission-mode", "acceptEdits", "--output-format", "json",
         "--append-system-prompt",
         "You are executing a task from the Agent Ops board. Deliver your work as files in the current working directory — create or edit files rather than only answering in text. Reply with a one-sentence summary of what you created or changed."],
        { cwd, env: RUN_ENV, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let errOut = "";
      child.stdout.on("data", (c) => { out += c; });
      child.stderr.on("data", (c) => { errOut += c; });
      const timer = setTimeout(() => child.kill("SIGKILL"), RUN_TIMEOUT_MS);
      child.on("error", (e) => {
        clearTimeout(timer);
        Object.assign(run, { status: "error", error: `could not launch claude CLI: ${e.message}` });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (run.status === "error") return;
        try {
          const r = JSON.parse(out);
          Object.assign(run, {
            status: r.is_error ? "error" : "done",
            tokens: (r.usage?.input_tokens || 0) + (r.usage?.output_tokens || 0),
            usd: r.total_cost_usd,
            summary: String(r.result || "").slice(0, 500),
            error: r.is_error ? String(r.result || "agent reported an error").slice(0, 300) : undefined,
          });
        } catch {
          Object.assign(run, { status: "error", error: (errOut.trim() || `claude exited with code ${code}`).slice(0, 300) });
        }
        console.log(`${new Date().toISOString()} run ${id} ${run.status}${run.usd != null ? ` $${run.usd.toFixed(4)}` : ""}`);
      });
      return json(res, 202, { id, status: "running" });
    }
    if (pathname.startsWith("/api/run/") && req.method === "GET") {
      const run = runs.get(pathname.slice("/api/run/".length));
      return run ? json(res, 200, run) : json(res, 404, { error: "no such run" });
    }

    json(res, 404, { error: "not found" });
  });

  return new Promise((resolve) =>
    server.listen(port, host, () => resolve({ server, host, port: server.address().port }))
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  start().then(({ host, port }) => console.log(`Agent Ops listening on http://${host}:${port}`));
}
