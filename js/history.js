var activePlayerFilter = null;
var allGamesCache = null;
var paymentsCache = null;

function switchTab(tabId, el) {
    if (tabId !== 'tab-history') { activePlayerFilter = null; allGamesCache = null; paymentsCache = null; }
    document.querySelectorAll('.tab-content').forEach(function (t) { t.style.display = 'none'; });
    document.querySelectorAll('.nav-tab').forEach(function (t) { t.classList.remove('active'); });
    document.getElementById(tabId).style.display = 'block';
    el.classList.add('active');
    if (tabId === 'tab-leaderboard') renderLeaderboard();
    if (tabId === 'tab-history') renderHistory();
}

function renderLeaderboard() {
    var lbDiv = document.getElementById('leaderboard-content');
    var statsDiv = document.getElementById('stats-content');
    lbDiv.innerHTML = '<div class="loading"><span class="spinner"></span>Загрузка...</div>';
    sbFetch('game_players?select=name,diff_rub').then(function (players) {
        if (!players || !players.length) {
            lbDiv.innerHTML = '<div class="empty-state">Нет сохранённых игр</div>';
            statsDiv.innerHTML = ''; return;
        }
        var agg = {};
        players.forEach(function (p) {
            if (!agg[p.name]) agg[p.name] = { name: p.name, games: 0, totalDiffRub: 0, wins: 0, losses: 0 };
            var a = agg[p.name];
            a.games++; a.totalDiffRub += p.diff_rub;
            if (p.diff_rub > 0.005) a.wins++;
            else if (p.diff_rub < -0.005) a.losses++;
        });
        var sorted = Object.values(agg).sort(function (a, b) { return b.totalDiffRub - a.totalDiffRub; });
        var medals = ['🥇', '🥈', '🥉'];
        lbDiv.innerHTML = '<table class="leader-table"><thead><tr><th>#</th><th>Игрок</th><th>Игры</th><th>W/L</th><th>WR%</th><th>Ср/игра</th><th>Итого р</th></tr></thead><tbody>' +
            sorted.map(function (p, i) {
                var cls = p.totalDiffRub > 0.005 ? 'pos' : p.totalDiffRub < -0.005 ? 'neg' : 'zero';
                var sign = p.totalDiffRub > 0 ? '+' : '';
                var wr = p.games > 0 ? Math.round(p.wins / p.games * 100) : 0;
                var avg = p.games > 0 ? p.totalDiffRub / p.games : 0;
                var avgSign = avg > 0.005 ? '+' : '';
                var avgCls = avg > 0.005 ? 'pos' : avg < -0.005 ? 'neg' : 'zero';
                return '<tr class="' + (i < 3 ? 'rank-' + (i + 1) : '') + '">' +
                    '<td>' + (i < 3 ? medals[i] : (i + 1) + '.') + '</td>' +
                    '<td><b>' + escHtml(p.name) + '</b></td>' +
                    '<td>' + p.games + '</td>' +
                    '<td>' + p.wins + '/' + p.losses + '</td>' +
                    '<td>' + wr + '%</td>' +
                    '<td class="' + avgCls + '">' + avgSign + avg.toFixed(2) + ' р</td>' +
                    '<td class="' + cls + '">' + sign + p.totalDiffRub.toFixed(2) + ' р</td></tr>';
            }).join('') + '</tbody></table>';
        return sbFetch('games?select=id').then(function (gamesCount) {
            statsDiv.innerHTML = '<div class="stats-grid">' +
                '<div class="stat-card"><div class="stat-val">' + (gamesCount ? gamesCount.length : 0) + '</div><div class="stat-label">Игр сыграно</div></div>' +
                '<div class="stat-card"><div class="stat-val">' + sorted.length + '</div><div class="stat-label">Игроков</div></div>' +
                '<div class="stat-card"><div class="stat-val" style="font-size:0.95rem">' + (sorted.length > 0 ? escHtml(sorted[0].name) : '—') + '</div><div class="stat-label">Лучший</div></div>' +
                '</div>';
        });
    }).catch(function () {
        lbDiv.innerHTML = '<div class="empty-state">Ошибка загрузки</div>';
    });
}

