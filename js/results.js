function minimizeTransactions(balances) {
    var eps = 0.005;
    var debtors = balances.filter(function (b) { return b.balance < -eps; })
        .map(function (b) { return Object.assign({}, b); })
        .sort(function (a, b) { return a.balance - b.balance; });
    var creditors = balances.filter(function (b) { return b.balance > eps; })
        .map(function (b) { return Object.assign({}, b); })
        .sort(function (a, b) { return b.balance - a.balance; });
    var txs = [], di = 0, ci = 0;
    while (di < debtors.length && ci < creditors.length) {
        var d = debtors[di], c = creditors[ci];
        var amount = Math.min(-d.balance, c.balance);
        if (amount > eps) txs.push({ from: d.name, to: c.name, amount: amount });
        d.balance += amount; c.balance -= amount;
        if (Math.abs(d.balance) < eps) di++;
        if (Math.abs(c.balance) < eps) ci++;
    }
    return txs;
}

function updatePrizePreview() {
    var preview = document.getElementById('prize-preview');
    if (!preview) return;
    var p1sel = document.getElementById('place1-select');
    var p2sel = document.getElementById('place2-select');
    if (!p1sel) return;
    var p1 = p1sel.value, p2 = p2sel ? p2sel.value : null;
    if (p1 === p2 && p2 !== null) {
        preview.innerHTML = '⚠️ 1-е и 2-е место — один игрок!';
        preview.style.background = 'var(--red)'; return;
    }
    var pool = state.buyIn * state.players.length;
    var prize2 = state.payoutScheme === 'top2' ? state.place2Prize : 0;
    var prize1 = pool - prize2;
    var lines = state.players.map(function (p) {
        var d = p.name === p1 ? prize1 - state.buyIn : p.name === p2 ? prize2 - state.buyIn : -state.buyIn;
        var sign = d >= 0 ? '+' : '';
        var cls = d > 0 ? 'color:var(--green-light)' : d < 0 ? 'color:var(--red)' : '';
        return '<span style="' + cls + '">' + escHtml(p.name) + ': ' + sign + d + ' р</span>';
    });
    preview.innerHTML = lines.join(' &nbsp;|&nbsp; ');
    preview.style.background = 'var(--green-dark)';
}

function showFinalScreen() {
    showPage('page-result');
    document.getElementById('final-input-section').style.display = 'block';
    document.getElementById('results-section').style.display = 'none';
    var container = document.getElementById('final-inputs');
    container.innerHTML = '';
    if (state.mode === 'tournament') {
        var playerOptions = state.players.map(function (p) {
            return '<option value="' + escHtml(p.name) + '">' + escHtml(p.name) + '</option>';
        }).join('');
        var prize2 = state.payoutScheme === 'top2' ? state.place2Prize : 0;
        var prize1 = state.buyIn * state.players.length - prize2;
        var p2PrizeLabel = state.payoutScheme === 'top2'
            ? ' <span class="place-prize">+' + (state.place2Prize - state.buyIn).toFixed(0) + ' р</span>' : '';
        container.innerHTML =
            '<div class="place-row">' +
            '<span class="place-medal">🥇</span>' +
            '<span class="place-label">1-е место</span>' +
            '<select id="place1-select" class="place-select" onchange="updatePrizePreview()">' + playerOptions + '</select>' +
            '<span class="place-prize">+' + (prize1 - state.buyIn).toFixed(0) + ' р</span>' +
            '</div>' +
            (state.payoutScheme === 'top2' ?
                '<div class="place-row">' +
                '<span class="place-medal">🥈</span>' +
                '<span class="place-label">2-е место</span>' +
                '<select id="place2-select" class="place-select" onchange="updatePrizePreview()">' + playerOptions + '</select>' +
                p2PrizeLabel +
                '</div>' : '') +
            '<div id="prize-preview" class="alert" style="background:var(--green-dark);margin-top:8px"></div>';
        if (state.players.length > 1 && document.getElementById('place2-select')) {
            document.getElementById('place2-select').selectedIndex = 1;
        }
        updatePrizePreview();
    } else {
        state.players.forEach(function (p, i) {
            var row = document.createElement('div');
            row.className = 'final-row';
            var lbl = document.createElement('label'); lbl.textContent = p.name;
            var inp = document.createElement('input');
            inp.type = 'number'; inp.id = 'final-' + i;
            inp.value = p.currentChips; inp.min = 0;
            inp.setAttribute('inputmode', 'numeric');
            inp.oninput = updateChipsSum;
            row.appendChild(lbl); row.appendChild(inp);
            container.appendChild(row);
        });
        updateChipsSum();
    }
}

function updateChipsSum() {
    var total = state.players.reduce(function (s, _, i) {
        var el = document.getElementById('final-' + i);
        return s + (el ? (parseInt(el.value) || 0) : 0);
    }, 0);
    var invested = state.players.reduce(function (s, p) { return s + p.startChips; }, 0);
    var diff = total - invested;
    var el = document.getElementById('chips-sum-live');
    el.innerHTML = diff === 0
        ? 'Сумма: <b style="color:#60e080">' + total + '</b> = ' + invested + ' (OK ✓)'
        : 'Сумма: <b style="color:#f0a040">' + total + '</b>, нужно ' + invested + ' (разница: ' + (diff > 0 ? '+' : '') + diff + ')';
}

