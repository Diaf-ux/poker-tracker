// Scenario 5: workstream A - calculateResults() must block saving a cash
// game whose final chips don't sum to the invested total, and must allow a
// balanced one through.
const { launchPage } = require('../helpers/env');
const { get, del } = require('../helpers/seed');
const { assertTrue, it, tally } = require('../helpers/assert');

async function fillTwoNames(page, n1, n2) {
    await page.waitForSelector('#names-grid input');
    await page.evaluate((count) => {
        const grid = document.getElementById('names-grid');
        while (grid.children.length < count) addPlayerInput();
        while (grid.children.length > count) grid.lastChild.remove();
    }, 2);
    await page.evaluate(([n1, n2]) => {
        const inputs = document.querySelectorAll('#names-grid input');
        inputs[0].value = n1;
        inputs[1].value = n2;
    }, [n1, n2]);
}

async function run() {
    const results = [];
    const createdGameIds = [];
    const { browser, page } = await launchPage();

    try {
        results.push(await it('unbalanced final chips are rejected and nothing is saved', async () => {
            const gameName = 'QA_unbalanced_' + Date.now();
            await fillTwoNames(page, 'QA_V1', 'QA_V2');
            await page.evaluate((name) => { document.getElementById('game-name').value = name; }, gameName);
            await page.evaluate(() => startGame());
            await page.waitForSelector('#page-game.active', { timeout: 5000 });
            await page.evaluate(() => showFinalScreen());
            await page.waitForSelector('#final-input-section');

            page.dialogs.length = 0;
            await page.evaluate(() => {
                document.getElementById('final-0').value = String(parseInt(document.getElementById('final-0').value) + 5);
            });
            await page.evaluate(() => { try { calculateResults(); } catch (e) { /* expected throw '' */ } });
            await new Promise((r) => setTimeout(r, 300));

            assertTrue(page.dialogs.some((m) => m.includes('Сумма фишек не сходится')), 'expected chip-mismatch alert');
            const stillOnInput = await page.evaluate(() => document.getElementById('final-input-section').style.display !== 'none');
            assertTrue(stillOnInput, 'should remain on the final-input screen (save blocked)');
            const rows = await get('games?name=eq.' + encodeURIComponent(gameName) + '&select=id');
            assertTrue(rows.length === 0, 'no game row should have been created');
        }));

        results.push(await it('balanced final chips save successfully', async () => {
            await page.evaluate(() => switchTab('tab-setup', document.querySelectorAll('.nav-tab')[0]));
            const gameName = 'QA_balanced_' + Date.now();
            await fillTwoNames(page, 'QA_V3', 'QA_V4');
            await page.evaluate((name) => { document.getElementById('game-name').value = name; }, gameName);
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

            const rows = await get('games?name=eq.' + encodeURIComponent(gameName) + '&select=id');
            assertTrue(rows.length === 1, 'balanced game should have been saved');
            createdGameIds.push(rows[0].id);
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
