# Pocker tracker

A single-page web app for tracking chip counts, results, and who-owes-who across home poker games
with friends. Runs as a Telegram Mini App (via `telegram-web-app.js`), and works as a regular
browser page too. No account system beyond a single shared password.

Supports two modes:
- **Кэш (Cash)** — live per-player chip tracking during the game, with rebuys, converted to ₽ at a
  configurable chips-per-rub rate.
- **Турнир (Tournament)** — fixed buy-in, optional payout split between 1st place (winner-takes-all
  or top-2), and an optional blind-level timer with an auto-generated blind schedule.

At the end of a game it computes each player's net result and the minimal set of payments needed to
settle all balances. Past games are saved to a database, with a leaderboard/stats view and the
ability to net out debts across multiple selected games at once (tracking which debts have actually
been paid).

## Architecture

Plain HTML/CSS/JS — no build step, no bundler, no npm/package.json. The frontend talks directly to
a [PostgREST](https://postgrest.org/) REST API in front of a Postgres database (Supabase in
production); there is no backend application server.

```
Browser (index.html + js/*.js)
        │  fetch() → sbFetch() wrapper (utils.js)
        ▼
PostgREST  (REST API over Postgres, `web_anon` role)
        ▼
Postgres   (games / game_players / payments tables)
```

- `index.html` — markup for all pages/tabs (auth, setup, live game, results, leaderboard, history).
- `js/config.js` — Supabase URL/key, app password, storage keys. **Swapped out for local dev** — see
  Prerequisites below.
- `js/utils.js` — `sbFetch()`: fetch wrapper with timeouts and retry/backoff for the PostgREST API.
- `js/setup.js` — game setup screen; owns the global `state` object (players, mode, buy-in, etc.).
- `js/blind-timer.js` — tournament blind-level countdown timer and auto-generated blind schedule.
- `js/game.js` — live game screen (chip tracking, rebuys).
- `js/results.js` — final results, debt-minimization algorithm, saving a finished game.
- `js/history.js` — leaderboard, game history, multi-game debt settlement.
- `css/style.css` — all styling.
- `docker/` — dev-only nginx config, local Supabase-config override, and the Postgres schema
  (`init.sql`) mirroring production.
- `scripts/` — Python backup/anonymization scripts (see Backups below).
- `tests/` — automated test suite (see Testing below).
- `docs/` — write-ups too detailed for `README.md`/`.claude/CLAUDE.md` (known issues, investigation
  notes).

Scripts are loaded in a fixed order in `index.html` (config → utils → blind-timer → setup → game →
results → history) and share state via globals — there are no ES modules.

For a deeper dive (data model, request conventions, money/debt-calculation details, auth model),
see [`.claude/CLAUDE.md`](.claude/CLAUDE.md).

If you're using Claude Code, this repo has a Supabase MCP server configured (`.mcp.json`) pointing
at the production project — you can use it to inspect prod schema/logs/advisors directly instead of
querying Supabase by hand.

## Prerequisites

- [Docker](https://www.docker.com/) and Docker Compose
- [`just`](https://github.com/casey/just) (command runner)
- A `.env` file (see `.env.example`) if you want to run the backup commands against production —
  not needed just to run the app locally

## Usage

Start the local dev environment (Postgres + PostgREST + nginx serving the static app):

```sh
just up
```

The app is then available at `http://localhost:3000`. Local dev automatically points at the local
Postgres/PostgREST stack instead of production Supabase (`docker/local.config.js` is swapped in for
`js/config.js` at container build time), so it's safe to use freely without touching real data.

Other common commands:

| Command | What it does |
|---|---|
| `just up` | Build and start the dev stack in the background |
| `just up-anonymized` | Start the dev stack and restore the latest anonymized prod backup into it |
| `just down` | Stop containers, keep the Postgres data volume |
| `just down-flush` | Stop containers and wipe the Postgres data volume |
| `just up-restart` | `down-flush` + `up` — full reset |
| `just up-reload` | Rebuild/restart just the app container (static files), DB untouched |
| `just backup` | Back up the production Supabase DB to `backup/` |
| `just backup-anonymize` | Back up prod and produce an anonymized copy for local dev use |
| `just backup-clean` | Prune old backups, keeping the last few |

Run `just` with no arguments to list all available recipes.

## Testing

```sh
just test
```

Runs the suite in `tests/` (game creation/rebuy/results, history and leaderboard display, multi-game
debt settlement, chip-conservation validation, auto-close-on-settle) against the running dev stack,
driven from a throwaway Chromium container attached to the same Docker network the dev stack runs
on. It never touches `localhost:3000` directly — that also makes it work identically for an AI agent
that only has Docker access and no direct network route to published ports (see
[`.claude/CLAUDE.md`](.claude/CLAUDE.md)). `just test` starts the dev stack for you if it isn't
already running. Add or update a scenario in `tests/scenarios/` alongside any change to a critical
flow.

## Backups

Two independent backup mechanisms exist:

1. **`just backup` / `just backup-anonymize`** (`scripts/supabase_backup.py`,
   `scripts/anonymize_backup.py`) — pulls data via the Supabase REST API only (no direct DB
   connection needed), and can produce an anonymized copy (consistent pseudonyms for player/game
   names within a run) safe to restore into a local dev environment via `just up-anonymized`.
2. **`.github/workflows/backup.yml`** — a daily scheduled GitHub Action that runs `pg_dump` directly
   against the production DB and commits the gzipped dump to the `backups` branch, keeping 30 days
   of history. This is independent of the `just backup*` commands above.

## Git hooks

This repo ships hooks under `.githooks/` (not the default `.git/hooks/`), so they're versioned and
shared across clones. Enable them once per clone:

```sh
git config core.hooksPath .githooks
```

Currently included:

- **`pre-commit`** — asks two yes/no questions at commit time: whether you've updated the
  documentation, and whether you've added/updated tests for the change. It's a manual honesty check,
  not a diff-based linter — it doesn't inspect what you changed, it just asks. Answer honestly, or
  skip once with `git commit --no-verify` when a commit genuinely has no doc/test implications.

## Roadmap

See [`TODO.md`](TODO.md) for planned work and known issues.
