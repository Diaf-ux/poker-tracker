# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page web app ("Покер трекер") for tracking chip counts, results, and debts across home
poker games with friends, run as a Telegram Mini App (also works as a plain browser page). Plain
HTML/CSS/JS — no build step, no bundler, no package.json, no framework. Backend is Supabase
(Postgres) accessed directly via PostgREST's REST API from the browser; there is no server-side
application code.

## Commands

There is no npm/build/lint/test tooling in this repo — don't look for `package.json` scripts.
Development is driven by `just` (see `justfile`) wrapping Docker Compose:

- `just up` — build and start the dev stack (Postgres + PostgREST + nginx serving the static app) at `localhost:3000`, in the background.
- `just up-anonymized` — same, but also restores `backup/backup-latest-anonymized.sql` into the fresh dev DB (requires running `just backup-anonymize` at least once first).
- `just down` — stop containers, keep the Postgres volume.
- `just down-flush` — stop containers and delete the Postgres volume (fully resets dev data).
- `just up-restart` — `down-flush` + `up`.
- `just up-reload` — rebuild/restart only the `app` container (static files), without touching the DB.
- `just backup` — dump prod Supabase DB via `scripts/supabase_backup.py` (REST-API-only, no direct DB connection) into `backup/`, refreshing `backup-latest.sql`. Requires `SUPABASE_URL_PROD` / `SUPABASE_SECRET_KEY_PROD` in `.env`.
- `just backup-anonymize` — runs `backup`, then anonymizes player/game names via `scripts/anonymize_backup.py` into `backup/backup-latest-anonymized.sql` (consistent aliasing within a run, randomized across runs — used to get realistic dev data without real names).
- `just backup-clean` — prune old timestamped backups, keeping the 3 most recent plus the `-latest`/`-anonymized` files.

There's a separate, independent backup path in `.github/workflows/backup.yml`: a daily cron job that
runs `pg_dump` directly against `SUPABASE_DB_URL` and commits the gzipped dump to the `backups`
branch (30-day retention). This is unrelated to the `just backup*` scripts above, which back up via
REST API instead of a direct DB connection.

No automated test suite exists. Verify changes by running `just up` and exercising the UI in a
browser at `localhost:3000`.

## Architecture

### Script load order matters
`index.html` loads scripts in a fixed sequence and relies on globals defined across files — there
are no modules/imports:
```
config.js → utils.js → blind-timer.js → setup.js → game.js → results.js → history.js
```
then calls `initApp()`. Global mutable state lives in two objects: `state` (current game: players,
mode, buy-in, etc., defined in `setup.js`) and `bt` (blind timer state, defined in `blind-timer.js`).
Functions across files read/write these directly.

### Config swapping between prod and dev
`js/config.js` (committed) holds production Supabase URL/anon key and the app password — this is
what ships when the site is deployed as-is. For local dev, the `Dockerfile` overwrites it:
`COPY docker/local.config.js .../js/config.js`, pointing `SUPABASE_URL` at the local nginx origin
(`window.location.origin`) instead of Supabase, so the same frontend code talks to the local
PostgREST instance instead of prod. When editing config, remember there are two versions of this
file that must stay conceptually in sync (`js/config.js` for prod, `docker/local.config.js` for dev).

### Dev stack topology (`docker-compose.yml`)
Three containers: `db` (Postgres 16, schema bootstrapped from `docker/init.sql`), `postgrest`
(PostgREST talking to `db`, exposing the `public` schema to the `web_anon` role), and `app` (nginx
serving the static files, per `Dockerfile`). `docker/nginx.conf` reverse-proxies `/rest/v1/*` on the
app's port 3000 through to the `postgrest` container, and **strips the `Authorization` header**
before proxying — auth to PostgREST is via the `apikey` header / anon role only, not JWTs.

### Data model
Three tables (see `docker/init.sql` for the canonical dev schema, mirroring prod):
- `games` — one row per game session (`name`, `date_str`, `mode`: `cash`|`tournament`, `chips_per_rub`, `buy_in`, `is_closed`).
- `game_players` — one row per player per game (`start_chips`, `final_chips`, `diff_rub` — the player's net rub result for that game).
- `payments` — records of debts actually settled between two players, scoped to a set of games via a comma-delimited `game_ids` string column (e.g. `,3,7,9,`), not a join table.

All access goes through PostgREST's REST conventions (`?select=`, `?order=`, `eq.`/`in.`/`like.`
filters, `Prefer: return=...` headers) via the `sbFetch()` helper in `utils.js`, which wraps `fetch`
with timeouts and retry/backoff for idempotent (GET/HEAD) requests only.

### Core game flow (across setup.js / game.js / results.js / history.js)
1. **Setup** (`setup.js`): add players, pick cash or tournament mode, configure chips/buy-in/payout
   scheme, optionally enable the blind-level timer (`blind-timer.js`, schedule generated by
   `buildBlindSchedule()` scaled to starting chip count).
2. **Game** (`game.js`): live per-player chip tracking with rebuy ("Докуп") history; cash mode only
   (tournament mode has no live rebuys, chips are just a proxy for the fixed buy-in).
3. **Results** (`results.js`): enter final chip counts (cash) or pick finishing places (tournament) →
   computes each player's `diffRub`, then `minimizeTransactions()` produces the minimal set of
   payments to settle all balances (greedy debtor/creditor matching). Saving persists a `games` row
   plus one `game_players` row per player.
4. **History/Leaderboard** (`history.js`): lists past games, aggregates all-time stats per player,
   and lets the user select multiple past games to net out combined debts across them (again via
   `minimizeTransactions`), subtracting any already-recorded `payments` for that game set before
   showing remaining transactions and letting the user mark them settled.

Money/chip math throughout is in rub (₽) with a small epsilon (`0.005`) for float-equality checks —
preserve that epsilon when touching balance/settlement logic.

### Auth
Single shared app password (`APP_PASSWORD` in config.js) checked client-side, gating access via a
flag in `localStorage`. This is access-gating for friends, not real authentication — there's no
per-user identity in the data model (players are just free-text names).

### Supabase MCP
`.mcp.json` (project root) configures Claude Code's Supabase MCP server, pointed at the **production**
project (`project_ref=vylimuuiwyzlwqrpsgrp`) — not the local dev stack from `just up`. This gives
direct read/write access to prod tables, migrations, logs, and advisors via MCP tools
(`mcp__supabase__*`), separate from the REST-API-only `scripts/supabase_backup.py` path used by
`just backup`. Because it's prod, prefer read-only tools (`list_tables`, `execute_sql` for SELECTs,
`get_logs`, `get_advisors`) for exploration, and treat `apply_migration` as a real prod change —
confirm with the user first, same as any other prod-affecting operation.
