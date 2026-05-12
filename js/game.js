function renderGamePage() {
    var isTournament = state.mode === 'tournament';
    var subtitle = isTournament
        ? state.gameName + ' 🏆 · Бай-ин ' + state.buyIn + ' р · Пул ' + (state.buyIn * state.players.length) + ' р'
        : state.gameName + ' · 1р = ' + state.chipsPerRub + ' фишек';
    document.getElementById('game-subtitle').textContent = subtitle;
    var grid = document.getElementById('players-grid');
    grid.innerHTML = '';
    state.players.forEach(function (p, i) {
        var card = document.createElement('div');
        card.className = 'player-card';
        card.id = 'pcard-' + i;
        var rebuyHtml = isTournament ? '' :
            '<div class="player-actions">' +
            '<input type="number" id="add-input-' + i + '" placeholder="Докуп фишек" min="1" inputmode="numeric">' +
            '<button class="btn btn-green btn-sm" onclick="addChips(' + i + ')">+ Докуп</button>' +
            '</div>';
        var rubHtml = isTournament ? '' :
            ' · ≈ <span id="rub-' + i + '">' + (p.currentChips / state.chipsPerRub).toFixed(2) + '</span> р';
        card.innerHTML =
            '<div class="player-name">' + escHtml(p.name) + '</div>' +
            '<div class="player-chips-display">Фишки: <span id="chips-' + i + '">' + p.currentChips + '</span>' + rubHtml + '</div>' +
            '<div class="player-chips-display" style="font-size:0.78rem;color:#5a8a6a">Вложено: <span id="start-' + i + '">' + p.startChips + '</span></div>' +
            rebuyHtml +
            '<div class="history-log" id="history-' + i + '"></div>';
        grid.appendChild(card);
        if (!isTournament) {
            document.getElementById('add-input-' + i).addEventListener('keydown', (function (idx) {
                return function (e) { if (e.key === 'Enter') addChips(idx); };
            })(i));
        }
        updateHistoryLog(i);
    });
}

function addChips(idx) {
    var input = document.getElementById('add-input-' + idx);
    var amount = parseInt(input.value);
    if (!amount || amount < 1) { input.focus(); return; }
    var p = state.players[idx];
    p.currentChips += amount;
    p.startChips += amount;
    var t = new Date().toTimeString().slice(0, 5);
    p.history.push(t + ' Докуп: +' + amount);
    document.getElementById('chips-' + idx).textContent = p.currentChips;
    document.getElementById('rub-' + idx).textContent = (p.currentChips / state.chipsPerRub).toFixed(2);
    document.getElementById('start-' + idx).textContent = p.startChips;
    updateHistoryLog(idx);
    var card = document.getElementById('pcard-' + idx);
    card.style.borderColor = '#60e080';
    setTimeout(function () { card.style.borderColor = ''; }, 700);
    input.value = '';
    input.focus();
    if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
}

function updateHistoryLog(i) {
    var log = document.getElementById('history-' + i);
    if (log) log.innerHTML = state.players[i].history.slice(-5).reverse()
        .map(function (h) { return '<div class="history-item">' + escHtml(h) + '</div>'; }).join('');
}

function goBackSetup() {
    showPage('page-setup');
}

function newGame() {
    if (bt.tickId) { clearInterval(bt.tickId); bt.tickId = null; bt.running = false; }
    showPage('page-setup');
    document.querySelectorAll('.tab-content').forEach(function (t) { t.style.display = 'none'; });
    document.querySelectorAll('.nav-tab').forEach(function (t) { t.classList.remove('active'); });
    document.getElementById('tab-setup').style.display = 'block';
    document.querySelectorAll('.nav-tab')[0].classList.add('active');
}