function getUniquePlayers(games) {
    var names = {};
    games.forEach(function (g) {
        (g.game_players || []).forEach(function (p) { names[p.name] = 1; });
    });
    return Object.keys(names).sort();
}

function setPlayerFilter(name) {
    activePlayerFilter = name || null;
    if (allGamesCache) renderHistoryCards(allGamesCache);
}

function renderHistoryCards(games) {
    var div = document.getElementById('history-content');
    var players = getUniquePlayers(games);
    var filtered = activePlayerFilter
        ? games.filter(function (g) {
            return (g.game_players || []).some(function (p) { return p.name === activePlayerFilter; });
        })
        : games;
    var filterHtml = '<div class="filter-pills">' +
        '<button class="filter-pill' + (activePlayerFilter === null ? ' active' : '') + '" onclick="setPlayerFilter(null)">Все</button>' +
        players.map(function (n) {
            return '<button class="filter-pill' + (activePlayerFilter === n ? ' active' : '') +
                '" onclick="setPlayerFilter(this.dataset.n)" data-n="' + escHtml(n) + '">' + escHtml(n) + '</button>';
        }).join('') + '</div>';

        var hasOpen = (allGamesCache || []).some(function (g) { return !g.is_closed; });
        var anyChecked = document.querySelectorAll('.game-checkbox:checked').length > 0;
        var selectOpenedBtn = hasOpen
            ? '<div id="select-opened-wrap" style="margin-bottom:10px;">' +
            (anyChecked
                ? '<div style="display:flex;gap:8px;">' +
                '<button class="btn btn-blue btn-sm" style="flex:1" onclick="selectAllOpened()">☑️ Выбрать все открытые игры</button>' +
                '<button class="btn btn-deselect btn-sm" style="flex:1" onclick="deselectAll()">✕ Отменить выбор</button>' +
                '</div>'
                : '<button class="btn btn-blue btn-full btn-sm" onclick="selectAllOpened()">☑️ Выбрать все открытые игры</button>'
            ) + '</div>'
            : '';

    if (!filtered.length) {
        div.innerHTML = filterHtml + selectOpenedBtn + '<div class="empty-state">Нет игр с этим игроком</div>';
    }
    div.innerHTML = filterHtml + selectOpenedBtn + filtered.map(function (g) {
        var sorted = (g.game_players || []).slice().sort(function (a, b) { return b.diff_rub - a.diff_rub; });
        var badge = g.is_closed
            ? '<span class="badge" style="background:var(--red);color:#fff;margin-left:6px;">Закрыта</span>'
            : '<span class="badge" style="background:var(--green-dark);color:var(--gold);margin-left:6px;">Открыта</span>';
        var checkbox = '<input type="checkbox" class="game-checkbox" data-id="' + g.id +
            '" style="width:18px;height:18px;margin-right:8px;cursor:pointer;accent-color:var(--gold);flex-shrink:0;">';
        var deleteBtn = '<button class="delete-game-btn" onclick="deleteGame(' + g.id + ')"' +
            (g.is_closed ? ' disabled style="opacity:0.4;cursor:not-allowed;"' : '') + '>Удалить</button>';
        var toggleBtn = '<button class="settle-btn" onclick="toggleClosed(' + g.id + ',' + !!g.is_closed + ')" style="margin-right:6px;">' +
            (g.is_closed ? 'Открыть' : 'Закрыть') + '</button>';
        return '<div class="history-card">' +
            '<div class="history-card-header" style="flex-wrap:wrap;gap:8px;">' +
            '<div style="display:flex;align-items:center;flex:1;min-width:0;">' +
            checkbox +
            '<div><div class="history-card-title">' + escHtml(g.name) + badge + '</div>' +
            '<div class="history-card-date">' + (g.date_str || '') + '</div></div>' +
            '</div>' +
            '<div style="display:flex;gap:6px;align-items:center;flex-shrink:0;">' + toggleBtn + deleteBtn + '</div>' +
            '</div>' +
            '<table class="history-mini-table"><thead><tr><th>Игрок</th><th>Вложил</th><th>Итог</th><th>+-р</th></tr></thead><tbody>' +
            sorted.map(function (p) {
                var cls = p.diff_rub > 0.005 ? 'pos' : p.diff_rub < -0.005 ? 'neg' : 'zero';
                var sign = p.diff_rub > 0 ? '+' : '';
                var rowStyle = activePlayerFilter && p.name === activePlayerFilter
                    ? ' style="background:rgba(240,192,64,0.07);"' : '';
                return '<tr' + rowStyle + '><td>' + escHtml(p.name) + '</td><td>' + p.start_chips +
                    '</td><td>' + p.final_chips + '</td><td class="' + cls + '">' + sign + p.diff_rub.toFixed(2) + ' р</td></tr>';
            }).join('') + '</tbody></table></div>';
    }).join('');

    var calcPanel = document.getElementById('calc-debts-panel');
    if (!calcPanel) {
        calcPanel = document.createElement('div');
        calcPanel.id = 'calc-debts-panel';
        calcPanel.style.cssText = 'position:sticky;bottom:0;background:var(--card-bg);border:1px solid var(--card-border);border-radius:14px 14px 0 0;padding:14px 16px;z-index:199;display:none;max-width:600px;width:100%;';
        calcPanel.style.margin = '12px auto 0';
        calcPanel.innerHTML = '<button class="btn btn-gold btn-full" onclick="_doUpdateDebts()">💰 Посчитать долги за выбранные игры</button>';
        document.getElementById('tab-history').appendChild(calcPanel);
    }

    document.querySelectorAll('.game-checkbox').forEach(function (cb) {
        cb.addEventListener('change', function () {
            var anyChecked = document.querySelectorAll('.game-checkbox:checked').length > 0;
            var debtsPanel = document.getElementById('debts-panel');
            var calcPanel = document.getElementById('calc-debts-panel');
            if (!anyChecked) {
                if (debtsPanel) debtsPanel.remove();
                if (calcPanel) calcPanel.style.display = 'none';
            } else {
                if (calcPanel) calcPanel.style.display = '';
                if (debtsPanel) debtsPanel.remove(); // сбрасываем старые долги при смене выбора
            }
            updateCalcBtnLabel();
            updateSelectOpenedWrap();
        });
    });
}

