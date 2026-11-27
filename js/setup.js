var state = {
    players: [], chipsPerRub: 10, gameName: '',
    mode: 'cash', buyIn: 0, payoutScheme: 'winner_all', place2Prize: 0
};
var knownPlayersCache = null; // null = список из БД ещё не загружен
var playersLoadFailed = false;

function checkPassword() {
    var val = document.getElementById('auth-input').value;
    if (val === APP_PASSWORD) {
        localStorage.setItem(AUTH_KEY, '1');
        showPage('page-setup');
        initSetup();
    } else {
        document.getElementById('auth-error').textContent = 'Неверный пароль';
        if (tg && tg.HapticFeedback) { try { tg.HapticFeedback.notificationOccurred('error'); } catch (e) {} }
    }
}

function initApp() {
    if (localStorage.getItem(AUTH_KEY) === '1') {
        showPage('page-setup');
        initSetup();
    } else {
        showPage('page-auth');
        setTimeout(function () {
            var inp = document.getElementById('auth-input');
            if (inp) inp.focus();
        }, 300);
    }
}

function initSetup() {
    if (document.getElementById('names-grid').children.length === 0) {
        addPlayerInput();
        addPlayerInput();
        addPlayerInput();
    }
    loadPlayersForDropdown();
}

// Загружает известных игроков из БД (уникальные имена из game_players),
// сортирует по алфавиту и заполняет все дропбоксы. При ошибке — превращает
// дропбоксы в обычные текстовые поля, чтобы игру можно было начать офлайн.
function loadPlayersForDropdown() {
    sbFetch('game_players?select=name').then(function (rows) {
        var names = {};
        (rows || []).forEach(function (r) { if (r.name) names[r.name] = 1; });
        knownPlayersCache = Object.keys(names).sort(function (a, b) {
            return a.localeCompare(b, 'ru');
        });
        playersLoadFailed = false;
        renderPlayerSelectOptions();
    }).catch(function () {
        playersLoadFailed = true;
        Array.prototype.forEach.call(
            document.querySelectorAll('#names-grid .player-select'),
            function (sel) {
                var wrap = sel.closest('.name-input-wrap');
                var inp = document.createElement('input');
                inp.type = 'text';
                inp.className = 'player-input';
                inp.placeholder = 'Имя игрока';
                inp.value = sel.value === '__new__' ? '' : sel.value;
                inp.oninput = renderPlayerSelectOptions;
                wrap.insertBefore(inp, sel);
                sel.remove();
            });
    });
}

// Имена, выбранные в других строках (кроме exceptWrap) — их надо скрывать.
function selectedPlayerNames(exceptWrap) {
    var names = [];
    Array.prototype.forEach.call(
        document.querySelectorAll('#names-grid .name-input-wrap'),
        function (wrap) {
            if (wrap === exceptWrap) return;
            var sel = wrap.querySelector('.player-select');
            var inp = wrap.querySelector('.player-input');
            var v = sel ? sel.value : (inp ? inp.value.trim() : '');
            if (v && v !== '__new__') names.push(v);
        });
    return names;
}

function renderPlayerSelectOptions() {
    var taken = selectedPlayerNames(null);
    Array.prototype.forEach.call(
        document.querySelectorAll('#names-grid .player-select'),
        function (sel) {
            var cur = sel.value;
            var html = '<option value="">— выбери игрока —</option>';
            if (knownPlayersCache === null) {
                html += '<option value="__loading__" disabled>Загрузка…</option>';
            } else {
                knownPlayersCache.forEach(function (n) {
                    if (n === cur || taken.indexOf(n) === -1) {
                        html += '<option value="' + escHtml(n) + '">' + escHtml(n) + '</option>';
                    }
                });
            }
            html += '<option value="__new__">➕ Новый игрок…</option>';
            sel.innerHTML = html;
            sel.value = cur;
        });
}

function onPlayerSelectChange(sel) {
    if (sel.value === '__new__') {
        var wrap = sel.closest('.name-input-wrap');
        var inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'player-input';
        inp.placeholder = 'Имя нового игрока';
        inp.oninput = renderPlayerSelectOptions;
        wrap.insertBefore(inp, sel);
        sel.remove();
        inp.focus();
    }
    renderPlayerSelectOptions();
}

// Сбрасывает строки игроков к трём пустым дропбоксам (вызывается из newGame()).
function resetPlayerRows() {
    document.getElementById('names-grid').innerHTML = '';
    addPlayerInput();
    addPlayerInput();
    addPlayerInput();
}

function addPlayerInput() {
    var grid = document.getElementById('names-grid');
    var idx = grid.children.length;
    var wrap = document.createElement('div');
    wrap.className = 'name-input-wrap';
    if (playersLoadFailed) {
        var inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'player-input';
        inp.placeholder = 'Имя игрока ' + (idx + 1);
        inp.oninput = renderPlayerSelectOptions;
        wrap.appendChild(inp);
    } else {
        var sel = document.createElement('select');
        sel.className = 'player-select';
        sel.onchange = function () { onPlayerSelectChange(sel); };
        wrap.appendChild(sel);
    }
    var btn = document.createElement('button');
    btn.className = 'remove-btn';
    btn.textContent = '✕';
    btn.onclick = function () { wrap.remove(); updatePlayerCount(); renderPlayerSelectOptions(); };
    wrap.appendChild(btn);
    grid.appendChild(wrap);
    renderPlayerSelectOptions();
    updatePlayerCount();
}

