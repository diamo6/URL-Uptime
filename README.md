# Website Uptime Monitor

Minimalist website uptime monitoring dashboard — HTTP status, response time, uptime %, incident history, and Microsoft Teams alerts.

**Zero runtime dependencies.** Runs on Node.js ≥ 23.4 (tested on Node 24) with the built-in `node:sqlite` — no `npm install` required.

---

## Features (MVP)

- ✅ **Bulk add** — copy several URLs and paste them **all at once** (newline, space or comma separated)
- ✅ Add / edit / enable-disable / delete websites from the UI
- ✅ Checks every **5 minutes** by a background worker (restart-safe, no duplicate schedulers)
- ✅ HTTP status code + response time + timeout (10 s) + connection/DNS/TLS errors
- ✅ Classification: `200–399 → UP`, `400–499 → WARNING`, `500–599 / network failure → DOWN`
- ✅ Persistent history (SQLite/WAL) + **Uptime %** for 24h / 7d / 30d
- ✅ Incident history (open/close + downtime duration)
- ✅ **Microsoft Teams** alerts on state change only — never spam every cycle
  - DOWN / WARNING alert, escalation, and RECOVERY notification
- ✅ **Check Now** (manual check) from the dashboard
- ✅ Website detail: response-time stats + chart, per-window uptime, checks, incidents
- ✅ SSRF protection (private/loopback/metadata IPs blocked, redirects re-validated)
- ✅ Health check endpoint `GET /api/health`
- ✅ Minimalist, responsive, light/dark UI
- ✅ Tests, Docker, README, `.env.example`

**No Login/RBAC/SSO/Payment** — by design, per MVP scope.

---

## Quick Start (local)

Requirements: **Node.js 24** (or ≥ 23.4).

```bash
# 1) (optional) configure
cp .env.example .env

# 2) run API + worker together
npm run dev
#   or in two terminals:
#   npm start        → API + Dashboard on http://localhost:3000
#   npm run worker   → background monitor (every 5 minutes)

# 3) open the dashboard
#   http://localhost:3000
```

Optional seed of example websites:

```bash
npm run seed
```

One-shot check from the CLI (great for verifying connectivity):

```bash
npm run check -- https://example.com
```

### Add multiple URLs at once

Click **+ Add Website**, then paste all URLs into the textarea:

```text
https://example.com
https://api.example.com/health
https://portal.example.com
```

They may also be separated by spaces or commas. Invalid and duplicate entries are
reported individually while valid ones are still added.

---

## Docker

```bash
docker compose up -d --build
# Dashboard → http://localhost:3000
```

`api` and `worker` share one SQLite volume (`uptime-data`).

---

## Configuration

Copy `.env.example` → `.env`. All values have working defaults.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | API + dashboard port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATABASE_PATH` | `./database/uptime.db` | SQLite file |
| `CHECK_INTERVAL_MS` | `300000` (5 min) | Monitoring interval |
| `REQUEST_TIMEOUT_MS` | `10000` (10 s) | HTTP timeout |
| `MAX_REDIRECTS` | `5` | Redirect limit (each hop SSRF-checked) |
| `TEAMS_WEBHOOK_URL` | *(empty)* | Microsoft Teams incoming webhook; empty = alerts off |
| `ALLOW_PRIVATE_IPS` | `false` | Set `true` **only** for local testing (SSRF) |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

---

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Health + worker heartbeat + config |
| GET | `/api/summary` | Totals per status |
| GET | `/api/websites` | List with 24h uptime |
| POST | `/api/websites` | Add — `{ url }`, `{ urls: [...] }` or `{ urlsText }` (bulk) |
| GET | `/api/websites/:id` | Detail: uptime windows, response stats, series, checks, incidents |
| PUT | `/api/websites/:id` | Update `{ name?, url?, enabled? }` |
| DELETE | `/api/websites/:id` | Delete (cascades history) |
| POST | `/api/websites/:id/check` | Manual check now |
| GET | `/api/websites/:id/history?window=24h` | Checks + stats for a window |
| GET | `/api/websites/:id/incidents` | Incidents of one website |
| GET | `/api/incidents?limit=50` | Recent incidents (all websites) |

Bulk add example:

```bash
curl -X POST http://localhost:3000/api/websites \
  -H "content-type: application/json" \
  -d '{"urlsText":"https://a.com\nhttps://b.com\nhttps://c.com"}'
```

---

## Tests

```bash
npm test
```

Covers: status classification, bulk URL parsing/validation, SSRF rules, uptime/stats
computation, incident lifecycle, HTTP engine against a local server (404→WARNING,
503→DOWN, timeout, redirect loop, connection refused), and full API integration
(bulk add of 3 URLs, CRUD, manual check).

---

## Project Structure

```text
website-uptime-monitor/
├── frontend/     # static SPA (HTML/CSS/JS — no build step)
├── backend/      # REST API + static hosting (node:http)
├── worker/       # background scheduler (5-min checks, singleton lock)
├── shared/       # config, db, monitor engine, incidents, Teams, URL utils
├── database/     # schema.sql + uptime.db (created at runtime)
├── scripts/      # dev launcher, seed, one-shot check
├── tests/        # node:test suites
├── docs/         # ARCHITECTURE.md
├── .env.example
├── Dockerfile
└── docker-compose.yml
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design
(schema, API, worker, SSRF, alert flow).

---

## Microsoft Teams

1. In Teams → channel → **Connectors → Incoming Webhook** → create, copy the URL.
2. Put it in `.env` as `TEAMS_WEBHOOK_URL=...` and restart.
3. Alerts are sent **only on state change**: UP→WARNING, →DOWN, escalation, and
   recovery (with downtime duration).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Toast: "Worker not running" | Start `npm run worker` (or use `npm run dev`) |
| Sites stay `UNKNOWN` | First check happens within ~30 s of worker start |
| `node:sqlite` import error | Use Node.js ≥ 23.4 (`node -v`) |
| Alert says "Private or internal IP" | Expected for localhost/10.x/192.168.x — set `ALLOW_PRIVATE_IPS=true` only for local testing |
| Two workers running | Safe: the DB lock allows only one scheduler; the other idles |
