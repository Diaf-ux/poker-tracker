function sbFetch(path, options) {
    options = options || {};
    var controller = new AbortController();
    var timeoutId = setTimeout(function () { controller.abort(); }, 10000);
    return fetch(SUPABASE_URL + '/rest/v1/' + path, Object.assign({}, options, {
        signal: controller.signal,
        headers: Object.assign({
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Content-Type': 'application/json',
            'Prefer': options.prefer || 'return=representation'
        }, options.headers || {})
    })).then(function (res) {
        clearTimeout(timeoutId);
        if (!res.ok) return res.text().then(function (t) { throw new Error(t); });
        return res.text().then(function (t) { return t ? JSON.parse(t) : null; });
    }).catch(function (e) {
        clearTimeout(timeoutId);
        if (e.name === 'AbortError') throw new Error('Таймаут соединения (10с). Проверь интернет.');
        throw e;
    });
}

function formatDate(d) {
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
        + ' ' + d.toTimeString().slice(0, 5);
}

function escHtml(s) {
    if (!s) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function showAlert(msg, callback) {
    if (tg && tg.showAlert) {
        tg.showAlert(msg, callback || function () {});
    } else {
        alert(msg);
        if (callback) callback();
    }
}

function showPage(id) {
    document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
    document.getElementById(id).classList.add('active');
    window.scrollTo(0, 0);
}