function renderHistory() {
    var div = document.getElementById('history-content');
    div.innerHTML = '<div class="loading"><span class="spinner"></span>Загрузка...</div>';
    sbFetch('games?select=id,name,date_str,is_closed,game_players(name,start_chips,final_chips,diff_rub)&order=created_at.desc')
        .then(function (games) {
            if (!games || !games.length) { div.innerHTML = '<div class="empty-state">История пуста</div>'; return; }
            allGamesCache = games;
            renderHistoryCards(games);
        }).catch(function () {
            div.innerHTML = '<div class="empty-state">Ошибка загрузки</div>';
        });
}

function toggleClosed(gameId, isClosed) {
    sbFetch('games?id=eq.' + gameId, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify({ is_closed: !isClosed })
    }).then(function () { renderHistory(); })
      .catch(function (e) { showAlert('Ошибка: ' + e.message); });
}

function aggregateBalances(players) {
    var agg = {};
    players.forEach(function (p) {
        if (!agg[p.name]) agg[p.name] = { name: p.name, balance: 0 };
        agg[p.name].balance += (p.diff_rub || 0);
    });
    return Object.values(agg);
}

function getPayments() {
    if (paymentsCache) return Promise.resolve(paymentsCache);
    return sbFetch('payments?select=from_name,to_name,amount,game_ids').then(function (p) {
        paymentsCache = p || []; return paymentsCache;
    });
}

