# Known issue: multi-game payment clamping can leave a residual / drop debts from view

Status: **fixed 2026-08-19** — see "Resolution" at the end of this doc. Originally documented
2026-08-04 while investigating the `- [ ] recheck transactions validation` TODO item; the sections
below (background, confirmed prod-data cases, root cause) are kept as historical record of the
analysis that led to the fix.

## Background

`_doUpdateDebts()` aggregates `diff_rub` across whichever games are currently checked in
the history tab, then nets out recorded `payments` against that aggregate. Because
`payments.game_ids` is a comma-delimited text blob with no real relational tie to
`game_players` (see the existing schema-debt TODO item), a payment's recorded `amount` is
applied to *whatever the current view's aggregate balance happens to be* for the payer/
payee names — clamped per-side so it can never push a balance past zero (this clamp was
added earlier to fix a sign-flip bug: see `js/history.js` around line 261).

The clamp is safe against sign-flips, but it does **not** guarantee `Σ balances == 0`
after being applied, and it is **order-dependent** (payments are applied one at a time in
whatever order `payments?select=...` returns them, no explicit `ORDER BY`).

## Confirmed via prod data (Supabase MCP, 2026-08-04)

1. **No existing game is chip-imbalanced.** `select game_id, sum(diff_rub) from game_players group by game_id having abs(sum(diff_rub)) > 1` returns zero rows. The new save-time chip-conservation check (workstream A) is preventative, not a fix for already-corrupted data.

2. **Narrow selection after a wide combined payment silently drops debts.** Payment id=15
   (`Varya→Yulia, 131.5₽, game_ids=",53,52,51,"`) plus id=14 (`Dima→Yulia, 84₽`, same
   `game_ids`) were recorded against the combined group of games 51+52+53. Selecting
   **game 51 alone** in the UI: the clamp zeroes out Varya's and Yulia's balances using
   amounts that were really meant for the *whole* 3-game group, leaving a lone
   `Roma → Dima 2₽` transaction — and **Eugen's (-66₽) and Mila's (-6.5₽) real debts
   for game 51 vanish from the list entirely** (no creditor left in the narrowed view
   large enough to match them against). Residual detected: ~-157.5₽.

3. **Even selecting literally every game in the database doesn't zero out.** Manually
   simulated the full aggregate (12 players, all 45 games, all 8 real payments) applying
   payments in `id` order: the clamp reduces the effect of payment id=9
   (`Jojo→Dima, 161.5₽, game_ids=",27,"`) to *zero*, because in the full lifetime
   aggregate Jojo is a net creditor (+58₽ overall) and Dima a net debtor (-1026.5₽
   overall) — the **opposite** direction from what that specific payment represents for
   game 27 alone (where Jojo really did owe Dima 161.5₽, and correctly paid it). The
   per-name clamp has no way to know this payment was valid in its original narrow
   context; it just no-ops it against the wrong-signed aggregate. Result: a **147₽**
   residual even in the "select everything" case. This amount is itself an artifact of
   payment application order, since the clamp isn't commutative across multiple payments
   touching the same names.

## Why this happens (root cause)

Payments aren't tied to specific games/players relationally — a payment is just
"someone paid someone X₽, allegedly covering this set of game ids." There's no way to
correctly attribute *how much of that payment* belongs to which game or which pairwise
debt once you view a different subset of games than the payment was originally computed
against. The clamp is a safety net (prevents wrong-direction display), not a real fix.

This is the same underlying gap already tracked in `TODO.md`:
> `payments` isn't linked to `game_players`/`games` at all beyond that text blob — a
> payment can't be traced back to a specific settlement cleanly

## Possible directions (not decided, for later)

- Proper relational schema for payments (join table tying a payment to the specific
  game_player rows / pairwise debts it settles) — the "real" fix, but a bigger schema
  migration (already scoped as its own TODO item).
- Compute/cache a canonical "current balance" per player at settle time rather than
  recomputing from raw `diff_rub` + replaying every payment on every view.
- Some order-independent reconciliation instead of a naive per-payment clamp (e.g.
  solve as a linear system / min-cost-flow across all known payments and balances for
  the selected scope, instead of greedily applying payments one at a time).

## What shipped originally (2026-08-04, superseded by the 2026-08-19 fix below)

