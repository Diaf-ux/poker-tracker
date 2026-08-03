// Scenario 3: multi-game debt calculation, paid/unpaid display, and the
// regression case for the payment-clamping bug (a payment covering more
// games than currently selected must never flip a balance's sign - see
// docs/known-issue-payment-clamp-residual.md for the still-open residual case).
const { launchPage, gotoTab } = require('../helpers/env');
const { createGame, createPlayer, createPayment, cleanupGames, del } = require('../helpers/seed');
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

async function settleFirst(page) {
    const before = await page.evaluate(() => document.getElementById('debts-panel').innerText);
    await page.evaluate(() => document.querySelector('#debts-panel .settle-btn').click());
    await page.waitForFunction((prev) => {
        const t = document.getElementById('debts-panel').innerText;
        return t !== prev && t.trim().length > 0 && !t.includes('Считаем');
    }, {}, before);
}

async function run() {
    const results = [];
    const gameIds = [];
    const { browser, page } = await launchPage();

    try {
        // G_A: Alice owes Bob 50, G_B: Alice owes Bob 30 - combined debt 80
        const gA = await createGame('QA_debts_A_' + Date.now());
        await createPlayer(gA, 'QA_D_Alice', -50);
        await createPlayer(gA, 'QA_D_Bob', 50);
        const gB = await createGame('QA_debts_B_' + Date.now());
        await createPlayer(gB, 'QA_D_Alice', -30);
        await createPlayer(gB, 'QA_D_Bob', 30);
        gameIds.push(gA, gB);

        await gotoTab(page, 2);
        await page.waitForSelector('.history-card');

        results.push(await it('combined selection shows the correct summed debt', async () => {
            await checkGames(page, [gA, gB]);
            const txt = await calcDebts(page);
            assertTrue(txt.includes('QA_D_Alice') && txt.includes('QA_D_Bob') && txt.includes('80.00'), 'expected 80.00 combined debt');
        }));

        results.push(await it('settling the combined debt in one payment marks it paid', async () => {
            await settleFirst(page);
            const txt = await page.evaluate(() => document.getElementById('debts-panel').innerText);
            assertTrue(txt.includes('Все долги оплачены'), 'expected fully-paid message');
            assertTrue(txt.includes('Уже оплачено') && txt.includes('80.00'), 'expected paid section with 80.00');
            // settling a >1-game selection kicks off an async auto-close check
            // (js/history.js settleDebt()) that re-renders history cards shortly
            // after - let it settle before driving more checkbox interactions.
            await new Promise((r) => setTimeout(r, 800));
        }));

        results.push(await it('regression: viewing one game alone after the combined payment never flips balance sign', async () => {
            await checkGames(page, [gA]);
            const txt = await calcDebts(page);
            // Before the clamping fix this could render "QA_D_Bob -> QA_D_Alice"
            // (wrong direction). It must never show Bob owing Alice here.
            assertTrue(!/QA_D_Bob[\s\S]*?→[\s\S]*?QA_D_Alice/.test(txt), 'balance must not flip direction for a narrower selection');
            assertTrue(txt.includes('Оплачено общим платежом'), 'expected "paid via wider group" note');
        }));

        // G_C: payment pre-recorded for G_C alone (20), then view G_C+G_D together
        const gC = await createGame('QA_debts_C_' + Date.now());
        await createPlayer(gC, 'QA_D2_Alice', -20);
        await createPlayer(gC, 'QA_D2_Bob', 20);
        const gD = await createGame('QA_debts_D_' + Date.now());
        await createPlayer(gD, 'QA_D2_Alice', -15);
        await createPlayer(gD, 'QA_D2_Bob', 15);
        gameIds.push(gC, gD);
        await createPayment('QA_D2_Alice', 'QA_D2_Bob', 20, [gC]);
        // gC/gD and the payment above were seeded directly in the DB, bypassing
        // the page's in-memory allGamesCache/paymentsCache (those only get
        // invalidated by real UI actions like settleDebt()) - force a refetch of
        // both so the new fixtures are actually visible to the running page.
        await page.evaluate(() => { paymentsCache = null; });
        await gotoTab(page, 2);
        await page.waitForSelector('.history-card');

        results.push(await it('a subset-covering payment correctly reduces a wider combined selection', async () => {
            await checkGames(page, [gC, gD]);
            const txt = await calcDebts(page);
            assertTrue(txt.includes('15.00'), 'expected 15.00 remaining (35 combined - 20 already paid)');
            assertTrue(txt.includes('Уже оплачено') && txt.includes('20.00'), 'expected paid section with 20.00');
        }));
    } finally {
        await cleanupGames(gameIds).catch(() => {});
        await del('payments?from_name=like.QA_D*').catch(() => {});
        await browser.close();
    }

    return tally(results);
}

module.exports = { run };
