# Agent Ops — Mission Control

Client: `agent-board.html` (single file — kanban, sim engine, analytics,
five theme skins). Server: `server.js` (zero-dependency Node ≥22.5,
`node:sqlite` persistence, serves the client + `/api/state`). The client
falls back to localStorage when opened statically, so the artifact deploy
below still works unchanged.

Run locally: `npm start` → http://127.0.0.1:3000. Tests: `npm test`.
Repo: https://github.com/UtpalDas6/agent-ops (private). `gh` CLI is at
`~/.local/bin/gh`.

## Deploy Configuration (configured by /setup-deploy)
- Platform: Claude artifact (claude.ai hosting)
- Production URL: https://claude.ai/code/artifact/b32dd824-44b9-49b3-a307-0f0d9c864d22
- Deploy workflow: republish `agent-board.html` via the Artifact tool, passing the URL above as `url` to keep the same link
- Deploy status command: none — artifact publish is synchronous
- Merge method: n/a (not a git repo)
- Project type: static single-file web app
- Post-deploy health check: open the production URL in a browser (curl returns 403 — artifacts sit behind claude.ai auth; sharing is via the page's share menu)

### Custom deploy hooks
- Pre-merge: none
- Deploy trigger: manual — ask Claude to republish after editing `agent-board.html`
- Deploy status: n/a
- Health check: manual browser check
