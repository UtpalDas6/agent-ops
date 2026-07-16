import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 2 * 1024 * 1024; // board state is a small document; 2MB is generous

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

  const server = createServer((req, res) => {
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
        let size = 0;
        let chunks = [];
        req.on("data", (c) => {
          size += c.length;
          if (size > MAX_BODY) chunks = null; // keep draining, reject at end
          else chunks.push(c);
        });
        req.on("end", () => {
          if (chunks === null) return json(res, 413, { error: "state too large" });
          let state;
          try { state = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
          catch { return json(res, 400, { error: "invalid JSON" }); }
          if (!state || typeof state !== "object" || !state.projects) {
            return json(res, 400, { error: "not a board state" });
          }
          putState.run(JSON.stringify(state), new Date().toISOString());
          res.writeHead(204);
          return res.end();
        });
        return;
      }
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
