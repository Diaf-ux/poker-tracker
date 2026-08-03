// Scenario 4: leaderboard aggregates (games/W-L/WR%/avg/total) match hand-
// computed expectations for seeded players. Uses unique QA_ names so the
// assertions only check those specific rows, ignoring whatever other real
// data already exists in the dev DB.
const { launchPage, gotoTab } = require('../helpers/env');
const { createGame, createPlayer, cleanupGames } = require('../helpers/seed');
const { assertEqual, assertTrue, it, tally } = require('../helpers/assert');

async function run() {
    const results = [];
    const gameIds = [];
    const { browser, page } = await launchPage();

    try {
        const p1 = 'QA_LB1_' + Date.now();
        const p2 = 'QA_LB2_' + Date.now();
        // p1: +50, -20, +30 -> 3 games, 2W/1L, total 60, avg 20, WR 67%
        // p2: -50, +20, -30 -> 3 games, 1W/2L, total -60, avg -20, WR 33%
        for (const [d1, d2] of [[50, -50], [-20, 20], [30, -30]]) {
            const g = await createGame('QA_lb_game_' + Date.now() + '_' + d1);
            await createPlayer(g, p1, d1);
            await createPlayer(g, p2, d2);
            gameIds.push(g);
        }

        await gotoTab(page, 1);
        await page.waitForSelector('.leader-table');

        function rowFor(name) {
            return page.evaluate((name) => {
                const row = Array.from(document.querySelectorAll('.leader-table tbody tr'))
                    .find((tr) => tr.children[1].textContent.trim() === name);
                if (!row) return null;
                const c = Array.from(row.children).map((td) => td.textContent.trim());
                return { games: c[2], wl: c[3], wr: c[4], avg: c[5], total: c[6] };
            }, name);
        }

        results.push(await it('winning player: correct games/W-L/WR%/avg/total', async () => {
            const row = await rowFor(p1);
            assertTrue(row !== null, p1 + ' row not found');
            assertEqual(row.games, '3', 'games count');
            assertEqual(row.wl, '2/1', 'W/L');
            assertEqual(row.wr, '67%', 'win rate');
            assertTrue(row.avg.includes('+20.00'), 'avg per game');
            assertTrue(row.total.includes('+60.00'), 'total');
        }));

        results.push(await it('losing player: correct games/W-L/WR%/avg/total', async () => {
            const row = await rowFor(p2);
            assertTrue(row !== null, p2 + ' row not found');
            assertEqual(row.games, '3', 'games count');
            assertEqual(row.wl, '1/2', 'W/L');
            assertEqual(row.wr, '33%', 'win rate');
            assertTrue(row.avg.includes('-20.00'), 'avg per game');
            assertTrue(row.total.includes('-60.00'), 'total');
        }));

        results.push(await it('winning player ranks above losing player', async () => {
            const order = await page.evaluate(() =>
                Array.from(document.querySelectorAll('.leader-table tbody tr')).map((tr) => tr.children[1].textContent.trim()));
            assertTrue(order.indexOf(p1) < order.indexOf(p2), 'p1 should rank higher than p2');
        }));
    } finally {
        await cleanupGames(gameIds).catch(() => {});
        await browser.close();
    }

    return tally(results);
}

module.exports = { run };