function _doUpdateDebts() {
    var selected = Array.from(document.querySelectorAll('.game-checkbox:checked'))
        .map(function (cb) { return cb.dataset.id; });
    var panel = document.getElementById('debts-panel');
    if (!selected.length) { if (panel) panel.remove(); return; }

    // Создать панель если ещё не существует
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'debts-panel';
        panel.style.cssText = 'position:sticky;bottom:0;background:var(--card-bg);border:1px solid var(--card-border);border-radius:14px 14px 0 0;padding:14px 16px;z-index:200;max-width:600px;width:100%;';
        panel.style.margin = '12px auto 0';
        document.getElementById('tab-history').appendChild(panel);
    }

    // Лоадер
    panel.innerHTML = '<div class="loading"><span class="spinner"></span>Считаем долги...</div>';
    var calcPanel = document.getElementById('calc-debts-panel');
    if (calcPanel) calcPanel.style.display = 'none';

    Promise.all([
        sbFetch('game_players?game_id=in.(' + selected.join(',') + ')&select=name,diff_rub'),
        getPayments()
    ]).then(function (results) {
        var players = results[0], allPayments = results[1] || [];
        if (!players || !players.length) return;
        var balances = aggregateBalances(players);
        var txs = minimizeTransactions(balances);
        var displayTxs = txs.map(function (t) {
            var paid = allPayments.filter(function (p) {
                if (p.from_name !== t.from || p.to_name !== t.to) return false;
                if (!p.game_ids) return false;
                return selected.some(function (gid) { return p.game_ids.indexOf(',' + gid + ',') !== -1; });
            }).reduce(function (s, p) { return s + Number(p.amount); }, 0);
            return { from: t.from, to: t.to, original: t.amount, remaining: Math.max(0, t.amount - paid) };
        }).filter(function (t) { return t.remaining > 0.005; })
          .filter(function (t) {
              return !activePlayerFilter || t.from === activePlayerFilter || t.to === activePlayerFilter;
          });

        // скрываем кнопку "Посчитать", т.к. показываем результат
        var calcPanel = document.getElementById('calc-debts-panel');
        if (calcPanel) calcPanel.style.display = 'none';

        var titleLabel = activePlayerFilter
            ? 'Долги ' + escHtml(activePlayerFilter) + ' за ' + selected.length + ' игр:'
            : 'Итоговые долги за ' + selected.length + ' игр:';
        var html = '<div style="color:var(--gold);font-weight:700;margin-bottom:10px;">' + titleLabel + '</div>';
        if (!displayTxs.length) {
            html += '<div style="color:var(--green-light);">✅ Все долги оплачены!</div>';
        } else {
            html += '<ul class="transactions" style="margin:0;">' +
                displayTxs.map(function (t) {
                    return '<li>' +
                        '<span><b>' + escHtml(t.from) + '</b></span>' +
                        '<span class="arrow">→</span>' +
                        '<span><b>' + escHtml(t.to) + '</b></span>' +
                        '<span class="amount">' + t.remaining.toFixed(2) + ' р</span>' +
                        '<button class="settle-btn" onclick="settleDebt(\'' + escHtml(t.from) + '\',\'' + escHtml(t.to) + '\',' + t.remaining.toFixed(2) + ')">✓ Оплатил</button>' +
                        '</li>';
                }).join('') + '</ul>';
        }
        panel.innerHTML = html;
    }).catch(function (e) { showAlert('Ошибка расчёта долгов: ' + e.message); });
}

