// Scenario 1: create a cash/tournament game (named / unnamed, various player
// counts) -> rebuy (cash) -> finish -> correct diff_rub saved.
const { launchPage } = require('../helpers/env');
const { get, del } = require('../helpers/seed');
const { assertEqual, assertTrue, it, tally } = require('../helpers/assert');

async function fillNames(page, names) {
    await page.waitForSelector('#names-grid input');
    // top up / trim the default 3 inputs to exactly `names.length`
    await page.evaluate((count) => {
        const grid = document.getElementById('names-grid');
        while (grid.children.length < count) addPlayerInput();
        while (grid.children.length > count) grid.lastChild.remove();
    }, names.length);
    await page.evaluate((names) => {
        const inputs = document.querySelectorAll('#names-grid input');
        names.forEach((n, i) => { inputs[i].value = n; });
    }, names);
}

async function findSavedGameId(gameName) {
    const rows = await get('games?name=eq.' + encodeURIComponent(gameName) + '&select=id');
    return rows.length ? rows[0].id : null;
}

async function run() {
    const results = [];
    const createdGameIds = [];
    const { browser, page } = await launchPage();

    try {
        // --- 1a: named cash game, 3 players, one rebuy ---
        results.push(await it('cash game with name + rebuy saves with correct diff_rub', async () => {
            const gameName = 'QA_cash_named_' + Date.now();
            await fillNames(page, ['QA_C1', 'QA_C2', 'QA_C3']);
            await page.evaluate((name) => { document.getElementById('game-name').value = name; }, gameName);
            await page.evaluate(() => { document.getElementById('chips-per-rub').value = '1'; });
            await page.evaluate(() => startGame());
            await page.waitForSelector('#page-game.active', { timeout: 5000 });

            // rebuy: player 0 buys 100 more chips (startChips 500 -> 600)
            await page.evaluate(() => {
                document.getElementById('add-input-0').value = '100';
                addChips(0);
            });

            await page.evaluate(() => showFinalScreen());
            await page.waitForSelector('#final-input-section');
            // balanced final chips: total invested = 600+500+500 = 1600
            await page.evaluate(() => {
                document.getElementById('final-0').value = '700'; // +100 vs invested 600
                document.getElementById('final-1').value = '400'; // -100 vs invested 500
                document.getElementById('final-2').value = '500'; // even
            });
            await page.evaluate(() => calculateResults());
            await page.waitForSelector('#results-section', { timeout: 5000 });
            await page.evaluate(() => saveAndNewGame());
            await page.waitForFunction(() => document.getElementById('page-setup').classList.contains('active'), { timeout: 8000 });

            const gameId = await findSavedGameId(gameName);
            assertTrue(gameId !== null, 'saved game row not found');
            createdGameIds.push(gameId);
            const players = await get('game_players?game_id=eq.' + gameId + '&select=name,diff_rub&order=name');
            assertEqual(players.length, 3, 'expected 3 saved players');
            const byName = Object.fromEntries(players.map((p) => [p.name, p.diff_rub]));
            assertEqual(byName['QA_C1'], 100, 'QA_C1 diff_rub');
            assertEqual(byName['QA_C2'], -100, 'QA_C2 diff_rub');
            assertEqual(byName['QA_C3'], 0, 'QA_C3 diff_rub');
        }));

        // --- 1b: unnamed cash game, 2 players, no rebuy ---
        results.push(await it('cash game without a name auto-generates one and saves', async () => {
            await page.evaluate(() => switchTab('tab-setup', document.querySelectorAll('.nav-tab')[0]));
            await fillNames(page, ['QA_U1', 'QA_U2']);
            await page.evaluate(() => { document.getElementById('game-name').value = ''; });
            const beforeIds = new Set((await get('games?select=id')).map((g) => g.id));
            await page.evaluate(() => startGame());
            await page.waitForSelector('#page-game.active', { timeout: 5000 });
            await page.evaluate(() => showFinalScreen());
            await page.waitForSelector('#final-input-section');
            await page.evaluate(() => {
                document.getElementById('final-0').value = '600';
                document.getElementById('final-1').value = '400';
            });
            await page.evaluate(() => calculateResults());
            await page.waitForSelector('#results-section', { timeout: 5000 });
            await page.evaluate(() => saveAndNewGame());
            await page.waitForFunction(() => document.getElementById('page-setup').classList.contains('active'), { timeout: 8000 });

            const afterRows = await get('games?select=id,name,is_closed&order=id.desc&limit=1');
            assertTrue(afterRows.length === 1 && !beforeIds.has(afterRows[0].id), 'no new game row appeared');
            assertTrue(afterRows[0].name.length > 0, 'auto-generated name should be non-empty');
            createdGameIds.push(afterRows[0].id);
        }));

        // --- 1c: tournament, winner-takes-all, 4 players ---
        results.push(await it('tournament (winner takes all) saves correct prizes', async () => {
            await page.evaluate(() => switchTab('tab-setup', document.querySelectorAll('.nav-tab')[0]));
            await fillNames(page, ['QA_T1', 'QA_T2', 'QA_T3', 'QA_T4']);
            const gameName = 'QA_tourney_wta_' + Date.now();
            await page.evaluate((name) => { document.getElementById('game-name').value = name; }, gameName);
            await page.evaluate(() => setGameMode('tournament'));
            await page.evaluate(() => { document.getElementById('buy-in').value = '500'; });
            await page.evaluate(() => startGame());
            await page.waitForSelector('#page-game.active', { timeout: 5000 });
            await page.evaluate(() => showFinalScreen());
            await page.waitForSelector('#place1-select', { timeout: 5000 });
            await page.evaluate(() => { document.getElementById('place1-select').value = 'QA_T2'; });
            await page.evaluate(() => calculateResults());
            await page.waitForSelector('#results-section', { timeout: 5000 });
            await page.evaluate(() => saveAndNewGame());
            await page.waitForFunction(() => document.getElementById('page-setup').classList.contains('active'), { timeout: 8000 });

            const gameId = await findSavedGameId(gameName);
            assertTrue(gameId !== null, 'saved tournament game row not found');
            createdGameIds.push(gameId);
            const players = await get('game_players?game_id=eq.' + gameId + '&select=name,diff_rub&order=name');
            const byName = Object.fromEntries(players.map((p) => [p.name, p.diff_rub]));
            assertEqual(byName['QA_T1'], -500, 'QA_T1 (non-winner) diff_rub');
            assertEqual(byName['QA_T2'], 1500, 'QA_T2 (winner, pool 2000 - buyIn 500) diff_rub');
            assertEqual(byName['QA_T3'], -500, 'QA_T3 (non-winner) diff_rub');
            assertEqual(byName['QA_T4'], -500, 'QA_T4 (non-winner) diff_rub');
        }));
    } finally {
        if (createdGameIds.length) {
            await del('game_players?game_id=in.(' + createdGameIds.join(',') + ')').catch(() => {});
            await del('games?id=in.(' + createdGameIds.join(',') + ')').catch(() => {});
        }
        await browser.close();
    }

    return tally(results);
}

module.exports = { run };
