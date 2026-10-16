/**
 * @file test/helpers/skip.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An explicit skip for an E2E test body, so a test that cannot ask its question under
 *   the runner's settings is counted as skipped and not as passed.
 *
 *   WHY. Each suite's own test() helper counted a body that returned early as passed, and the runner
 *   could not tell the two apart (QA audit 2026-10-16, P1-04, F7b-01). A suite that uses this helper
 *   catches SkipTest in its test() helper, counts it, prints `⏭ <name>: <reason>`, and ends with
 *   `N passed, M failed, K skipped`; the runner shows K in its Skipped column, and a skip in a guard
 *   suite is red there.
 * @usage
 *   import { skip, isSkip } from './helpers/skip.js';
 *   await test('13. 429 carries Retry-After', async () => { if (limit > 50) skip('the runner pins a high limit'); ... });
 * @version-history
 *   v1.0.0 -- 2026-10-16 -- Initial (QA audit W12, P1-04, F7b-01).
 */

export class SkipTest extends Error {
    constructor(reason: string) {
        super(reason);
        this.name = 'SkipTest';
    }
}

/** Stop this test here and count it as skipped, with the reason a reader needs. */
export function skip(reason: string): never {
    throw new SkipTest(reason);
}

export function isSkip(err: unknown): err is SkipTest {
    return err instanceof SkipTest;
}
