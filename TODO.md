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
    - [ ] visualize paid/unpaid transactions
    - [ ] check if game gets closed when all the transactions completed
    - [ ] recheck transactions validation
- [x] UI init:
    - [x] Claude, docs and doc `.githook`
    - [x] Supabase MCP
    - [x] Russian banwords doc
- [ ] fix db connection issues
- [ ] fix timer working while sleeping
- [ ] fix winrate bug (Eugen case WL 6/6, WR 46%)
- [ ] player selection dropdown menu on game start
- [ ] EPIC: fix UI state bugs
    - [ ] fix bug with incorrect game counter display on button when switching between tabs
    - [ ] select/deselect button wrong behaviour when clicking other buttons
    - [ ] other cases...

### Infra
- [ ] fix `.github/workflows/backup.yml` — daily scheduled backup is currently broken
- [ ] test restoration after data corruption
- [x] Docs update hook
- [ ] version automation
    - [ ] index.html update hook
