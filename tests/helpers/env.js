// Shared Puppeteer bootstrap for all scenarios. Runs inside the
// ghcr.io/puppeteer/puppeteer image on the poker-tracker_default Docker
// network (see the `just test` recipe in justfile) - never against a host
// localhost:3000 directly, so this works the same for a human dev and an
// agent sandbox with no direct network access to published ports.
const puppeteer = require('puppeteer');
const dns = require('dns').promises;

const APP_PASSWORD = '2769allin'; // matches docker/local.config.js, dev-only

async function launchPage() {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu',
            // Chromium's HTTPS-Upgrades feature throws ERR_SSL_PROTOCOL_ERROR
            // on the bare single-label `app` hostname - disable it (we also
            // resolve to an IP below as a second layer of defense).
            '--disable-features=HttpsUpgrades,HttpsFirstModeV2',
        ],
    });
    const page = await browser.newPage();
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    await page.setViewport({ width: 420, height: 1000 });

    const { address } = await dns.lookup('app');
    await page.goto('http://' + address + ':3000', { waitUntil: 'networkidle0' });
    await page.type('#auth-input', APP_PASSWORD);
    await page.click('.auth-box button');
    await page.waitForSelector('#page-setup.active', { timeout: 5000 });

    page.dialogs = dialogs; // scenarios can assert on captured alert()/confirm() text
    return { browser, page };
}

async function gotoTab(page, index) {
    // 0 = Игра (setup), 1 = Рейтинг (leaderboard), 2 = История (history)
    await page.evaluate((i) => document.querySelectorAll('.nav-tab')[i].click(), index);
}

async function screenshot(page, name) {
    // Must write to a path owned by the container's default user, not a
    // host-bind-mounted dir, or Puppeteer gets EACCES.
    const path = '/home/pptruser/' + name + '.png';
    await page.screenshot({ path, fullPage: true });
    return path;
}

module.exports = { launchPage, gotoTab, screenshot };
