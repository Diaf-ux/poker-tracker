// Scenario 10: automatic poker-evening numbering. A dedicated counter field
// (default 95, persisted in localStorage) plus a violet toggle auto-fill the
// game name with "Покерный вечер <roman>" using additive Roman numerals.
// The counter only changes when edited by hand - no auto-increment on save.
const { launchPage } = require('../helpers/env');
const { get, del } = require('../helpers/seed');
const { assertEqual, assertTrue, it, tally } = require('../helpers/assert');

async function fillTwoNewPlayers(page, n1, n2) {
    await page.evaluate((count) => {
        const grid = document.getElementById('names-grid');
        while (grid.children.length < count) addPlayerInput();
        while (grid.children.length > count) grid.lastChild.remove();
    }, 2);
    await page.evaluate(([n1, n2]) => {
        const wraps = document.querySelectorAll('#names-grid .name-input-wrap');
        [n1, n2].forEach((n, i) => {
            const sel = wraps[i].querySelector('.player-select');
            if (sel) { sel.value = '__new__'; onPlayerSelectChange(sel); }
            wraps[i].querySelector('.player-input').value = n;
        });
    }, [n1, n2]);
}

async function run() {
    const results = [];
    const createdGameIds = [];
    const { browser, page } = await launchPage();

    try {
        results.push(await it('counter defaults to 95 and converts to Roman correctly', async () => {
            const val = await page.evaluate(() => document.getElementById('evening-counter').value);
            assertEqual(val, '95', 'counter default value is 95');
            const romans = await page.evaluate(() => [toRoman(95), toRoman(96), toRoman(99), toRoman(100)]);
            assertEqual(romans[0], 'LXXXXV', '95 -> LXXXXV');
            assertEqual(romans[1], 'LXXXXVI', '96 -> LXXXXVI');
            assertEqual(romans[2], 'LXXXXVIIII', '99 -> LXXXXVIIII');
            assertEqual(romans[3], 'C', '100 -> C');
        }));

        results.push(await it('toggle fills and locks the game name with the Roman number', async () => {
            await page.evaluate(() => {
                document.getElementById('auto-number').checked = true;
                toggleAutoNumbering();
            });
            const name = await page.evaluate(() => document.getElementById('game-name').value);
            assertEqual(name, 'Покерный вечер LXXXXV', 'auto name from counter 95');
            assertTrue(await page.evaluate(() => document.getElementById('game-name').readOnly),
                'name input is locked while the toggle is on');
            // ручное изменение счётчика обновляет имя на лету
            await page.evaluate(() => {
                const el = document.getElementById('evening-counter');
                el.value = '96';
                onEveningCounterChange();
            });
            const name2 = await page.evaluate(() => document.getElementById('game-name').value);
            assertEqual(name2, 'Покерный вечер LXXXXVI', 'name follows counter edits');
        }));

        results.push(await it('counter persists across reload, the toggle does not', async () => {
            await page.reload({ waitUntil: 'networkidle0' });
            await page.waitForSelector('#page-setup.active', { timeout: 5000 });
            const val = await page.evaluate(() => document.getElementById('evening-counter').value);
            assertEqual(val, '96', 'counter restored from localStorage');
            assertTrue(!(await page.evaluate(() => document.getElementById('auto-number').checked)),
                'toggle is OFF after reload');
        }));

        results.push(await it('a saved auto-named game does not bump the counter', async () => {
            await page.evaluate(() => {
                document.getElementById('auto-number').checked = true;
                toggleAutoNumbering();
            });
            const autoName = await page.evaluate(() => document.getElementById('game-name').value);
            assertEqual(autoName, 'Покерный вечер LXXXXVI', 'auto name uses the persisted counter');
            await fillTwoNewPlayers(page, 'QA_N1', 'QA_N2');
            await page.evaluate(() => startGame());
            await page.waitForSelector('#page-game.active', { timeout: 5000 });
            const subtitle = await page.evaluate(() => document.getElementById('game-subtitle').textContent);
            assertTrue(subtitle.indexOf(autoName) !== -1, 'game page shows the auto name');
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

            const rows = await get('games?name=eq.' + encodeURIComponent(autoName) + '&select=id');
            assertEqual(rows.length, 1, 'saved with the auto name');
            createdGameIds.push(rows[0].id);
            const counterAfter = await page.evaluate(() => document.getElementById('evening-counter').value);
            assertEqual(counterAfter, '96', 'counter did not auto-increment after save');
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
