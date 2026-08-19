// Scenario 3: multi-game debt calculation, paid/unpaid display, and the
// regression case for the payment-clamping bug (a payment only ever counts
// once its *entire* game_ids set is part of the current selection - never
// merely overlapping - and is then applied unclamped; a payment that only
// partially overlaps is skipped entirely and surfaced via a "select the
// missing games" note. See docs/known-issue-payment-clamp-residual.md).
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

// Clicks a #debts-panel .settle-btn by its visible text - needed once the skipped-payment
// note's "Добавить игры" button can also be a .settle-btn, so "first one in the DOM" is no
// longer a safe way to find the "✓ Оплатил"/"Добавить игры" button you actually want.
async function clickPanelButton(page, text) {
    const before = await page.evaluate(() => document.getElementById('debts-panel').innerText);
    await page.evaluate((text) => {
        const btn = Array.from(document.querySelectorAll('#debts-panel .settle-btn'))
            .find((b) => b.textContent.includes(text));
        if (!btn) throw new Error('no .settle-btn with text ' + text);
        btn.click();
    }, text);
    await page.waitForFunction((prev) => {
        const t = document.getElementById('debts-panel').innerText;
        return t !== prev && t.trim().length > 0 && !t.includes('Считаем');
    }, {}, before);
}

// A settle-triggered multi-game auto-close check re-renders (and briefly resets
// to a loading state) the debts panel a second time shortly after the first
// render (see settleDebt()'s auto-close path in js/history.js) - poll instead
// of checking once so this doesn't race a transient loading blip.
async function hasSettledClass(page) {
    try {
        await page.waitForFunction(() => document.querySelectorAll('#debts-panel .settled').length > 0, { timeout: 3000 });
        return true;
    } catch (e) {
        return false;
    }
}

// Single-game selections that zero out trigger _doUpdateDebts()'s own auto-close branch
// (js/history.js), which PATCHes is_closed then calls renderHistoryCards() -> _doUpdateDebts()
// again, asynchronously replacing #debts-panel's DOM a second time shortly after the first
// render calcDebts() already waited for. Poll until two consecutive reads match (and aren't
// the loading state) before interacting further, so a click/read doesn't land on a
// soon-to-be-replaced element or a transient "Считаем" blip.
async function waitForStablePanel(page) {
    let prev = null;
    for (let i = 0; i < 12; i++) {
        const cur = await page.evaluate(() => {
            const p = document.getElementById('debts-panel');
            return p ? p.innerText : '';
        });
        if (cur === prev && !cur.includes('Считаем')) return;
        prev = cur;
        await new Promise((r) => setTimeout(r, 150));
    }
}

// The "Уже оплачено" list is collapsed (display:none) by default - .innerText excludes
// hidden-element text, so any assertion checking paid amounts must expand it first.
async function expandPaidList(page) {
    await waitForStablePanel(page);
    await page.evaluate(() => {
        const header = document.querySelector('#debts-panel .paid-toggle');
        if (header) header.click();
    });
}

