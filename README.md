## TODO
### Functional
- [x] refactor :))
- [x] [Iteration I] fix transactions calculation 
    - [x] add database retries
    - [x] add button "Посчитать долги за выбранные игры"
    - [x] add button "Выбрать все открытые игры"
- [x] Dockerize to make a dev env
- [ ] [Iteration II] Ensure correct transactions calculations and confirmation (Joja case)
    - [ ] anonymize original pgdump and reproduce
        - [x] find a way do make a dump
        - [ ] anonymize
        - [ ] integrate with dev
    - [ ] check if game gets closed when all the transactions completed
- [ ] fix bug with incorrect game counter display on button when switching between tabs (and other cases?)
- [ ] fix timer working while sleeping
- [ ] fix winrate bug (Eugen case WL 6/6, WR 46%)

### Infra
- [ ] fix backups
