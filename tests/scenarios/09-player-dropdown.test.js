// Scenario 9: the setup-page player dropdown. Known players come from the DB,
// sorted alphabetically; a player chosen in one row disappears from the other
// rows' dropdowns; "+ Новый игрок…" turns a row into a free-text input; a game
// can start from a mix of dropdown and typed players.
const { launchPage } = require('../helpers/env');
const { createGame, createPlayer, cleanupGames } = require('../helpers/seed');
const { assertTrue, it, tally } = require('../helpers/assert');

async function run() {
    const results = [];
    const createdGameIds = [];
    const { browser, page } = await launchPage();

    try {
        results.push(await it('dropdown lists known players alphabetically', async () => {
            const gid = await createGame('QA_dropdown_' + Date.now());
            createdGameIds.push(gid);
            await createPlayer(gid, 'QA_Zulu', 100);
            await createPlayer(gid, 'QA_Alpha', -100);

            // перезагружаем страницу, чтобы setup заново загрузил список из БД
            await page.reload({ waitUntil: 'networkidle0' });
            await page.waitForSelector('#page-setup.active', { timeout: 5000 });
            await page.waitForFunction(() => {
                const sel = document.querySelector('#names-grid .player-select');
                return sel && Array.from(sel.options).some((o) => o.value === 'QA_Alpha');
            }, { timeout: 8000 });

            const names = await page.evaluate(() =>
                Array.from(document.querySelector('#names-grid .player-select').options)
                    .map((o) => o.value));
            assertTrue(names.indexOf('QA_Alpha') !== -1 && names.indexOf('QA_Zulu') !== -1,
                'both known players are listed');
            assertTrue(names.indexOf('QA_Alpha') < names.indexOf('QA_Zulu'),
                'names are sorted alphabetically');
        }));

        results.push(await it('a chosen player disappears from the other dropdowns', async () => {
            await page.evaluate(() => {
                const sels = document.querySelectorAll('#names-grid .player-select');
                sels[0].value = 'QA_Alpha';
                sels[0].dispatchEvent(new Event('change'));
            });
            const others = await page.evaluate(() =>
                Array.from(document.querySelectorAll('#names-grid .player-select')).slice(1)
                    .map((s) => Array.from(s.options).map((o) => o.value)));
            assertTrue(others.every((vals) => vals.indexOf('QA_Alpha') === -1),
                'QA_Alpha is hidden in the other rows');
            assertTrue(others.every((vals) => vals.indexOf('QA_Zulu') !== -1),
                'QA_Zulu is still offered');
        }));

        results.push(await it('"+ Новый игрок…" turns the row into a text input and the game starts', async () => {
            await page.evaluate(() => {
                const sels = document.querySelectorAll('#names-grid .player-select');
                sels[1].value = '__new__';
                sels[1].dispatchEvent(new Event('change'));
                const inp = document.querySelector('#names-grid .player-input');
                inp.value = 'QA_Newbie';
            });
            await page.evaluate(() => {
                const grid = document.getElementById('names-grid');
                while (grid.children.length > 2) grid.lastChild.remove();
                startGame();
            });
            await page.waitForSelector('#page-game.active', { timeout: 5000 });
            const names = await page.evaluate(() => state.players.map((p) => p.name));
            assertTrue(names.indexOf('QA_Alpha') !== -1 && names.indexOf('QA_Newbie') !== -1,
                'game starts with the dropdown player and the typed player');
        }));
    } finally {
        await cleanupGames(createdGameIds);
        await browser.close();
    }

    return tally(results);
}

module.exports = { run };