async function panelText(page) {
    return page.evaluate(() => document.getElementById('debts-panel').innerText);
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

        results.push(await it('settling the combined debt in one payment marks it paid (fully-contained payment, unclamped)', async () => {
            await settleFirst(page);
            var txt = await panelText(page);
            assertTrue(txt.includes('Все долги оплачены'), 'expected fully-paid message');
            assertTrue(txt.includes('Уже оплачено (1)'), 'expected paid header with count');
            assertTrue(!txt.includes('80.00'), '80.00 must not be visible while the paid list is collapsed');
            await expandPaidList(page);
            txt = await panelText(page);
            assertTrue(txt.includes('80.00'), 'expected the 80.00 amount visible after expanding the paid list');
            assertTrue(await hasSettledClass(page), 'paid entry must render with the .settled (struck-through) class');
            // settling a >1-game selection kicks off an async auto-close check
            // (js/history.js settleDebt()) that re-renders history cards shortly
            // after - let it settle before driving more checkbox interactions.
            await new Promise((r) => setTimeout(r, 800));
        }));

        results.push(await it('a payment is skipped (not clamped) when the selection is a strict subset of its game_ids', async () => {
            await checkGames(page, [gA]);
            const txt = await calcDebts(page);
            // Before the fix this could clamp/flip the balance. Now the payment simply
            // isn't counted for this narrower view - the raw, unpaid game-A debt (50.00)
            // must show, never a wrong/flipped number, and never silently as "paid".
            assertTrue(!/QA_D_Bob[\s\S]*?→[\s\S]*?QA_D_Alice/.test(txt), 'balance must not flip direction for a narrower selection');
            assertTrue(txt.includes('QA_D_Alice') && txt.includes('QA_D_Bob') && txt.includes('50.00'), 'expected the raw, unpaid game A debt (50.00)');
            assertTrue(txt.includes('расчёт неполный') && txt.includes('заблокирована'), 'expected the skipped-payment note explaining why settling is blocked');
            assertTrue(!txt.includes('Проверьте платежи вручную'), 'the old generic residual warning must be gone');
            assertTrue(!txt.includes('Уже оплачено'), 'the wider payment must not appear as paid in this narrower view');
            const disabledCount = await page.evaluate(() =>
                document.querySelectorAll('#debts-panel .transactions .settle-btn[disabled]').length);
            assertTrue(disabledCount > 0, 'the "✓ Оплатил" button(s) must be disabled while a payment is skipped');
            const addGamesEnabled = await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('#debts-panel .settle-btn'))
                    .find((b) => b.textContent.includes('Добавить игры'));
                return !!btn && !btn.disabled;
            });
            assertTrue(addGamesEnabled, '"Добавить игры" must stay enabled even while settling is blocked');
        }));

        results.push(await it('"Добавить игры" adds the missing game back and fully resolves the previously-skipped payment', async () => {
            await clickPanelButton(page, 'Добавить игры');
            const txt = await page.evaluate(() => document.getElementById('debts-panel').innerText);
            assertTrue(txt.includes('Все долги оплачены'), 'expected fully-paid once the missing game (gB) is added back');
            await new Promise((r) => setTimeout(r, 800));
        }));

        // G_C: payment pre-recorded for G_C alone (20), then view G_C+G_D together -
        // a fully-contained single-game payment nested inside a wider selection.
        const gC = await createGame('QA_debts_C_' + Date.now());
        await createPlayer(gC, 'QA_D2_Alice', -20);
        await createPlayer(gC, 'QA_D2_Bob', 20);
        const gD = await createGame('QA_debts_D_' + Date.now());
        await createPlayer(gD, 'QA_D2_Alice', -15);
        await createPlayer(gD, 'QA_D2_Bob', 15);
        gameIds.push(gC, gD);
        await createPayment('QA_D2_Alice', 'QA_D2_Bob', 20, [gC]);

        // G_E/G_F: mirrors the real prod shape found during design - a payment that
        // pays off one player's share of a combined group while leaving another
        // player's debt in the same group genuinely, correctly untouched (not a
        // clamp artifact - this is real leftover debt that must show correctly).
        const gE = await createGame('QA_debts_E_' + Date.now());
        await createPlayer(gE, 'QA_D3_Alice', -30);
        await createPlayer(gE, 'QA_D3_Bob', 30);
        const gF = await createGame('QA_debts_F_' + Date.now());
        await createPlayer(gF, 'QA_D3_Carol', -20);
        await createPlayer(gF, 'QA_D3_Bob', 20);
        gameIds.push(gE, gF);
        await createPayment('QA_D3_Alice', 'QA_D3_Bob', 30, [gE, gF]);

        // G_G: a single-game payment exactly matching a single-game selection -
        // the simplest possible fully-contained case (regression guard).
        const gG = await createGame('QA_debts_G_' + Date.now());
        await createPlayer(gG, 'QA_D4_Alice', -10);
        await createPlayer(gG, 'QA_D4_Bob', 10);
        gameIds.push(gG);
        await createPayment('QA_D4_Alice', 'QA_D4_Bob', 10, [gG]);

        // gC..gG and their payments were seeded directly in the DB, bypassing the
        // page's in-memory allGamesCache/paymentsCache/gameGroupsCache (those only
        // get invalidated by real UI actions like settleDebt()) - force a refetch
        // so the new fixtures are actually visible to the running page.
        await page.evaluate(() => { paymentsCache = null; });
        await gotoTab(page, 2);
        await page.waitForSelector('.history-card');

        results.push(await it('a subset-covering payment correctly reduces a wider combined selection', async () => {
            await checkGames(page, [gC, gD]);
            let txt = await calcDebts(page);
            assertTrue(txt.includes('15.00'), 'expected 15.00 remaining (35 combined - 20 already paid)');
            assertTrue(txt.includes('Уже оплачено (1)'), 'expected paid header with count');
            assertTrue(!txt.includes('расчёт неполный'), 'no skipped-payment note expected here - the payment is fully contained');
            await expandPaidList(page);
            txt = await panelText(page);
            assertTrue(txt.includes('20.00'), 'expected 20.00 visible after expanding the paid list');
        }));

        results.push(await it('a genuine partial settlement leaves the untouched player\'s real debt showing exactly, not zeroed/hidden', async () => {
            await checkGames(page, [gE, gF]);
            let txt = await calcDebts(page);
            assertTrue(txt.includes('QA_D3_Carol') && txt.includes('QA_D3_Bob') && txt.includes('20.00'), 'expected Carol\'s untouched 20.00 debt to Bob');
            const owingSection = txt.split('Уже оплачено')[0];
            assertTrue(!owingSection.includes('QA_D3_Alice'), 'Alice\'s debt was fully paid off and must not appear in the still-owing section');
            assertTrue(txt.includes('Уже оплачено (1)'), 'expected paid header with count');
            await expandPaidList(page);
            txt = await panelText(page);
            assertTrue(txt.includes('30.00'), 'expected the 30.00 payment visible after expanding the paid list');
        }));

        results.push(await it('a single-game payment exactly matching a single-game selection settles cleanly', async () => {
            await checkGames(page, [gG]);
            let txt = await calcDebts(page);
            assertTrue(txt.includes('Все долги оплачены'), 'expected fully-paid for the self-contained single-game payment');
            assertTrue(txt.includes('Уже оплачено (1)'), 'expected paid header with count');
            await expandPaidList(page);
            txt = await panelText(page);
            assertTrue(txt.includes('10.00'), 'expected 10.00 visible after expanding the paid list');
            assertTrue(await hasSettledClass(page), 'paid entry must render with the .settled (struck-through) class');
        }));
    } finally {
        await cleanupGames(gameIds).catch(() => {});
        await del('payments?from_name=like.QA_D*').catch(() => {});
        await browser.close();
    }

    return tally(results);
}

module.exports = { run };