function settleDebt(fromName, toName, amount) {
    var selectedIds = Array.from(document.querySelectorAll('.game-checkbox:checked'))
        .map(function (cb) { return cb.dataset.id; });
    var gameIdsStr = ',' + selectedIds.join(',') + ',';
    var confirmMsg = fromName + ' оплатил ' + Number(amount).toFixed(2) + ' р → ' + toName + '?';
    function doSettle() {
        sbFetch('payments', {
            method: 'POST',
            body: JSON.stringify({ from_name: fromName, to_name: toName, amount: amount, game_ids: gameIdsStr })
        }).then(function () {
            paymentsCache = null;
            if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
            _doUpdateDebts();
        }).catch(function (e) { showAlert(e.message); });
    }
    if (tg && tg.showConfirm) { tg.showConfirm(confirmMsg, function (ok) { if (ok) doSettle(); }); }
    else { if (confirm(confirmMsg)) doSettle(); }
}

function deleteGame(gameId) {
    function executeDelete() {
        sbFetch('game_players?game_id=eq.' + gameId, { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } })
            .then(function () {
                return sbFetch('games?id=eq.' + gameId, { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } });
            }).then(function () {
                return sbFetch('payments?game_ids=like.*,' + gameId + ',*', { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } })
                    .catch(function () {});
            }).then(function () {
                paymentsCache = null; renderHistory();
            }).catch(function (e) { showAlert('Ошибка удаления: ' + e.message); });
    }
    if (tg && tg.showConfirm) { tg.showConfirm('Удалить эту игру?', function (ok) { if (ok) executeDelete(); }); }
    else { if (confirm('Удалить эту игру?')) executeDelete(); }
}

function updateCalcBtnLabel() {
    var btn = document.querySelector('#calc-debts-panel .btn');
    if (!btn) return;
    var count = document.querySelectorAll('.game-checkbox:checked').length;
    btn.textContent = count > 0
        ? '💰 Посчитать долги за выбранные игры (' + count + ')'
        : '💰 Посчитать долги за выбранные игры';
}

function selectAllOpened() {
    var anySelected = false;
    document.querySelectorAll('.game-checkbox').forEach(function (cb) {
        var gameId = cb.dataset.id;
        var game = allGamesCache && allGamesCache.find(function (g) { return String(g.id) === String(gameId); });
        if (game && !game.is_closed) {
            cb.checked = true;
            anySelected = true;
        }
    });
    if (anySelected) {
        var calcPanel = document.getElementById('calc-debts-panel');
        if (calcPanel) calcPanel.style.display = '';
        var debtsPanel = document.getElementById('debts-panel');
        if (debtsPanel) debtsPanel.remove();
        updateCalcBtnLabel();
        updateSelectOpenedWrap();
    }
}

function deselectAll() {
    document.querySelectorAll('.game-checkbox').forEach(function (cb) {
        cb.checked = false;
    });
    var calcPanel = document.getElementById('calc-debts-panel');
    if (calcPanel) calcPanel.style.display = 'none';
    var debtsPanel = document.getElementById('debts-panel');
    if (debtsPanel) debtsPanel.remove();
    updateCalcBtnLabel();
    if (allGamesCache) renderHistoryCards(allGamesCache);
}

function updateSelectOpenedWrap() {
    var wrap = document.getElementById('select-opened-wrap');
    if (!wrap) return;
    var hasOpen = (allGamesCache || []).some(function (g) { return !g.is_closed; });
    if (!hasOpen) return;
    var anyChecked = document.querySelectorAll('.game-checkbox:checked').length > 0;
    if (anyChecked) {
        wrap.innerHTML =
            '<div style="display:flex;gap:8px;">' +
            '<button class="btn btn-blue btn-sm" style="flex:1" onclick="selectAllOpened()">☑️ Выбрать все открытые игры</button>' +
            '<button class="btn btn-deselect btn-sm" style="flex:1" onclick="deselectAll()">✕ Отменить выбор</button>' +
            '</div>';
    } else {
        wrap.innerHTML =
            '<button class="btn btn-blue btn-full btn-sm" onclick="selectAllOpened()">☑️ Выбрать все открытые игры</button>';
    }
}
