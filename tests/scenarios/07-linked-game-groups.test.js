// Scenario 7: history-card UI for payment-linked game groups (computeGameGroups()/
// selectGameGroup() in js/history.js). A game whose game gets touched by a payment
// that also covers other games shows a "🔗 select the whole group" hint + button,
// so a user can always get the complete, correct picture in one click without
// losing the ability to look at a single game on its own (see the calculation
// correctness cases in tests/scenarios/03-multi-game-debts.test.js).
const { launchPage, gotoTab } = require('../helpers/env');
const { createGame, createPlayer, createPayment, cleanupGames, del } = require('../helpers/seed');
const { assertTrue, it, tally } = require('../helpers/assert');

async function cardText(page, gameId) {
    return page.evaluate((id) => {
        const card = Array.from(document.querySelectorAll('.history-card')).find((c) => {
            const cb = c.querySelector('.game-checkbox');
            return cb && cb.dataset.id === String(id);
        });
        return card ? card.innerText : 'NOT_FOUND';
    }, gameId);
}

async function clickGroupButton(page, gameId) {
    await page.evaluate((id) => {
        const card = Array.from(document.querySelectorAll('.history-card')).find((c) => {
            const cb = c.querySelector('.game-checkbox');
            return cb && cb.dataset.id === String(id);
        });
        const btn = card && Array.from(card.querySelectorAll('.settle-btn')).find((b) => b.textContent.includes('Выбрать группу'));
        if (!btn) throw new Error('group-select button not found for game ' + id);
        btn.click();
    }, gameId);
}

async function checkedIds(page) {
    return page.evaluate(() => Array.from(document.querySelectorAll('.game-checkbox:checked')).map((cb) => cb.dataset.id));
}

async function run() {
    const results = [];
    const gameIds = [];
    const { browser, page } = await launchPage();

    try {
        // g1: no payment at all - must show no hint.
        const g1 = await createGame('QA_LG_solo_' + Date.now());
        await createPlayer(g1, 'QA_LG_Solo1', -10);
        await createPlayer(g1, 'QA_LG_Solo2', 10);

        // g2-g3-g4: a transitive chain - payment A links g2+g3, payment B links g3+g4,
        // so all three must end up in the same group even though no single payment
        // covers all three directly.
        const g2 = await createGame('QA_LG_g2_' + Date.now());
        await createPlayer(g2, 'QA_LG_Alice', -10);
        await createPlayer(g2, 'QA_LG_Bob', 10);
        const g3 = await createGame('QA_LG_g3_' + Date.now());
        await createPlayer(g3, 'QA_LG_Alice', -5);
        await createPlayer(g3, 'QA_LG_Carol', 5);
        const g4 = await createGame('QA_LG_g4_' + Date.now());
        await createPlayer(g4, 'QA_LG_Carol', -8);
        await createPlayer(g4, 'QA_LG_Dave', 8);
        gameIds.push(g1, g2, g3, g4);

        await createPayment('QA_LG_Alice', 'QA_LG_Bob', 10, [g2, g3]);
        await createPayment('QA_LG_Carol', 'QA_LG_Dave', 8, [g3, g4]);

        await gotoTab(page, 2);
        await page.waitForSelector('.history-card');

        results.push(await it('a game with no linked payments shows no group hint', async () => {
            const txt = await cardText(page, g1);
            assertTrue(!txt.includes('🔗'), 'unlinked game must not show the group hint');
        }));

        results.push(await it('a linked game shows the group hint naming its (transitively linked) siblings', async () => {
            const txt = await cardText(page, g2);
            assertTrue(txt.includes('🔗'), 'expected the group hint on g2');
            assertTrue(txt.includes('QA_LG_g3') && txt.includes('QA_LG_g4'), 'expected g2\'s hint to name both g3 and g4 (transitive group)');
        }));

        results.push(await it('clicking "Выбрать группу" selects every game in the group', async () => {
            await clickGroupButton(page, g2);
            await page.waitForFunction(() => {
                const p = document.getElementById('debts-panel');
                return p && p.innerText.trim().length > 0 && !p.innerText.includes('Считаем');
            });
            const ids = await checkedIds(page);
            [g2, g3, g4].forEach((id) => {
                assertTrue(ids.includes(String(id)), 'expected game ' + id + ' to be checked after group-select');
            });
        }));

        results.push(await it('once the full group is selected, both payments are fully counted (no skipped-payment note)', async () => {
            let txt = await page.evaluate(() => document.getElementById('debts-panel').innerText);
            assertTrue(!txt.includes('расчёт неполный'), 'both linked payments are now fully contained and must not be skipped');
            assertTrue(txt.includes('Уже оплачено (2)'), 'expected paid header with count 2');
            await page.evaluate(() => document.querySelector('#debts-panel .paid-toggle').click());
            txt = await page.evaluate(() => document.getElementById('debts-panel').innerText);
            assertTrue(txt.includes('10.00') && txt.includes('8.00'), 'expected both payments (10.00, 8.00) visible after expanding the paid list');
        }));
    } finally {
        await cleanupGames(gameIds).catch(() => {});
        await del('payments?from_name=like.QA_LG_*').catch(() => {});
        await browser.close();
    }

    return tally(results);
}

module.exports = { run };
