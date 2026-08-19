// Scenario 8: temporary pre-round-3 settle gates (see docs/temporary-payment-restrictions.md).
// These block *paying* only - viewing/selecting/calculating stays fully available - for: games
// dated before 01.07.2026, selections of more than 3 games, and any single transaction over
// 300р. Purely UI-layer, isolated in js/history.js's "TEMPORARY SETTLE GATES" block plus a
// defensive guard in settleDebt() - this whole scenario should be deleted alongside that block
// once round 3 (docs/payments-logic-migration.md) ships.
const { launchPage, gotoTab } = require('../helpers/env');
const { createGame, createPlayer, cleanupGames } = require('../helpers/seed');
const { assertTrue, it, tally } = require('../helpers/assert');

async function checkGames(page, ids) {
    await page.evaluate((ids) => {
        document.querySelectorAll('.game-checkbox').forEach((cb) => { cb.checked = false; });
        ids.forEach((id) => {
            const cb = document.querySelector('.game-checkbox[data-id="' + id + '"]');
            if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
        });
    }, ids.map(String));
}

async function calcDebts(page) {
    await page.waitForFunction(() => {
        const b = document.querySelector('#calc-debts-panel .btn');
        return b && b.offsetParent !== null;
    });
    await page.evaluate(() => document.querySelector('#calc-debts-panel .btn').click());
    await page.waitForFunction(() => {
        const p = document.getElementById('debts-panel');
        return p && p.innerText.trim().length > 0 && !p.innerText.includes('Считаем');
    });
    return page.evaluate(() => document.getElementById('debts-panel').innerText);
}

async function disabledSettleCount(page) {
    return page.evaluate(() =>
        document.querySelectorAll('#debts-panel .transactions .settle-btn[disabled]').length);
}

async function enabledSettleCount(page) {
    return page.evaluate(() =>
        document.querySelectorAll('#debts-panel .transactions .settle-btn:not([disabled])').length);
}

async function run() {
    const results = [];
    const gameIds = [];
    const { browser, page } = await launchPage();

    try {
        // Pre-cutoff game (date_str before 01.07.2026)
        const gLegacy = await createGame('QA_gate_legacy_' + Date.now(), { date_str: '15.03.2026 12:00' });
        await createPlayer(gLegacy, 'QA_G_Alice', -50);
        await createPlayer(gLegacy, 'QA_G_Bob', 50);
        gameIds.push(gLegacy);

        // Large-amount game (>300р)
        const gBig = await createGame('QA_gate_big_' + Date.now());
        await createPlayer(gBig, 'QA_G_Carol', -400);
        await createPlayer(gBig, 'QA_G_Dave', 400);
        gameIds.push(gBig);

        // 4 independent small games, each with its own player pair, for the count-cap case
        const gCount = [];
        for (let i = 0; i < 4; i++) {
            const g = await createGame('QA_gate_count' + i + '_' + Date.now());
            await createPlayer(g, 'QA_GC' + i + '_X', -10);
            await createPlayer(g, 'QA_GC' + i + '_Y', 10);
            gCount.push(g);
        }
        gameIds.push(...gCount);

        await gotoTab(page, 2);
        await page.waitForSelector('.history-card');

        results.push(await it('a game dated before 01.07.2026 blocks payment with a date reason', async () => {
            await checkGames(page, [gLegacy]);
            const txt = await calcDebts(page);
            assertTrue(txt.includes('QA_G_Alice') && txt.includes('QA_G_Bob') && txt.includes('50.00'), 'expected the debt to still be visible/calculable');
            assertTrue(txt.includes('Оплата временно недоступна') && txt.includes('01.07.2026'), 'expected the date-cutoff reason in the note');
            assertTrue(await disabledSettleCount(page) > 0, 'settle button must be disabled');
            assertTrue(await enabledSettleCount(page) === 0, 'no settle button should be enabled');
        }));

        results.push(await it('a transaction over 300р blocks payment with an amount reason', async () => {
            await checkGames(page, [gBig]);
            const txt = await calcDebts(page);
            assertTrue(txt.includes('400.00'), 'expected the 400.00 debt to still be visible/calculable');
            assertTrue(txt.includes('Оплата временно недоступна') && txt.includes('300'), 'expected the amount reason in the note');
            assertTrue(await disabledSettleCount(page) > 0, 'settle button must be disabled');
        }));

        results.push(await it('selecting more than 3 games blocks payment with a count reason', async () => {
            await checkGames(page, gCount);
            const txt = await calcDebts(page);
            assertTrue(txt.includes('Оплата временно недоступна') && txt.includes('больше 3 игр'), 'expected the game-count reason in the note');
            assertTrue(await disabledSettleCount(page) > 0, 'settle buttons must be disabled for a 4-game selection');
        }));

        results.push(await it('selecting exactly 3 games stays payable (regression guard)', async () => {
            await checkGames(page, gCount.slice(0, 3));
            const txt = await calcDebts(page);
            assertTrue(!txt.includes('Оплата временно недоступна'), 'a 3-game selection of post-cutoff, small-amount games must not be blocked');
            assertTrue(await enabledSettleCount(page) > 0, 'settle buttons must be enabled for a 3-game selection');
        }));

        results.push(await it('settleDebt() also refuses directly (defensive guard, bypassing the disabled button)', async () => {
            await checkGames(page, [gBig]);
            await calcDebts(page);
            const dialogsBefore = page.dialogs.length;
            await page.evaluate(() => { window.settleDebt('QA_G_Carol', 'QA_G_Dave', 400); });
            await new Promise((r) => setTimeout(r, 300));
            assertTrue(page.dialogs.length > dialogsBefore, 'expected an alert from the defensive guard');
            assertTrue(page.dialogs[page.dialogs.length - 1].includes('временно недоступна'), 'expected the alert to explain the block');
        }));
    } finally {
        await cleanupGames(gameIds).catch(() => {});
        await browser.close();
    }

    return tally(results);
}

module.exports = { run };
