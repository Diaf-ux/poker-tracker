// Runs every scenario in tests/scenarios/ sequentially (they share the same
// dev DB, so parallelizing risks cross-test interference) and exits nonzero
// if anything failed. See `just test` in the justfile.
const { cleanupAllQA } = require('./helpers/seed');

const scenarios = [
    './scenarios/01-create-game-flow.test.js',
    './scenarios/02-history-display.test.js',
    './scenarios/03-multi-game-debts.test.js',
    './scenarios/04-leaderboard-stats.test.js',
    './scenarios/05-chip-conservation-validation.test.js',
    './scenarios/06-auto-close-on-settle.test.js',
    './scenarios/07-linked-game-groups.test.js',
    './scenarios/08-temporary-settle-gates.test.js',
];

(async () => {
    // Belt-and-suspenders: clear out anything a previous crashed run left behind.
    await cleanupAllQA().catch((e) => console.warn('[pre-run cleanup] ' + e.message));

    let totalPassed = 0, totalFailed = 0;
    for (const path of scenarios) {
        const mod = require(path);
        let result;
        try {
            result = await mod.run();
        } catch (e) {
            console.error('SCENARIO CRASHED: ' + path + ': ' + (e.stack || e.message));
            result = { passed: 0, failed: 1, total: 1 };
        }
        totalPassed += result.passed;
        totalFailed += result.failed;
    }

    await cleanupAllQA().catch((e) => console.warn('[post-run cleanup] ' + e.message));

    console.log('\n' + '='.repeat(40));
    console.log(totalFailed === 0
        ? 'ALL PASSED (' + totalPassed + ')'
        : (totalFailed + ' FAILURES, ' + totalPassed + ' passed'));
    process.exit(totalFailed === 0 ? 0 : 1);
})();
