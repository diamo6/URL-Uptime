# Architecture — Website Uptime Monitor

## 1. Overview

```text
┌──────────────┐   REST/JSON    ┌──────────────────┐
│   frontend   │ ─────────────► │   backend (API)   │
│ static SPA   │ ◄───────────── │ node:http server  │
└──────────────┘   HTML/JSON    └────────┬─────────┘
                                         │
                                SQLite (WAL) file
                                         │
        ┌────────────────────────────────┴────────────────┐
        │                                                 │
┌───────┴───────────┐                          ┌──────────┴────────┐
│ worker (scheduler)│ ── HTTP GET (10s) ─────► │  target websites  │
│ every 5 minutes   │ ◄── status/time ──────── │  (HTTP/HTTPS)     │
└───────┬───────────┘                          └───────────────────┘
        │ state change only
┌───────┴───────────┐
│ Microsoft Teams   │
│ Incoming Webhook  │
└───────────────────┘
```

**Stack:** Node.js ≥ 23.4, zero external packages.
`node:http` (API), `node:sqlite` (database), `fetch` (monitoring), vanilla JS SPA,
`node:test` (tests). Separation: `frontend/` · `backend/` · `worker/` · `database/`.

## 2. Project structure

```text
frontend/   index.html, styles.css, app.js     — dashboard + detail SPA
backend/    server.js (entry), app.js (routes), http.js (router/static)
worker/     index.js                           — scheduler + singleton lock
shared/     config, logger, db, monitor, runCheck, incidents, teams, urlUtils, uptime
database/   schema.sql                         — applied idempotently on startup
scripts/    dev.js (API+worker), seed.js, check.js
tests/      classify, urlUtils, monitor, db, api
docs/       this file
```

## 3. Database schema (SQLite, WAL)

- **websites** — `id, name, url (unique), enabled, status, http_status,
  response_time_ms, last_checked_at, last_error, created_at, updated_at`
- **checks** — `id, website_id FK, checked_at, url, status, http_status,
  response_time_ms, ok, error_message, checked_by (scheduler|manual)`
  + unique `(website_id, checked_at, checked_by)` guard against duplicate recording
- **incidents** — `id, website_id FK, status, message, started_at, ended_at,
  downtime_seconds, resolved`
- **app_meta** — key/value: worker lock, worker heartbeat

`PRAGMA journal_mode=WAL; foreign_keys=ON; busy_timeout=5000` so the API process
and worker process can read/write concurrently.

**Uptime** = `(checks not DOWN) / all checks` × 100 in the window
(24h/7d/30d). WARNING (4xx) counts as reachable — a 404 is not server downtime.

## 4. API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | ok + DB + worker heartbeat + config |
| GET | `/api/summary` | totals per status |
| GET/POST | `/api/websites` | list (with 24h uptime) / **add single or bulk** |
| GET/PUT/DELETE | `/api/websites/:id` | detail / update / delete (cascade) |
| POST | `/api/websites/:id/check` | manual check |
| GET | `/api/websites/:id/history` | checks + stats for `?window=` |
| GET | `/api/websites/:id/incidents`, `/api/incidents` | incident lists |

**Bulk add contract** — body accepts `{ url }`, `{ urls: [...] }` or `{ urlsText }`.
Server splits on newline/space/comma, validates + normalizes each URL, dedupes
against the DB and within the paste, derives a name from the hostname, then:

```json
201 { "added": [...], "invalid": [{"input","error"}], "duplicates": [{"input","reason"}] }
400 { "error": "No valid URLs to add.", "invalid": [...], "duplicates": [...] }
```

## 5. Monitoring worker

- **Schedule** — `setInterval` tick (≤30 s) selects websites where
  `last_checked_at IS NULL OR last_checked_at <= now − CHECK_INTERVAL_MS`.
  Due-ness comes from the DB → restart-safe, no lost or duplicated schedule.
- **Singleton lock** — `BEGIN IMMEDIATE` transaction on `app_meta.worker_lock`
  with 90 s TTL heartbeat. Starting the worker twice yields exactly one scheduler;
  the loser idles. The API reads the heartbeat for `/api/health`.
- **Execution** — due sites run through `runCheck()` with concurrency 5:
  1. HTTP GET (10 s timeout, redirects followed up to 5 hops, each hop SSRF-checked)
  2. classify `200-399 UP / 400-499 WARNING / 500-599 DOWN / error DOWN`
  3. insert `checks` row + update `websites` snapshot
  4. if status **changed** → incident logic + Teams alert
- **Manual Check Now** uses the same pipeline with `checked_by='manual'`.

## 6. Incident & alert flow (no spam)

```text
UP ──► WARNING/DOWN ──► open incident + Teams alert (once)
WARNING ↔ DOWN         ──► close + reopen incident + escalation alert (state change)
* ──► UP               ──► close incident (downtime = ended−started) + RECOVERY alert
same status            ──► no incident, no alert   ← never alerts every cycle
```

Teams payload: `{"text","summary","themeColor"}` — sent only when the state
actually changes; one retry, failures logged, monitoring continues.

## 7. Security — SSRF

`shared/urlUtils.js#assertSafeUrl` runs before every outbound request (initial URL
**and every redirect hop**):

1. scheme must be `http:`/`https:`; no credentials in URL; length ≤ 2048
2. IP literals checked against private ranges: `0/8, 10/8, 127/8, 100.64/10,
   172.16/12, 192.168/16, 169.254/16 (cloud metadata), ≥224, ::1, fe80::/10,
   fc00::/7, IPv4-mapped ::ffff:x`
3. hostnames: `localhost`, `*.localhost`, `*.local`, `*.internal` blocked
4. other hostnames resolved via DNS — **all** returned addresses must be public
5. `ALLOW_PRIVATE_IPS=true` bypasses (local testing only)

Additionally: redirect count capped (5) with per-hop revalidation, response body
cancelled after headers (no large downloads), request timeout enforced by
`AbortSignal.timeout`.

## 8. Frontend

Hash-routed SPA (`#/` dashboard, `#/w/:id` detail), refreshes every 30 s.
Dashboard order: **DOWN → WARNING → UNKNOWN → UP** (severity first, disabled last),
summary chips, uptime 24h column, incident history at the bottom. Detail page:
status KPIs, 24H/7D/30D uptime tabs, response stats (current/avg/min/max), SVG
response-time chart with red markers on DOWN, recent checks, incidents.
Design: LESS UI, MORE INFORMATION — accessible status (color **+ text label**),
responsive down to mobile, light/dark via `prefers-color-scheme`.
