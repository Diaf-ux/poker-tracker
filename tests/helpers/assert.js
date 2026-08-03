// Minimal dependency-free test runner. No framework precedent exists in this
// repo (no package.json anywhere) - kept intentionally tiny.

function assertEqual(actual, expected, msg) {
    if (actual !== expected) {
        throw new Error((msg || 'assertEqual failed') + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
    }
}

function assertTrue(cond, msg) {
    if (!cond) throw new Error(msg || 'assertTrue failed');
}

function assertIncludes(haystack, needle, msg) {
    if (!String(haystack).includes(needle)) {
        throw new Error((msg || 'assertIncludes failed') + ': expected to find ' + JSON.stringify(needle) + ' in ' + JSON.stringify(haystack));
    }
}

// Runs one check, logs PASS/FAIL, returns true/false (never throws). Scenario
// files collect these into an array and tally it into {passed,failed,total}.
async function it(name, fn) {
    try {
        await fn();
        console.log('  PASS - ' + name);
        return true;
    } catch (e) {
        console.error('  FAIL - ' + name + ': ' + e.message);
        return false;
    }
}

function tally(results) {
    var passed = results.filter(Boolean).length;
    return { passed: passed, failed: results.length - passed, total: results.length };
}

module.exports = { assertEqual, assertTrue, assertIncludes, it, tally };
