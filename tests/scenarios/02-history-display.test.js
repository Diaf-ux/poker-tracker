// Scenario 2: games/players seeded directly are rendered correctly in the
// history tab (card titles, dates, per-player rows, badges).
const { launchPage, gotoTab } = require('../helpers/env');
const { createGame, createPlayer, cleanupGames } = require('../helpers/seed');
const { assertEqual, assertTrue, it, tally } = require('../helpers/assert');

async function run() {
    const results = [];
    const gameIds = [];
    const { browser, page } = await launchPage();

    try {
        const openName = 'QA_hist_open_' + Date.now();
        const closedName = 'QA_hist_closed_' + Date.now();
        const g1 = await createGame(openName);
        await createPlayer(g1, 'QA_H1', 40);
        await createPlayer(g1, 'QA_H2', -40);
        const g2 = await createGame(closedName, { is_closed: true });
        await createPlayer(g2, 'QA_H1', 10);
        await createPlayer(g2, 'QA_H2', -10);
        gameIds.push(g1, g2);

        await gotoTab(page, 2);
        await page.waitForSelector('.history-card');

        results.push(await it('open game card shows correct title, badge and per-player rows', async () => {
            const info = await page.evaluate((name) => {
                const card = Array.from(document.querySelectorAll('.history-card'))
                    .find((c) => c.querySelector('.history-card-title').textContent.includes(name));
                if (!card) return null;
                return {
                    badge: card.querySelector('.badge').textContent.trim(),
                    rows: Array.from(card.querySelectorAll('.history-mini-table tbody tr')).map((tr) =>
                        Array.from(tr.children).map((td) => td.textContent.trim())),
                };
            }, openName);
            assertTrue(info !== null, 'open game card not found');
            assertEqual(info.badge, 'Открыта', 'open game badge');
            const byName = Object.fromEntries(info.rows.map((r) => [r[0], r]));
            assertTrue(byName['QA_H1'][3].includes('+40.00'), 'QA_H1 diff shown');
            assertTrue(byName['QA_H2'][3].includes('-40.00'), 'QA_H2 diff shown');
        }));

        results.push(await it('closed game card shows "Закрыта" badge', async () => {
            const badge = await page.evaluate((name) => {
                const card = Array.from(document.querySelectorAll('.history-card'))
                    .find((c) => c.querySelector('.history-card-title').textContent.includes(name));
                return card ? card.querySelector('.badge').textContent.trim() : null;
            }, closedName);
            assertEqual(badge, 'Закрыта', 'closed game badge');
        }));

        results.push(await it('player filter pills list every unique player name', async () => {
            const pillNames = await page.evaluate(() =>
                Array.from(document.querySelectorAll('.filter-pill')).map((b) => b.textContent.trim()));
            assertTrue(pillNames.includes('QA_H1'), 'QA_H1 pill present');
            assertTrue(pillNames.includes('QA_H2'), 'QA_H2 pill present');
        }));
    } finally {
        await cleanupGames(gameIds).catch(() => {});
        await browser.close();
    }

    return tally(results);
}

module.exports = { run };
