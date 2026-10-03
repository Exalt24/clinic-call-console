// Records a short captioned walkthrough of the REAL running app (API on :8080, web on :4200) to demo/work/*.webm.
// Local only: it refuses to touch anything but 127.0.0.1, and it takes no screenshots (frames of the clip would only repeat
// the README's GIF). It leaves the data as it found it (the status it changes is moved back).
//   node demo/record.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Dax/AppData/Roaming/npm/node_modules/playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = process.env.WEB_URL || 'http://127.0.0.1:4200';
if (!WEB.startsWith('http://127.0.0.1')) throw new Error('refusing to record anything but the local app');
const WORK = path.join(ROOT, 'demo', 'work');
fs.mkdirSync(WORK, { recursive: true });
for (const f of fs.readdirSync(WORK)) if (f.endsWith('.webm')) fs.unlinkSync(path.join(WORK, f));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, colorScheme: 'light', recordVideo: { dir: WORK, size: { width: 1280, height: 720 } } });
const page = await ctx.newPage();
const hold = (ms) => page.waitForTimeout(ms);

// A caption bar drawn inside the page so it is part of the recording. It sits at the bottom, on a solid bar, never over controls
// the walkthrough is about (the app's own content area is shortened to leave room for it).
async function caption(text) {
  await page.evaluate((t) => {
    let bar = document.getElementById('__cap');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = '__cap';
      Object.assign(bar.style, { position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 99999, background: '#14213d', color: '#fff',
        font: '600 20px/1.35 Inter, system-ui, sans-serif', padding: '14px 28px', textAlign: 'center', minHeight: '58px',
        display: 'flex', alignItems: 'center', justifyContent: 'center', letterSpacing: '.01em' });
      document.body.appendChild(bar);
      document.body.style.paddingBottom = '58px';
    }
    bar.textContent = t;
  }, text);
}
async function slowType(sel, text, delay = 38) {
  await page.click(sel);
  await page.type(sel, text, { delay });
}

try {
  await page.goto(WEB + '/login', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('h1');
  await caption('Calls from a clinic voice assistant, reviewed by staff.');
  await hold(2600);

  await caption('Sign in as a reviewer.');
  await page.click('[data-test="fill-reviewer"]');
  await hold(900);
  await page.click('button[type="submit"]');
  await page.waitForSelector('table tbody tr');
  await hold(600);

  await caption('36 calls. Names, numbers and birth dates are already masked.');
  await hold(2800);
  await page.click('button[role="radio"]:has-text("New")');
  await hold(1500);
  await page.fill('#q', 'billing');
  await caption('Search runs over the masked text, never over patient names.');
  await hold(2600);
  await page.fill('#q', '');
  await page.waitForSelector('table tbody tr');

  await caption('Open a call. Every identifier is a tag, not text.');
  await page.locator('table tbody tr:has(.chip-new) a.rowlink').first().click();
  await page.waitForSelector('.bubble');
  await hold(2200);
  await page.mouse.wheel(0, 380);
  await hold(1800);
  await page.mouse.wheel(0, -380);
  await caption('A reviewer cannot reveal anything. The option is not even offered.');
  await page.locator('.locked').scrollIntoViewIfNeeded();
  await hold(2800);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('button:has-text("Start review")');
  await caption('Staff move calls along; every change is recorded.');
  await hold(2200);
  await page.click('button:has-text("Move back to new")');
  await hold(900);

  await page.click('aside button:has-text("Sign out")');
  await page.waitForSelector('h1');
  await caption('Now an administrator.');
  await page.click('[data-test="fill-admin"]');
  await hold(700);
  await page.click('button[type="submit"]');
  await page.waitForSelector('table tbody tr');
  await page.locator('table tbody tr a.rowlink').first().click();
  await page.waitForSelector('.bubble');
  await hold(1200);

  await caption('Revealing needs a reason, and the reason is recorded.');
  await page.click('[data-test="reveal"]');
  await page.waitForSelector('[role="dialog"] #reason.ng-pristine');
  await hold(1400);
  await slowType('#reason', 'Patient asked for a copy of this call');
  await hold(900);
  await page.click('button:has-text("Reveal and record")');
  await page.waitForSelector('.reveal-banner');
  await caption('Unmasked, clearly marked, and hidden again after 60 seconds.');
  await hold(3600);
  await page.click('.reveal-banner button');
  await hold(900);

  await caption('Everything is on the record.');
  await page.click('aside a:has-text("Audit trail")');
  await page.waitForSelector('table tbody tr');
  await hold(3600);
  await caption('Who signed in, who opened which call, who revealed what, and why.');
  await hold(3200);
} finally {
  await ctx.close();   // the video is only written on close
  await browser.close();
}
const out = fs.readdirSync(WORK).filter((f) => f.endsWith('.webm'));
console.log('recorded', out.map((f) => path.join('demo/work', f)).join(', '));
