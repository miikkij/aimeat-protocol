/**
 * @file scripts/demo-video/selfcheck.mjs
 * @description Proves the recorder's wait actually waits, against a page that serves the same
 *   kind of CSP the app does. A predicate that never blocks is not a check, and a run that races
 *   past its own conditions still prints a tidy scene list and still saves a video, so nothing in
 *   the output reveals it. Two separate bugs hid here; this is what would have caught both.
 * @usage node scripts/demo-video/selfcheck.mjs
 * @version-history
 *   v1.1.0 - 2026-07-26 - tests the real waitUntil, and under a no-unsafe-eval CSP
 *   v1.0.0 - 2026-07-26 - added after five takes died on unwaited conditions
 */
import { chromium } from '@playwright/test';
import { waitUntil } from './wait.mjs';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

/* The board is served with script-src that has no 'unsafe-eval'; the first fix worked in a plain
   page and threw EvalError against the real app. So the test page carries the same restriction. */
await page.route('**/selfcheck', (route) => route.fulfill({
    status: 200,
    headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': "script-src 'self' 'unsafe-inline'" },
    body: '<!doctype html><div id="a">here</div>',
}));
await page.goto('https://example.com/selfcheck');

const results = [];
async function check(label, code, expect, ms = 1500) {
    const t0 = Date.now();
    let got;
    try {
        await waitUntil(page, { code, ms, pollMs: 100 });
        got = 'passed';
    } catch (e) { got = /timed out/.test(e.message) ? 'waited' : 'threw: ' + e.message.slice(0, 60); }
    results.push({ label, got, ms: Date.now() - t0, ok: got === expect });
}

await check('a false predicate blocks', '() => false', 'waited');
await check('a true predicate passes', '() => true', 'passed');
await check('a missing element blocks', '() => !!document.getElementById("nope")', 'waited');
await check('a present element passes', '() => !!document.getElementById("a")', 'passed');
await check('an element that appears later passes',
    '() => { if (!window.__t) { window.__t = 1; setTimeout(() => { const d = document.createElement("div"); d.id = "late"; document.body.appendChild(d); }, 400); } return !!document.getElementById("late"); }',
    'passed', 3000);

await browser.close();
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.label}: ${r.got} in ${r.ms}ms`);
const bad = results.filter((r) => !r.ok).length;
if (bad) { console.error(bad + ' check(s) failed: the recorder is not really waiting'); process.exit(1); }
console.log('waitUntil genuinely waits, under CSP');
