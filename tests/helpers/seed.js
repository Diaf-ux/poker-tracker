// Seeds/reads/cleans up test fixtures directly against PostgREST. This test
// runner container lives on the same Docker network as `app`/`postgrest`
// (poker-tracker_default), so plain `fetch()` to http://app:3000/rest/v1/...
// works directly - no `docker exec` needed here (that workaround is only for
// orchestrating agents outside the Docker network, see .claude/CLAUDE.md).
//
// Every fixture created through here must use a name/from_name/to_name
// starting with QA_ so cleanupAllQA() can find and remove it.

const BASE = 'http://app:3000/rest/v1/';
const HEADERS = { apikey: 'local-dev', 'Content-Type': 'application/json' };

function rest(path, options) {
    return fetch(BASE + path, Object.assign({}, options, {
        headers: Object.assign({}, HEADERS, (options && options.headers) || {})
    })).then(async (res) => {
        const text = await res.text();
        const body = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error('PostgREST ' + res.status + ' on ' + path + ': ' + text);
        return body;
    });
}

function post(table, row) {
    return rest(table, {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(row)
    });
}

function get(path) {
    return rest(path);
}

function del(path) {
    return rest(path, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
}

function patch(path, row) {
    return rest(path, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) });
}

async function createGame(name, overrides) {
    const rows = await post('games', Object.assign({
        name: name,
        date_str: '04.08.2026',
        mode: 'cash',
        chips_per_rub: 1,
        buy_in: 500,
        is_closed: false
    }, overrides || {}));
    return rows[0].id;
}

async function createPlayer(gameId, name, diffRub, overrides) {
    const rows = await post('game_players', Object.assign({
        game_id: gameId,
        name: name,
        start_chips: 500,
        final_chips: 500 + diffRub,
        diff_rub: diffRub
    }, overrides || {}));
    return rows[0].id;
}

async function createPayment(fromName, toName, amount, gameIds) {
    const rows = await post('payments', {
        from_name: fromName,
        to_name: toName,
        amount: amount,
        game_ids: ',' + gameIds.join(',') + ','
    });
    return rows[0].id;
}

async function cleanupGames(gameIds) {
    if (!gameIds.length) return;
    await del('game_players?game_id=in.(' + gameIds.join(',') + ')');
    await del('games?id=in.(' + gameIds.join(',') + ')');
}

// Blanket safety-net sweep - catches fixtures left behind by a test that
// crashed before its own cleanup ran. Order matters: game_players/payments
// before games, mirroring deleteGame()'s own delete order in js/history.js.
async function cleanupAllQA() {
    await del('game_players?name=like.QA_*');
    await del('games?name=like.QA_*');
    await del('payments?from_name=like.QA_*');
    await del('payments?to_name=like.QA_*');
}

module.exports = { rest, post, get, del, patch, createGame, createPlayer, createPayment, cleanupGames, cleanupAllQA };
