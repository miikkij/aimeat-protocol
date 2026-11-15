/**
 * @file test/helpers/harness.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one test harness for E2E suites: test(), assert(), json(), expectRefusal() and
 *   finish(). A new suite imports these instead of writing its own copies.
 *
 *   WHY (report of 2026-11-15, 2.5 and 5.2). 685 of 710 suites carried their own test() function,
 *   452 of them character for character the same, and 47 carried their own retry on 429. A rule
 *   that should hold for every suite (a skip is not a pass, a refusal names its code) then had 685
 *   places to be written in, and was written in few. scripts/check-suite-harness.ts counts the
 *   suites that still define their own test(), and the count may only fall.
 *
 *   OUTPUT. The runner reads the last `N passed, M failed, K skipped` line (scripts/lib/e2e-results.ts
 *   parseResults) and the `❌` lines for the GitHub annotations, so finish() prints exactly that.
 *
 *   A REFUSAL NAMES ITS CODE (5.4). `expectRefusal(res, 403, 'FORBIDDEN')` holds the status AND the
 *   error code. A check on the status alone also passes on the 403 of an unrelated rule, and a check
 *   on the code alone (`body.error?.code !== 'X'`) passes on a 500.
 * @structure BASE · test() · skip (re-export) · assert() · json() · expectRefusal() · finish()
 * @usage
 *   import { assert, expectRefusal, finish, json, test } from './helpers/harness.js';
 *   await test('a stranger is refused', async () => {
 *     const r = await json('/v1/memory/x', { headers: { Authorization: `Bearer ${stranger}` } });
 *     expectRefusal(r, 403, 'FORBIDDEN');
 *   });
 *   finish();
 * @version-history
 *   v1.0.0 -- 2026-11-15 -- Initial (report of 2026-11-15, 5.2 and 5.4).
 */
import { isSkip } from './skip.js';

export { skip } from './skip.js';

/** The node under test, as the runner names it. */
export const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;
let skipped = 0;

/** Run one test: a thrown error fails it, skip() skips it, anything else passes it. */
export async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err) {
        if (isSkip(err)) {
            skipped++;
            console.log(`  ⏭ ${name}: ${err.message}`);
            return;
        }
        failed++;
        console.error(`  ❌ ${name}: ${(err as Error)?.message ?? String(err)}`);
    }
}

export function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

export interface JsonResponse<T = any> { status: number; body: T; headers: Headers }

/** How many times a 429 is waited out before it is returned to the test. */
const MAX_429_RETRIES = 5;

/**
 * A request to the node under test, with a JSON body read back when there is one. A 429 is waited
 * out by its Retry-After (at most five times, at most 10 s each), because a rate limit a suite trips
 * by running fast is not what the suite is asking about; a suite that asks about the limit passes
 * `{ retry429: false }`.
 */
export async function json<T = any>(path: string, opts: RequestInit & { retry429?: boolean } = {}): Promise<JsonResponse<T>> {
    const { retry429 = true, ...init } = opts;
    const url = /^https?:\/\//.test(path) ? path : `${BASE}${path}`;
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) } });
        if (res.status === 429 && retry429 && attempt < MAX_429_RETRIES) {
            const wait = Math.min(10, Math.max(1, Number(res.headers.get('retry-after')) || 1));
            await res.arrayBuffer().catch(() => undefined);
            await new Promise(r => setTimeout(r, wait * 1000));
            continue;
        }
        const text = await res.text();
        let body: any;
        try { body = text ? JSON.parse(text) : null; } catch { body = { _raw: text }; }
        return { status: res.status, body: body as T, headers: res.headers };
    }
}

/**
 * Hold a refusal to its status and, when given, its error code (`body.error.code`, or `body.code`
 * for the routes that answer flat). Throws with what came back, so the failure line says it.
 */
export function expectRefusal(res: { status: number; body: any }, status: number, code?: string): void {
    const got = res.body?.error?.code ?? res.body?.code;
    if (res.status !== status || (code !== undefined && got !== code)) {
        throw new Error(`expected ${status}${code ? ` ${code}` : ''}, got ${res.status}${got ? ` ${got}` : ''}: ${JSON.stringify(res.body).slice(0, 300)}`);
    }
}

/** Print the line the runner reads and exit: 1 when a test failed. */
export function finish(): never {
    console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
    process.exit(failed > 0 ? 1 : 0);
}