function showResultsSection(playerResults) {
    var sorted = playerResults.slice().sort(function (a, b) { return b.diffRub - a.diffRub; });
    var bi = document.getElementById('chips-balance-info');
    bi.innerHTML = state.mode === 'tournament'
        ? '🏆 Турнир · Бай-ин ' + state.buyIn + ' р · Пул ' + (state.buyIn * state.players.length) + ' р'
        : 'Баланс: ' + state.players.reduce(function (s, p) { return s + (p.finalChips || 0); }, 0) + ' фишек';
    bi.style.color = '#60e080';
    document.getElementById('result-tbody').innerHTML = sorted.map(function (p) {
        var cls = p.diffRub > 0.005 ? 'pos' : p.diffRub < -0.005 ? 'neg' : 'zero';
        var sign = p.diffRub > 0 ? '+' : '';
        var startVal = state.mode === 'tournament' ? state.buyIn + ' р' : p.startChips;
        var finalVal = state.mode === 'tournament'
            ? (p.diffRub >= 0 ? (state.buyIn + p.diffRub) + ' р' : '—')
            : (p.finalChips !== null ? p.finalChips : '—');
        return '<tr><td><b>' + escHtml(p.name) + '</b></td><td>' + startVal + '</td><td>' + finalVal +
            '</td><td class="' + cls + '">' + sign + p.diffRub.toFixed(2) + ' р</td></tr>';
    }).join('');
    var txs = minimizeTransactions(playerResults.map(function (p) {
        return { name: p.name, balance: p.diffRub };
    }));
    var txList = document.getElementById('transactions-list');
    txList.innerHTML = '';
    if (!txs.length) {
        txList.innerHTML = '<li>Все в расчёте! ✅</li>';
    } else {
        txs.forEach(function (t, idx) {
            var li = document.createElement('li'); li.id = 'tx-' + idx;
            li.innerHTML =
                '<span><b>' + escHtml(t.from) + '</b></span>' +
                '<span class="arrow">→</span>' +
                '<span><b>' + escHtml(t.to) + '</b></span>' +
                '<span class="amount">' + t.amount.toFixed(2) + ' р</span>' +
                '<button class="settle-btn" onclick="settleTx(' + idx + ')">OK</button>';
            txList.appendChild(li);
        });
    }
    document.getElementById('final-input-section').style.display = 'none';
    document.getElementById('results-section').style.display = 'block';
    if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
}

function calculateResults() {
    if (state.mode === 'tournament') {
        var p1Name = document.getElementById('place1-select').value;
        var p2Name = state.payoutScheme === 'top2' ? document.getElementById('place2-select').value : null;
        if (p2Name && p1Name === p2Name) { showAlert('1-е и 2-е место не может быть один игрок!'); return; }
        var pool = state.buyIn * state.players.length;
        var prize2 = state.payoutScheme === 'top2' ? state.place2Prize : 0;
        var prize1 = pool - prize2;
        var results = state.players.map(function (p) {
            var prize = p.name === p1Name ? prize1 : p.name === p2Name ? prize2 : 0;
            p.diffRub = prize - state.buyIn;
            p.finalChips = prize;
            return p;
        });
        showResultsSection(results);
    } else {
        var finals = state.players.map(function (p, i) {
            var el = document.getElementById('final-' + i);
            var v = parseInt(el.value);
            if (el.value === '' || isNaN(v) || v < 0) {
                showAlert('Введите корректное кол-во фишек для ' + p.name);
                throw '';
            }
            return v;
        });
        state.players.forEach(function (p, i) {
            p.finalChips = finals[i];
            p.diffRub = (finals[i] - p.startChips) / state.chipsPerRub;
        });
        showResultsSection(state.players);
    }
}

function settleTx(idx) {
    var li = document.getElementById('tx-' + idx);
    li.classList.add('settled');
    li.querySelector('.settle-btn').disabled = true;
    if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
}

function saveAndNewGame() {
    var btn = document.getElementById('save-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Сохраняем...';
    var safetyTimer = setTimeout(function () {
        btn.disabled = false; btn.innerHTML = '💾 Сохранить и новая игра';
    }, 15000);
    sbFetch('games', {
        method: 'POST',
        body: JSON.stringify({
            name: state.gameName,
            date_str: formatDate(new Date()),
            chips_per_rub: state.chipsPerRub,
            mode: state.mode,
            buy_in: state.buyIn
        })
    }).then(function (games) {
        var gameId = games[0].id;
        var playersData = state.players.map(function (p) {
            var fc = (p.finalChips !== null && p.finalChips !== undefined) ? p.finalChips : p.currentChips;
            var diffRub = (p.diffRub !== null && p.diffRub !== undefined)
                ? p.diffRub : (fc - p.startChips) / state.chipsPerRub;
            return {
                game_id: gameId,
                name: p.name,
                start_chips: state.mode === 'tournament' ? state.buyIn : p.startChips,
                final_chips: state.mode === 'tournament' ? (p.diffRub >= 0 ? state.buyIn + p.diffRub : 0) : fc,
                diff_rub: diffRub
            };
        });
        return sbFetch('game_players', { method: 'POST', body: JSON.stringify(playersData) });
    }).then(function () {
        clearTimeout(safetyTimer);
        if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
        btn.disabled = false; btn.innerHTML = '💾 Сохранить и новая игра';
        showAlert('Игра сохранена! ✅', function () { newGame(); });
    }).catch(function (e) {
        clearTimeout(safetyTimer);
        btn.disabled = false; btn.innerHTML = '💾 Сохранить и новая игра';
        try { showAlert('Ошибка сохранения: ' + e.message); } catch (_) {}
    });
}