function updatePlayerCount() {
    document.getElementById('player-count-badge').textContent =
        document.getElementById('names-grid').children.length;
}

function setGameMode(mode) {
    state.mode = mode;
    document.getElementById('mode-btn-cash').classList.toggle('active', mode === 'cash');
    document.getElementById('mode-btn-tournament').classList.toggle('active', mode === 'tournament');
    document.getElementById('cash-rate-field').style.display = mode === 'cash' ? '' : 'none';
    document.getElementById('tournament-fields').style.display = mode === 'tournament' ? '' : 'none';
    if (mode === 'tournament') updatePayoutPreview();
}

function getPayoutScheme() {
    var btn = document.getElementById('scheme-btn-top2');
    return btn && btn.classList.contains('active') ? 'top2' : 'winner_all';
}

function selectPayoutScheme(scheme) {
    document.getElementById('scheme-btn-winner').classList.toggle('active', scheme === 'winner_all');
    document.getElementById('scheme-btn-top2').classList.toggle('active', scheme === 'top2');
    document.getElementById('top2-fields').style.display = scheme === 'top2' ? '' : 'none';
    if (scheme === 'top2') {
        var buyIn = parseFloat(document.getElementById('buy-in').value) || 0;
        var p2el = document.getElementById('place2-prize');
        if (p2el) p2el.value = buyIn;
    }
    updatePayoutPreview();
}

function updatePayoutPreview() {
    var preview = document.getElementById('payout-preview');
    if (!preview) return;
    var buyIn = parseFloat(document.getElementById('buy-in').value) || 0;
    var n = document.getElementById('names-grid').querySelectorAll('input').length || 0;
    var pool = buyIn * n;
    var scheme = getPayoutScheme();
    var place2El = document.getElementById('place2-prize');
    var p2 = scheme === 'top2' ? (parseFloat(place2El ? place2El.value : 0) || 0) : 0;
    var p1 = pool - p2;
    var warn = (scheme === 'top2' && p2 >= p1) ? ' ⚠️ 2-й получает столько же/больше 1-го!' : '';
    var net1 = p1 - buyIn;
    var net1str = (net1 >= 0 ? '+' : '') + net1.toFixed(0) + ' р';
    var txt = '💰 Пул: ' + pool + ' р &nbsp;|&nbsp; 🥇 1-е: ' + p1.toFixed(0) + ' р (net ' + net1str + ')';
    if (scheme === 'top2') {
        var net2 = p2 - buyIn;
        var net2str = net2 === 0 ? '±0' : (net2 > 0 ? '+' : '') + net2.toFixed(0) + ' р';
        txt += ' &nbsp;|&nbsp; 🥈 2-е: ' + p2.toFixed(0) + ' р (net ' + net2str + ')';
    }
    if (warn) txt += warn;
    preview.innerHTML = txt;
    preview.style.background = warn ? 'var(--red)' : 'var(--green-dark)';
    preview.style.display = pool > 0 ? '' : 'none';
}

function startGame() {
    var names = Array.from(document.getElementById('names-grid').children)
        .map(function (wrap) {
            var sel = wrap.querySelector('.player-select');
            var inp = wrap.querySelector('.player-input');
            var v = sel ? sel.value : (inp ? inp.value.trim() : '');
            return v === '__new__' ? '' : v;
        })
        .filter(Boolean);
    var chipsPerPlayer = parseInt(document.getElementById('chips-per-player').value) || 100;
    var gameName = document.getElementById('game-name').value.trim();
    if (names.length < 2) { showAlert('Добавьте хотя бы 2 игроков!'); return; }
    if (new Set(names).size !== names.length) { showAlert('Имена должны быть уникальными!'); return; }
    state.gameName = gameName || ('Игра ' + formatDate(new Date()));
    if (state.mode === 'tournament') {
        state.buyIn = parseFloat(document.getElementById('buy-in').value) || 200;
        state.payoutScheme = getPayoutScheme();
        var p2el = document.getElementById('place2-prize');
        state.place2Prize = state.payoutScheme === 'top2'
            ? (parseFloat(p2el ? p2el.value : state.buyIn) || state.buyIn)
            : 0;
        state.chipsPerRub = 1;
    } else {
        var cashBuyIn = parseFloat(document.getElementById('cash-buy-in').value);
        if (!(cashBuyIn > 0)) cashBuyIn = 100;
        state.chipsPerRub = chipsPerPlayer / cashBuyIn;
        state.buyIn = 0;
    }
    state.players = names.map(function (name) {
        return {
            name: name,
            startChips: chipsPerPlayer,
            currentChips: chipsPerPlayer,
            finalChips: null,
            diffRub: null,
            history: ['Старт: +' + chipsPerPlayer]
        };
    });
    if (state.mode === 'tournament' && bt.enabled) {
        var chips = parseInt(document.getElementById('chips-per-player').value) || 500;
        initBlindTimer(chips);
    } else {
        bt.enabled = false;
        var card = document.getElementById('blind-timer-card');
        if (card) card.style.display = 'none';
    }
    showPage('page-game');
    renderGamePage();
}
