var RETRY_MAX = 5;          // total attempts
var RETRY_BASE_DELAY = 800; // ms, doubles each retry: 800 → 1600 → 3200
var TIMEOUT_PER_TRY = 12000; // ms per individual attempt

// Methods that must NOT be retried (non-idempotent writes)
var SAFE_TO_RETRY = { GET: true, HEAD: true };

function sbFetchOnce(path, options) {
    var controller = new AbortController();
    var timeoutId = setTimeout(function () {
        console.warn('[sbFetch] timeout:', path);
        controller.abort();
    }, TIMEOUT_PER_TRY);

    return fetch(SUPABASE_URL + '/rest/v1/' + path, Object.assign({}, options, {
        signal: controller.signal,
        headers: Object.assign({
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Content-Type': 'application/json',
            'Prefer': (options && options.prefer) || 'return=representation'
        }, (options && options.headers) || {})
    })).then(function (res) {
        clearTimeout(timeoutId);
        if (!res.ok) return res.text().then(function (t) { throw new Error(t); });
        return res.text().then(function (t) { return t ? JSON.parse(t) : null; });
    }).catch(function (e) {
        clearTimeout(timeoutId);
        if (e.name === 'AbortError') throw new Error('__TIMEOUT__');
        throw e;
    });
}

function sbFetch(path, options) {
    var method = (options && options.method) ? options.method.toUpperCase() : 'GET';
    var canRetry = !!SAFE_TO_RETRY[method];
    var attempt = 0;

    function tryOnce() {
        attempt++;
        var t0 = Date.now();
        return sbFetchOnce(path, options).then(function (result) {
            console.log('[sbFetch] ok attempt=' + attempt + ' ' + (Date.now() - t0) + 'ms ' + path);
            return result;
        }).catch(function (e) {
            var isTimeout = e.message === '__TIMEOUT__';
            var isNetErr = e.message.indexOf('fetch') !== -1 || e.message.indexOf('network') !== -1 || isTimeout;
            console.warn('[sbFetch] fail attempt=' + attempt + ' ' + e.message + ' ' + path);

            if (canRetry && isNetErr && attempt < RETRY_MAX) {
                var delay = RETRY_BASE_DELAY * Math.pow(2, attempt - 1);
                console.log('[sbFetch] retrying in ' + delay + 'ms...');
                return new Promise(function (resolve) {
                    setTimeout(resolve, delay);
                }).then(tryOnce);
            }

            // Translate timeout error to a human-readable message
            if (isTimeout) {
                throw new Error('Таймаут соединения (' + (TIMEOUT_PER_TRY / 1000) + 'с) с БД. Пробуй пока не получится :).');
            }
            throw e;
        });
    }

    return tryOnce();
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
