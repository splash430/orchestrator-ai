# Playwright Worker

Deployed automatically to Render by the app. Do not edit unless you know
what you're doing — the app calls these endpoints from Claude's tool use.

**Auth**: every request needs `Authorization: Bearer $WORKER_TOKEN`.

**Endpoints**: `/healthz`, `/browse`, `/extract`, `/screenshot`, `/script`
(script is opt-in via `WORKER_ALLOW_SCRIPT=true`).

**Local run**:

```bash
cd worker
npm install
WORKER_TOKEN=dev npm start
```
