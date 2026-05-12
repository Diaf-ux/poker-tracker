var BLIND_SCHEDULE = [
    { sb: 5, bb: 10 }, { sb: 10, bb: 20 }, { sb: 15, bb: 30 }, { sb: 25, bb: 50 },
    { sb: 50, bb: 100 }, { sb: 75, bb: 150 }, { sb: 100, bb: 200 }, { sb: 150, bb: 300 },
    { sb: 200, bb: 400 }, { sb: 300, bb: 600 }, { sb: 400, bb: 800 },
    { sb: 600, bb: 1200 }, { sb: 800, bb: 1600 }
];
var bt = { enabled: false, levelDuration: 10, level: 0, secsLeft: 600, running: false, tickId: null };

function toggleTimerSetup() {
    bt.enabled = document.getElementById('timer-enabled').checked;
    document.getElementById('timer-setup-fields').style.display = bt.enabled ? '' : 'none';
}

function setLevelDuration(min, el) {
    bt.levelDuration = min;
    document.querySelectorAll('.dur-btn').forEach(function (b) { b.classList.remove('active'); });
    el.classList.add('active');
}

function buildBlindSchedule(startChips) {
    var base = Math.max(5, Math.round(startChips * 0.02 / 5) * 5);
    var levels = [];
    var sb = base;
    while (sb < startChips * 2) {
        levels.push({ sb: sb, bb: sb * 2 });
        sb = sb < 25 ? sb * 2
            : sb < 100 ? Math.round(sb * 1.5 / 5) * 5
            : Math.round(sb * 1.5 / 25) * 25;
    }
    return levels.length >= 3 ? levels : BLIND_SCHEDULE;
}

function initBlindTimer(startChips) {
    bt.schedule = buildBlindSchedule(startChips);
    bt.level = 0;
    bt.secsLeft = bt.levelDuration * 60;
    bt.running = false;
    if (bt.tickId) { clearInterval(bt.tickId); bt.tickId = null; }
    renderBlindTimer();
}

function renderBlindTimer() {
    var card = document.getElementById('blind-timer-card');
    if (!card) return;
    card.style.display = bt.enabled ? '' : 'none';
    if (!bt.enabled) return;
    var lvl = bt.schedule[bt.level] || bt.schedule[bt.schedule.length - 1];
    var total = bt.levelDuration * 60;
    var pct = (bt.secsLeft / total) * 100;
    var m = Math.floor(bt.secsLeft / 60), s = bt.secsLeft % 60;
    var timeStr = m + ':' + (s < 10 ? '0' : '') + s;
    var alertClass = bt.secsLeft <= 30 ? 'danger' : bt.secsLeft <= 120 ? 'warn' : '';
    document.getElementById('bt-level-label').textContent =
        'Уровень ' + (bt.level + 1) + ' из ' + bt.schedule.length;
    document.getElementById('bt-blinds').textContent = lvl.sb + ' / ' + lvl.bb;
    document.getElementById('bt-countdown').className =
        'blind-countdown' + (alertClass ? ' ' + alertClass : '');
    document.getElementById('bt-countdown').textContent = timeStr;
    var fill = document.getElementById('bt-progress');
    fill.style.width = pct + '%';
    fill.className = 'blind-progress-fill' + (alertClass ? ' ' + alertClass : '');
    document.getElementById('bt-play-btn').textContent = bt.running ? '⏸ Пауза' : '▶ Старт';
    var nextLvl = bt.schedule[bt.level + 1];
    document.getElementById('bt-next-info').textContent = nextLvl
        ? 'Следующий уровень: ' + nextLvl.sb + ' / ' + nextLvl.bb
        : '🏆 Последний уровень';
}

function toggleBlindTimer() {
    if (bt.running) {
        bt.running = false;
        clearInterval(bt.tickId); bt.tickId = null;
    } else {
        bt.running = true;
        bt.tickId = setInterval(function () {
            if (!bt.running) return;
            bt.secsLeft--;
            if (bt.secsLeft <= 0) blindLevelChange(1, true);
            else renderBlindTimer();
        }, 1000);
    }
    renderBlindTimer();
}

function blindLevelChange(dir, auto) {
    var newLevel = bt.level + dir;
    if (newLevel < 0 || newLevel >= bt.schedule.length) return;
    bt.level = newLevel;
    bt.secsLeft = bt.levelDuration * 60;
    if (auto) {
        if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('warning');
        var lvl = bt.schedule[bt.level];
        showAlert('⬆️ Уровень ' + (bt.level + 1) + '  ·  Блайнды ' + lvl.sb + ' / ' + lvl.bb);
    }
    renderBlindTimer();
}
