// Scenario 6: workstream B - a single game auto-closes once its own balance
// is zero; multiple selected games only auto-close as a direct result of a
// just-recorded combined payment, never from merely viewing an old
// combination that happens to net to zero on its own.
const { launchPage, gotoTab } = require('../helpers/env');
const { createGame, createPlayer, createPayment, cleanupGames, del } = require('../helpers/seed');
const { assertEqual, it, tally } = require('../helpers/assert');

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
}

async function settleFirst(page) {
    const before = await page.evaluate(() => document.getElementById('debts-panel').innerText);
    await page.evaluate(() => document.querySelector('#debts-panel .settle-btn').click());
    await page.waitForFunction((prev) => {
        const t = document.getElementById('debts-panel').innerText;
        return t !== prev && t.trim().length > 0 && !t.includes('Считаем');
    }, {}, before);
}

async function badgeFor(page, gameId) {
    return page.evaluate((id) => {
        const card = Array.from(document.querySelectorAll('.history-card')).find((c) => {
            const cb = c.querySelector('.game-checkbox');
            return cb && cb.dataset.id === String(id);
        });
        return card ? card.querySelector('.badge').textContent.trim() : 'NOT_FOUND';
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

async function run() {
    const results = [];
    const gameIds = [];
    const { browser, page } = await launchPage();

    try {
        const g1 = await createGame('QA_close_single_' + Date.now());
        await createPlayer(g1, 'QA_AC_Alice', -40);
        await createPlayer(g1, 'QA_AC_Bob', 40);
        const g2 = await createGame('QA_close_multi_a_' + Date.now());
        await createPlayer(g2, 'QA_AC_Alice', -25);
        await createPlayer(g2, 'QA_AC_Bob', 25);
        const g3 = await createGame('QA_close_multi_b_' + Date.now());
        await createPlayer(g3, 'QA_AC_Alice', -15);
        await createPlayer(g3, 'QA_AC_Bob', 15);
        gameIds.push(g1, g2, g3);

        // g4/g5: linked by a pre-existing payment covering both, which only
        // partially settles their combined debt - used to verify that expanding
        // a single-game selection to its full linked group via "Выбрать группу"
        // and then settling the remainder closes every game in the group, not
        // just the one originally checked.
        const g4 = await createGame('QA_close_link_a_' + Date.now());
        await createPlayer(g4, 'QA_AC2_Alice', -10);
        await createPlayer(g4, 'QA_AC2_Bob', 10);
        const g5 = await createGame('QA_close_link_b_' + Date.now());
        await createPlayer(g5, 'QA_AC2_Alice', -5);
        await createPlayer(g5, 'QA_AC2_Bob', 5);
        gameIds.push(g4, g5);
        await createPayment('QA_AC2_Alice', 'QA_AC2_Bob', 10, [g4, g5]);

        await gotoTab(page, 2);
        await page.waitForSelector('.history-card');

        results.push(await it('merely computing a multi-game combo does NOT auto-close it', async () => {
            await checkGames(page, [g2, g3]);
            await calcDebts(page);
            assertEqual(await badgeFor(page, g2), 'Открыта', 'g2 should stay open');
            assertEqual(await badgeFor(page, g3), 'Открыта', 'g3 should stay open');
        }));

        results.push(await it('settling a single game auto-closes it', async () => {
            await checkGames(page, [g1]);
            await calcDebts(page);
            await settleFirst(page);
            await new Promise((r) => setTimeout(r, 500));
            assertEqual(await badgeFor(page, g1), 'Закрыта', 'g1 should auto-close');
        }));

        results.push(await it('settling a combined multi-game debt auto-closes all involved games', async () => {
            await checkGames(page, [g2, g3]);
            await calcDebts(page);
            await settleFirst(page);
            await new Promise((r) => setTimeout(r, 800));
            assertEqual(await badgeFor(page, g2), 'Закрыта', 'g2 should auto-close');
            assertEqual(await badgeFor(page, g3), 'Закрыта', 'g3 should auto-close');
        }));

        results.push(await it('expanding to a full linked group via "Выбрать группу" then settling closes every game in the group', async () => {
            await checkGames(page, [g4]);
            await calcDebts(page);
            await clickGroupButton(page, g4);
            await page.waitForFunction(() => {
                const p = document.getElementById('debts-panel');
                return p && p.innerText.trim().length > 0 && !p.innerText.includes('Считаем');
            });
            await settleFirst(page);
            await new Promise((r) => setTimeout(r, 800));
            assertEqual(await badgeFor(page, g4), 'Закрыта', 'g4 should auto-close');
            assertEqual(await badgeFor(page, g5), 'Закрыта', 'g5 should auto-close (not just the originally-checked g4)');
        }));
    } finally {
        await cleanupGames(gameIds).catch(() => {});
        await del('payments?from_name=like.QA_AC2_*').catch(() => {});
        await browser.close();
    }

    return tally(results);
}

module.exports = { run };