Just the warning note (`_residual` on `minimizeTransactions()`'s return, surfaced in
`_doUpdateDebts()`'s panel) so a discrepancy is visible instead of silently wrong — no
attempt to actually reconcile it. `console.warn` isn't useful in prod (runs inside the
Telegram Mini App WebView, nobody's watching devtools) — see the `Infra` TODO item about
adding real alerting/telemetry, which lists this as one motivating case. This generic warning
was removed once the actual fix (see "Resolution" below) shipped, since it can no longer
legitimately fire.

---

# Известная проблема: кламп платежей за несколько игр может давать остаток / прятать долги

Статус: **пофикшено 2026-08-19** — см. раздел "Решение" в конце документа. Изначально
задокументировано 2026-08-04 в ходе разбора задачи `- [ ] recheck transactions validation`;
разделы ниже (контекст, подтверждённые кейсы на прод-данных, первопричина) сохранены как
историческая запись анализа, который привёл к фиксу.

## Контекст

`_doUpdateDebts()` суммирует `diff_rub` по отмеченным в истории играм, а затем вычитает
из этой суммы уже записанные `payments`. Поскольку `payments.game_ids` — это
comma-delimited текстовое поле без реальной связи с `game_players` (см. существующий
пункт про долг по схеме в TODO.md), сумма конкретного платежа применяется к **тому
балансу, который есть в текущей выборке** для имён плательщика/получателя — с клампом
по каждой стороне, чтобы баланс не мог развернуться в другую сторону (этот кламп добавили
раньше, чтобы починить баг с разворотом знака: см. `js/history.js`, около строки 261).

Кламп безопасен от разворота знака, но **не гарантирует** `Σ balances == 0` после
применения, и он **зависит от порядка** (платежи применяются по одному в том порядке,
в котором их вернул `payments?select=...` — без явного `ORDER BY`).

## Подтверждено на проде (Supabase MCP, 2026-08-04)

1. **Ни одна существующая игра не разбалансирована по фишкам.**
   `select game_id, sum(diff_rub) from game_players group by game_id having abs(sum(diff_rub)) > 1`
   не вернул ни одной строки. Новая проверка баланса фишек при сохранении (пункт A)
   превентивная, а не чинит уже испорченные данные.

2. **Узкая выборка после широкого общего платежа молча теряет долги.** Платёж id=15
   (`Varya→Yulia, 131.5₽, game_ids=",53,52,51,"`) и id=14 (`Dima→Yulia, 84₽`, тот же
   `game_ids`) были записаны на комбинированную группу игр 51+52+53. Если выбрать
   **только игру 51**: кламп обнуляет балансы Varya и Yulia суммами, которые на самом
   деле относились ко всей группе из 3 игр, в списке остаётся только одна транзакция
   `Roma → Dima 2₽` — а **реальные долги Eugen (-66₽) и Mila (-6.5₽) за игру 51
   полностью пропадают из списка** (в узкой выборке не осталось кредитора, достаточно
   крупного, чтобы сматчиться с ними). Обнаруженный остаток: ~-157.5₽.

3. **Даже выбор буквально всех игр в базе не даёт ноль.** Вручную просимулировал полную
   агрегацию (12 игроков, все 45 игр, все 8 реальных платежей), применяя платежи в
   порядке `id`: кламп обнуляет эффект платежа id=9 (`Jojo→Dima, 161.5₽,
   game_ids=",27,"`) **полностью**, потому что в полной агрегации за всю историю Jojo —
   нетто-кредитор (+58₽ в целом), а Dima — нетто-должник (-1026.5₽ в целом) —
   **противоположное** направление тому, что этот конкретный платёж означал для игры 27
   (где Jojo действительно был должен Dima 161.5₽ и корректно их отдал). Кламп по имени
   никак не может знать, что этот платёж был валиден в своём исходном узком контексте —
   он просто обнуляет его эффект против агрегата с противоположным знаком. Итог:
   остаток **147₽** даже в сценарии «выбрать всё». Сама эта сумма — артефакт порядка
   применения платежей, так как кламп не коммутативен при нескольких платежах между
   одними и теми же именами.

## Почему так происходит (первопричина)

Платежи не привязаны к конкретным играм/игрокам реляционно — платёж это просто «кто-то
заплатил кому-то X₽, предположительно покрывая вот этот набор id игр». Нет способа
корректно определить, какая часть этого платежа относится к какой игре или к какому
конкретному парному долгу, если смотреть на другое подмножество игр, чем то, для
которого платёж изначально считался. Кламп — это защита (не даёт показать неправильное
направление), а не настоящий фикс.

Это та же самая проблема, что уже отмечена в `TODO.md`:
> `payments` isn't linked to `game_players`/`games` at all beyond that text blob — a
> payment can't be traced back to a specific settlement cleanly

## Возможные направления (не решено, на будущее)

- Нормальная реляционная схема для платежей (join-таблица, привязывающая платёж к
  конкретным строкам `game_players`/парным долгам, которые он закрывает) — «настоящий»
  фикс, но более крупная миграция схемы (уже отдельным пунктом в TODO.md).
- Считать/кэшировать канонический «текущий баланс» на игрока в момент оплаты, а не
  пересчитывать заново из сырых `diff_rub` + проигрывать все платежи при каждом
  просмотре.
- Какая-то независимая от порядка реконсиляция вместо наивного клампа по одному платежу
  (например, решать как линейную систему / min-cost-flow по всем известным платежам и
  балансам в рамках выбранной области, вместо жадного применения платежей по одному).

## Что уехало в релиз изначально (2026-08-04, заменено фиксом от 2026-08-19 ниже)

Только предупреждающая заметка (`_residual` у результата `minimizeTransactions()`,
показывается в панели `_doUpdateDebts()`), чтобы расхождение было видно, а не тихо
неправильным — без попытки реально реконсилировать. `console.warn` бесполезен в проде
(выполняется внутри WebView Telegram Mini App, там никто не смотрит devtools) — см.
пункт `Infra` в TODO.md про добавление настоящего алертинга/телеметрии, где этот
случай указан как один из мотивирующих. Эта общая заметка была убрана, когда вышел
настоящий фикс (см. «Решение» ниже) — она больше не может законно сработать.

# Resolution (2026-08-19)

Verified against real production data (via the Supabase MCP, read-only) before implementing: none
of the payment-linked game groups that motivated this doc were actually fully settled — each has
genuine, non-clamp-artifact unpaid debt (e.g. ~300₽ still owed across games 27+28+29, ~258₽
combined across games 51+52+53). This ruled out "just mark payment-referenced games closed" — it
would have hidden real money owed between friends. The `payments` rows themselves were never
corrupted; only the clamp-based *reading* of them was broken.

The actual fix, in `js/history.js`'s `computeRemainingDebt()`: a payment is only ever applied if
its **entire** `game_ids` set is a subset of the currently selected games (`.every()`), never merely
overlapping (the old `.some()` check) — and once that's guaranteed, the full amount is applied
**unclamped** (no `Math.min`/`Math.max` capping). This is always safe: every game's own `diff_rub`
sums to zero (enforced at save time), and an unclamped transfer conserves that sum, so a
fully-contained payment can never flip a balance's sign or lose real debt. A payment that only
partially overlaps the current selection is skipped entirely (never partially/wrongly applied) and
surfaced via a specific note naming exactly which games are missing, with a one-click "Добавить
игры" button to add them. History cards for any game touched by a multi-game payment also show a
"🔗 Общий платёж с играми: …" hint with a one-click "Выбрать группу" button, so a user never loses
the ability to look at a single game on its own while still having an easy, honest way to see the
complete picture.

This required **no schema change and no data migration** — the same logic fix handles both the
existing (legacy) payments and guarantees no clamp/residual can occur for any future payment either.
Verified exactly (to the cent) against the real anonymized production backup via `just
up-anonymized` for all four affected game groups; see `tests/scenarios/03-multi-game-debts.test.js`,
`tests/scenarios/06-auto-close-on-settle.test.js` and `tests/scenarios/07-linked-game-groups.test.js`
for the automated regression coverage.

# Решение (2026-08-19)

Перед реализацией фикса были проверены реальные прод-данные (через Supabase MCP, read-only): ни
одна из групп игр, связанных общим платежом и упомянутых в этом докe, на самом деле не была
полностью погашена — в каждой есть настоящий, не являющийся артефактом клампа непогашенный долг
(например, ~300₽ по играм 27+28+29, ~258₽ суммарно по играм 51+52+53). Это исключило вариант
«просто закрыть игры, упомянутые в платежах» — так можно было бы спрятать реальные деньги, которые
друзья ещё должны друг другу. Сами записи в `payments` никогда не были испорчены — была сломана
только логика их *чтения*.

Настоящий фикс, в `computeRemainingDebt()` (`js/history.js`): платёж применяется только если его
**весь** `game_ids` целиком входит в текущую выборку игр (`.every()`), а не просто пересекается с
ней (старая проверка `.some()`) — и как только это гарантировано, вся сумма применяется **без
клампа** (без `Math.min`/`Math.max`). Это всегда безопасно: сумма `diff_rub` по каждой отдельной
игре равна нулю (это гарантируется при сохранении игры), а перевод без клампа сохраняет эту сумму —
значит, полностью укладывающийся в выборку платёж никогда не может развернуть баланс не в ту сторону
или потерять реальный долг. Платёж, который лишь частично пересекается с текущей выборкой, вообще не
применяется (никогда не применяется частично/неверно) и показывается отдельной заметкой с точным
списком недостающих игр и кнопкой «Добавить игры» в один клик. На карточках игр, затронутых
групповым платежом, также показывается подсказка «🔗 Общий платёж с играми: …» с кнопкой «Выбрать
группу» — так что пользователь никогда не теряет возможность посмотреть одну игру отдельно, но при
этом легко может увидеть честную полную картину.

Это не потребовало **никакой миграции схемы и никакой миграции данных** — одна и та же логика
одновременно чинит уже существующие (старые) платежи и гарантирует, что кламп/остаток больше не
может возникнуть ни для одного будущего платежа. Сверено с точностью до копейки с реальным
анонимизированным прод-бэкапом через `just up-anonymized` по всем четырём затронутым группам игр;
автоматизированное регрессионное покрытие — в `tests/scenarios/03-multi-game-debts.test.js`,
`tests/scenarios/06-auto-close-on-settle.test.js` и `tests/scenarios/07-linked-game-groups.test.js`.
