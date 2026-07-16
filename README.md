# Agent Ops — Mission Control

**Jira for AI agent fleets.** A kanban where the "assignees" are LLM agents:
every task gets a token estimate, a real dollar cost, and an automatic
model-routing decision based on criticality — then a worker pool executes it
while budget guardrails watch the spend.

Teams adopting AI agents hit the same wall: nobody knows what agent work
costs, which model each task deserves, or when the bill runs away. Agent Ops
answers all three on one board.

## Features

- **Cost-aware model routing** — each task is estimated in tokens and priced
  against real per-model rates (Haiku 4.5 → Fable 5). Criticality decides the
  model; the board shows the savings vs. running everything on the top model
  (typically 50–70%).
- **Live execution** — a worker pool picks up assigned tasks in criticality
  order, burns tokens in real time with per-model throughput, and completes
  with *actual* cost vs. estimate deltas.
- **Budget guardrails** — set a per-project budget; when live spend crosses
  it, the fleet pauses itself and the event is logged.
- **Analytics** — total spend, savings, estimate accuracy, spend by model,
  cumulative spend over time.
- **Audit trail** — timestamped activity log of every routing decision, agent
  pickup, completion, and budget event.
- **Natural-language breakdown** — paste a plain-English brief; it splits
  into tasks, classifies type and criticality, and routes each one.
- **Multi-project, search/filters, export/import, five theme skins.**

## Quickstart

Requires Node ≥ 22.5 (uses the built-in `node:sqlite`).

```sh
npm start          # serves the app + API on http://127.0.0.1:3000
npm test           # API + integration tests (node --test)
```

Or with Docker:

```sh
docker build -t agent-ops .
docker run -p 3000:3000 -v agent-ops-data:/data agent-ops
```

`agent-board.html` also runs standalone (open the file, or host it anywhere
static) — it falls back to localStorage when no API is present.

## Architecture

```
agent-board.html   single-file client: board, sim engine, analytics, theming
server.js          zero-dependency Node server: static hosting + JSON API
                   persistence: SQLite via node:sqlite (data/agent-ops.db)
test/              node --test suite against a live server instance
```

The client keeps a full local copy (localStorage) and debounce-syncs the
board state to the server when one is present — so the demo deploy, offline
use, and the server-backed install are the same file.

### API

| Method | Path          | Description                              |
|--------|---------------|------------------------------------------|
| GET    | `/`           | The app                                   |
| GET    | `/api/health` | Liveness probe                            |
| GET    | `/api/state`  | Full board state (JSON, `null` if empty)  |
| PUT    | `/api/state`  | Replace board state (validated, 2MB cap) |

## Roadmap

1. **Auth + multi-user** — SSO, per-user boards, roles; split the state
   document into per-entity endpoints with optimistic concurrency.
2. **Real agent execution** — swap the simulation engine for the Claude API:
   the routing table already maps criticality → model; the worker pool
   becomes a queue of real API calls with live token usage from `usage`.
3. **Postgres option** for horizontal scale; SQLite remains the
   single-node default.
4. **Slack/Jira integrations** — mirror tasks and completions.

## License

Proprietary — see [LICENSE](LICENSE).
