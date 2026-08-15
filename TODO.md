## TODO
### Functional
- [x] refactor :))
- [x] [Iteration I] fix transactions calculation 
    - [x] add database retries
    - [x] add button "Посчитать долги за выбранные игры"
    - [x] add button "Выбрать все открытые игры"
    - [x] EXTRA: add button "Отменить выбор"
- [x] Dockerize to make a dev env
- [ ] [Iteration II] Ensure correct transactions calculations and confirmation (Joja case)
    - [x] anonymize original pgdump and reproduce
        - [x] find a way do make a dump
        - [x] anonymize
        - [x] integrate with dev
        - [x] understand incorrect behaviour nature and reproduce
        - [x] fix
    - [x] visualize paid/unpaid transactions
    - [ ] check if game gets closed when all the transactions completed
    - [x] recheck transactions validation
        - [x] block saving a cash game if `Σ final_chips !== Σ start_chips` (was previously only a visual hint, never enforced)
        - [x] `minimizeTransactions()` now detects and surfaces (doesn't silently drop) a leftover balance
    - [ ] deeper structural issue found & documented, not fixed: `docs/known-issue-payment-clamp-residual.md` — a payment covering a wider group of games than the current selection can clamp asymmetrically and drop real debts from the displayed list entirely (confirmed reproducible on prod data, even when selecting *all* games); root cause is the same as the `payments` schema gap below
    - [ ] make `payments` schema adequate for prod:
        - [ ] `payments.game_ids` is a comma-delimited text column (`,3,7,9,`) instead of a join table — no FK, no referential integrity, matched via `like.*,id,*`
        - [ ] `payments` isn't linked to `game_players`/`games` at all beyond that text blob — a payment can't be traced back to a specific settlement cleanly
        - [ ] `games.date_str` is free text, not a `date`/`timestamptz` column
        - [ ] and possibly others...
- [x] UI init:
    - [x] Claude, docs and doc `.githook`
    - [x] Supabase MCP
    - [x] Russian banwords doc
- [ ] fix issue with `tg` initialization on dev
- [ ] fix db connection issues
- [ ] fix timer working while sleeping
- [ ] fix winrate bug (Eugen case WL 6/6, WR 46%)
- [ ] player selection dropdown menu on game start
- [ ] EPIC: fix UI state bugs
    - [ ] fix bug with incorrect game counter display on button when switching between tabs
    - [ ] select/deselect button wrong behaviour when clicking other buttons
    - [ ] other cases...
- [ ] EPIC: add blackjack
- [ ] add tests for critical flows
- [ ] review and refactor documentation
- [ ] review and refactor logic to decouple business logic and view and improve readability and visibility
- [ ] simplify/make a tutorial for game saving

### Infra
- [ ] CI/CD
    - [ ] fix `.github/workflows/backup.yml` — daily scheduled backup is currently broken
    - [ ] refactor pipeline to avoid unnecessary runs
    - [ ] other improvements?
- [ ] test restoration after data corruption
- [x] Docs update hook
- [ ] version automation
    - [ ] index.html update hook
- [ ] add real alerting/error telemetry — `console.warn`/`console.error` are useless in prod, since the app runs inside the Telegram Mini App WebView and nobody has devtools open on it. Need something that actually reaches a human (e.g. Sentry, or a lightweight webhook/bot message on error). Known cases that currently only `console.warn` and would benefit:
    - `minimizeTransactions()`'s `_residual` detection (`js/results.js`) — see `docs/known-issue-payment-clamp-residual.md`
    - auto-close PATCH failures in `_doUpdateDebts()`/`settleDebt()` (`js/history.js`)
    - `sbFetch()` exhausted retries/timeouts — currently just pops a one-off `alert()`/`tg.showAlert()` dialog for whoever happens to be using the app at that moment; nothing is captured or persisted anywhere for a developer to see later
    - `tgSafeCall()` fallback triggering (`js/utils.js`) while genuinely inside real Telegram would mean the Telegram WebApp API itself errored — shouldn't happen, worth knowing if it ever does
    - a payment's `from_name`/`to_name` not matching any player in the current balance set — currently silently ignored (`if (payer)`/`if (payee)` guards in `js/history.js`), could mask a data issue like a name typo (this specific case would likely go away once the `payments` schema fix above lands with a real FK instead of free-text names — listed here since it's silent until then)

1. Прогнать апп руками и закоммитить, если всё ок — дифф: .claude/CLAUDE.md, .dockerignore, .githooks/pre-commit, README.md, TODO.md, index.html, js/{blind-timer,game,history,results,setup,utils}.js, justfile, плюс новые docs/known-issue-payment-clamp-residual.md и tests/.
2. Подумать над кейсом из докса — docs/known-issue-payment-clamp-residual.md: кламп платежей за несколько игр не гарантирует нулевую сумму и может прятать долги из списка даже при выборе всех игр разом (нашёл на реальных прод-данных). Не пофикшено, только предупреждение в UI.
