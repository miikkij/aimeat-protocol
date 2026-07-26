/**
 * @file scripts/demo-video/wait.mjs
 * @description The one wait the recorder uses, in one place so it can be tested.
 *
 *   Two ways of writing this were wrong before this file existed:
 *   1. page.waitForFunction("() => …") — Playwright reads a string as an EXPRESSION, and that
 *      expression's value is a function object, which is truthy. Every wait returned in ~20ms
 *      and five takes raced past checks that looked like verification in the log.
 *   2. page.waitForFunction("(() => …)()") — now a real predicate, but Playwright polls it by
 *      evaluating a string inside the page, and the app serves a CSP without 'unsafe-eval'.
 *
 *   So the loop lives in the driver and polls with page.evaluate, which goes over CDP and is
 *   the same path the recorder's other steps already use against this app.
 * @usage import { waitUntil } from './wait.mjs'
 * @version-history v1.0.0 - 2026-07-26 - extracted so selfcheck.mjs can prove it waits
 */

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll `code` (a string holding an arrow function) until it returns true.
 * @param {import('@playwright/test').Page} page
 * @param {{code: string, ms?: number, pollMs?: number, label?: string}} step
 */
export async function waitUntil(page, step) {
    const deadline = Date.now() + (step.ms || 120000);
    const poll = step.pollMs || 700;
    let last = null;
    for (;;) {
        let ok = false;
        try {
            ok = await page.evaluate(`(${step.code})()`);
        } catch (e) {
            /* A navigation or a re-render mid-poll is normal; a predicate that throws every time
               is not, so the last error is reported when the wait finally gives up. */
            last = e;
            ok = false;
        }
        if (ok) return Date.now();
        if (Date.now() > deadline) {
            throw new Error('waitUntil timed out after ' + (step.ms || 120000) + 'ms: ' +
        (step.label || step.code).slice(0, 120) + (last ? ' (last error: ' + last.message.slice(0, 120) + ')' : ''));
        }
        await sleep(poll);
    }
}
