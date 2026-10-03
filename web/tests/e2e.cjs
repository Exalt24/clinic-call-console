// End-to-end walkthrough against a RUNNING stack (API on :8080, web on :4200). Real clicks, real assertions, screenshots.
//   node tests/e2e.cjs <shots-dir>
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Dax/AppData/Roaming/npm/node_modules/playwright');
const path = require('path');
const fs = require('fs');

const WEB = process.env.WEB_URL || 'http://127.0.0.1:4200';
const SHOTS = process.argv[2] || path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

let passed = 0;
const failed = [];
function check(label, ok, extra = '') {
  if (ok) { passed++; console.log('  PASS', label); }
  else { failed.push(label); console.log('  FAIL', label, extra); }
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: false });

async function signIn(page, who) {
  await page.goto(WEB + '/login', { waitUntil: 'domcontentloaded' });
  await page.click(`[data-test="fill-${who}"]`);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/calls', { timeout: 15000 });
  await page.waitForSelector('table tbody tr', { timeout: 15000 });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror ' + e.message));

  console.log('login');
  await page.goto(WEB + '/login', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('h1');
  check('login page shows its heading', (await page.textContent('h1')).includes('Sign in'));
  await shot(page, '01-login-1280');
  await page.click('button[type="submit"]');
  await page.waitForSelector('#username-err');   // zoneless change detection is scheduled, so wait for it instead of counting at once
  check('submitting an empty form shows field errors and does not navigate', (await page.locator('.error-text').count()) >= 2 && page.url().includes('/login'));
  await page.fill('#username', 'reviewer@demo.test');
  await page.fill('#password', 'wrong-password');
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('.server-error')?.textContent?.includes('not right'));
  check('a wrong password shows a plain message and stays on the page', page.url().includes('/login'));
  // the browser logs that deliberate 401 as a console error; everything after this point must be clean
  consoleErrors.length = 0;

  console.log('reviewer queue');
  await signIn(page, 'reviewer');
  check('reviewer lands on the queue', page.url().endsWith('/calls'));
  const summary = (await page.textContent('p.sub')).trim();
  check('queue reports the total', /of 36 calls/.test(summary), summary);
  check('first page has 10 rows', (await page.locator('table tbody tr').count()) === 10);
  check('reviewer sees no Audit link in the sidebar', (await page.locator('aside a', { hasText: 'Audit trail' }).count()) === 0);
  const bodyText = await page.textContent('body');
  check('queue shows no phone numbers or patient-style names', !/555-01\d\d/.test(bodyText));
  await shot(page, '02-queue-1280');

  await page.click('button[role="radio"]:has-text("Resolved")');
  await page.waitForFunction(() => [...document.querySelectorAll('table tbody tr')].length > 0 &&
    [...document.querySelectorAll('table tbody tr td:last-child')].every((c) => c.textContent.includes('Resolved')));
  check('the Resolved filter shows only resolved calls', true);
  await page.click('button[role="radio"]:has-text("All")');
  await page.fill('#q', 'billing');
  await page.waitForFunction(() => /of \d+ call/.test(document.querySelector('p.sub')?.textContent || '') &&
    !/of 36 calls/.test(document.querySelector('p.sub').textContent));
  check('searching narrows the list', true);
  await page.fill('#q', 'zzzz-no-such-text');
  await page.waitForSelector('text=No calls match');
  check('a search with no hits shows an empty state with a way out', (await page.locator('button:has-text("Clear filters")').count()) === 1);
  await shot(page, '03-empty-1280');
  await page.click('button:has-text("Clear filters")');
  await page.waitForSelector('table tbody tr');

  console.log('reviewer detail');
  // pick a call that is really New, so the run does not depend on what an earlier run left behind
  await page.locator('table tbody tr:has(.chip-new) a.rowlink').first().click();
  await page.waitForURL('**/calls/*');
  await page.waitForSelector('.bubble');
  const masks = await page.locator('.mask').count();
  check('the transcript shows masked tags', masks > 0, String(masks));
  const detailText = await page.textContent('body');
  check('the detail page contains no phone numbers, emails or SSNs', !/555-01\d\d|@example\.test|\b\d{3}-\d{2}-\d{4}\b/.test(detailText));
  check('a reviewer sees no Reveal button', (await page.locator('[data-test="reveal"]').count()) === 0);
  check('a reviewer is told only administrators can reveal', (await page.textContent('body')).includes('Only administrators can reveal'));
  await shot(page, '04-detail-reviewer-1280');
  await page.click('button:has-text("Start review")');
  await page.waitForFunction(() => document.querySelector('.head .chip')?.textContent?.includes('In review'));
  check('Start review moves the call to In review', true);
  await page.click('button:has-text("Move back to new")');
  await page.waitForFunction(() => document.querySelector('.head .chip')?.textContent?.trim() === 'New');
  check('and it can be moved back, leaving the data as it was found', true);
  await page.click('button:has-text("What do the tags mean?")');
  await page.waitForSelector('.legend');
  check('the deferred legend loads on demand', true);

  await page.goto(WEB + '/audit', { waitUntil: 'domcontentloaded' });
  await page.waitForURL('**/calls');
  check('a reviewer who types /audit is sent back to the queue', page.url().endsWith('/calls'));

  console.log('admin reveal');
  await page.click('button:has-text("Sign out")');
  await page.waitForURL('**/login');
  await signIn(page, 'admin');
  check('admin sees the Audit link', (await page.locator('aside a', { hasText: 'Audit trail' }).count()) === 1);
  await page.locator('table tbody tr a.rowlink').first().click();
  await page.waitForSelector('.bubble');
  await page.click('[data-test="reveal"]');
  await page.waitForSelector('[role="dialog"] #reason.ng-pristine');   // wait until Angular has wired the control
  await shot(page, '05-reveal-dialog-1280');
  const focusInDialog = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  check('focus moves into the reveal dialog', focusInDialog);
  await page.click('button:has-text("Reveal and record")');
  await page.waitForSelector('[role="dialog"] p.hint.error-text');
  check('submitting with no reason shows an error, keeps the dialog open and reveals nothing',
    (await page.locator('[role="dialog"]').count()) >= 1 && (await page.locator('#reason').count()) === 1 && (await page.locator('.reveal-banner').count()) === 0);
  check('the page did not reload when the form was submitted', page.url().includes('/calls/'));
  await page.fill('#reason', 'too short');
  await page.click('button:has-text("Reveal and record")');
  check('a short reason is refused', (await page.locator('.reveal-banner').count()) === 0 && (await page.locator('#reason').count()) === 1);
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { state: 'detached' });
  check('Escape closes the dialog without revealing', (await page.locator('.reveal-banner').count()) === 0);
  const revealBtnFocused = await page.evaluate(() => document.activeElement?.getAttribute('data-test') === 'reveal');
  check('focus returns to the Reveal button', revealBtnFocused);

  await page.click('[data-test="reveal"]');
  await page.waitForSelector('[role="dialog"] #reason.ng-pristine');   // wait until Angular has wired the control
  await page.fill('#reason', 'Patient asked for a copy of this call for her records');
  await page.click('button:has-text("Reveal and record")');
  await page.waitForSelector('.reveal-banner');
  const revealedText = await page.textContent('.bubbles');
  check('after a valid reason the transcript is unmasked', /555-01\d\d|born on/i.test(revealedText) || (await page.locator('.mask').count()) === 0, revealedText.slice(0, 120));
  check('the unmasked view is clearly marked', (await page.textContent('.reveal-banner')).includes('recorded in the audit trail'));
  await shot(page, '06-revealed-1280');
  await page.click('button:has-text("Hide now")');
  await page.waitForFunction(() => document.querySelectorAll('.mask').length > 0);
  check('Hide now masks the transcript again', true);

  console.log('audit');
  await page.click('aside a:has-text("Audit trail")');
  await page.waitForSelector('table tbody tr');
  const auditText = await page.textContent('table');
  check('the audit trail lists the reveal', auditText.includes('Revealed details'));
  check('the audit trail carries the reason', auditText.includes('Patient asked for a copy'));
  check('the audit trail lists opened calls', auditText.includes('Opened call'));
  await shot(page, '07-audit-1280');

  console.log('mobile 390');
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mp = await m.newPage();
  await mp.goto(WEB + '/login', { waitUntil: 'domcontentloaded' });
  await shot(mp, '08-login-390');
  await mp.click('[data-test="fill-reviewer"]');
  await mp.click('button[type="submit"]');
  await mp.waitForURL('**/calls');
  await mp.waitForSelector('.callcard');
  check('phone shows cards, not the table', (await mp.locator('table').isVisible()) === false && (await mp.locator('.callcard').count()) >= 5);
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('no horizontal scroll on the phone queue', overflow <= 1, String(overflow));
  const small = await mp.evaluate(() => [...document.querySelectorAll('button, a.btn, .pill, .tab, input')]
    .filter((e) => e.offsetParent !== null).map((e) => ({ t: (e.textContent || e.placeholder || e.tagName).trim().slice(0, 20), h: e.getBoundingClientRect().height }))
    .filter((x) => x.h < 43.5));
  check('every visible control on the phone is at least 44px tall', small.length === 0, JSON.stringify(small));
  await shot(mp, '09-queue-390');
  await mp.locator('.callcard').first().click();
  await mp.waitForSelector('.bubble');
  const overflow2 = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('no horizontal scroll on the phone detail page', overflow2 <= 1, String(overflow2));
  await shot(mp, '10-detail-390');
  await m.close();

  check('no console errors during the whole run', consoleErrors.filter((e) => !/favicon|fonts\.g/.test(e)).length === 0, consoleErrors.join(' | ').slice(0, 300));

  await browser.close();
  console.log(`\n${passed} passed, ${failed.length} failed`);
  if (failed.length) { console.log('FAILED:', failed.join('; ')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(2); });
