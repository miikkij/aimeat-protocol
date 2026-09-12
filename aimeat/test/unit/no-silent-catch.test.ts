/**
 * @file test/unit/no-silent-catch.test.ts
 * @description Tests for the aimeat/no-silent-catch ESLint rule. A lint rule that is wrong in either
 *   direction is worse than no rule: false negatives let the bug class back in, and false positives
 *   get silenced with blanket disables until the rule means nothing. Both directions are asserted
 *   here — especially the handlers that must stay ACCEPTED (HTTP response, typed failure, rethrow).
 * @usage cd aimeat && pnpm exec vitest run test/unit/no-silent-catch.test.ts
 * @version-history
 *   v1.1.0 — 2026-09-13 — The fourth shape, substitutesValue, in both directions: the validator
 *     idiom stays accepted (nine cases, because that is the population a wrong classification would
 *     silence the rule over), and the default-off behaviour is asserted so the config change cannot
 *     arrive without noticing.
 *   v1.0.0 — 2026-07-26 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { RuleTester } from 'eslint';
import { noSilentCatch } from '../../eslint-rules/no-silent-catch.js';

const ruleTester = new RuleTester({
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

describe('aimeat/no-silent-catch', () => {
    it('flags what discards an error and accepts what surfaces it', () => {
        ruleTester.run('no-silent-catch', noSilentCatch as never, {
            valid: [
                // Logged — the failure becomes measurable in production.
                { code: 'try { f(); } catch (err) { logger.error("failed", { err }); }' },
                { code: 'try { f(); } catch { console.warn("nope"); }' },
                // Rethrown, with or without wrapping.
                { code: 'try { f(); } catch (err) { throw err; }' },
                { code: 'try { f(); } catch (err) { throw new Error("wrapped", { cause: err }); }' },
                // Surfaced to the caller: HTTP response, promise rejection, UI state.
                { code: 'try { f(); } catch (err) { res.status(500).json({ error: err.message }); }' },
                { code: 'new Promise((resolve, reject) => { try { f(); } catch (e) { reject(e); } });' },
                { code: 'try { f(); } catch (e) { setError(e.message); }' },
                // A typed failure result that carries the error is a legitimate return.
                { code: 'function g() { try { f(); } catch (err) { return { ok: false, message: err.message }; } }' },
                // Absence return that ALSO logs is a deliberate, visible decision.
                { code: 'function g() { try { f(); } catch (err) { logger.warn("miss", { err }); return null; } }' },
                // Recovery work that uses the error is not a discard.
                { code: 'function g() { try { f(); } catch (err) { return fallbackFor(err); } }' },
            ],
            invalid: [
                {
                    code: 'try { f(); } catch {}',
                    errors: [{ messageId: 'emptyCatch' }],
                },
                {
                    code: 'try { f(); } catch (e) { /* best-effort */ }',
                    errors: [{ messageId: 'emptyCatch' }],
                },
                {
                    // The storage-layer bug class: a failed write becomes "not found".
                    code: 'async function u() { try { return await db.update(); } catch { return null; } }',
                    errors: [{ messageId: 'returnsAbsence' }],
                },
                {
                    code: 'function g() { try { f(); } catch { return false; } }',
                    errors: [{ messageId: 'returnsAbsence' }],
                },
                {
                    code: 'function g() { try { f(); } catch { return []; } }',
                    errors: [{ messageId: 'returnsAbsence' }],
                },
                {
                    // Promise-level swallow.
                    code: 'doWork().catch(() => {});',
                    errors: [{ messageId: 'emptyCatch' }],
                },
                {
                    code: 'doWork().catch(() => null);',
                    errors: [{ messageId: 'returnsAbsence' }],
                },
                {
                    // Does something, but never mentions the error and never tells anyone.
                    code: 'try { f(); } catch (err) { cleanupCounter = 0; }',
                    errors: [{ messageId: 'discardsError' }],
                },
            ],
        });
        // RuleTester throws on failure; reaching here is the assertion.
        expect(true).toBe(true);
    });

    it('says nothing about a substitute answer until asked to', () => {
        // The fourth shape is OFF by default, and that is load-bearing rather than shy: it reports 84
        // handlers in the two directories this rule is already an error in, so turning it on in
        // eslint.config.js would refuse every session's every commit. scripts/check-silent-catch.ts
        // turns it on and measures it against a seeded baseline. If this test ever goes red because
        // the default flipped, the config change belongs in the same commit.
        ruleTester.run('no-silent-catch', noSilentCatch as never, {
            valid: [
                { code: 'function g() { try { f(); } catch { return fallback; } }' },
                { code: 'function g() { try { f(); } catch { return [creatorGhii]; } }' },
            ],
            invalid: [],
        });
        expect(true).toBe(true);
    });

    it('flags a catch that answers with a value saying nothing failed', () => {
        const on = [{ substitutes: true }];
        ruleTester.run('no-silent-catch', noSilentCatch as never, {
            valid: [
                // THE VALIDATOR IDIOM, which is most of this shape's population and must stay
                // accepted: the throw IS the answer, and the answer says so. Flagging these would
                // collect twenty-odd blanket disables and the rule would stop meaning anything.
                { code: 'function g() { try { return new URL(u).hostname; } catch { return { ok: false, reason: "bad URL" }; } }', options: on },
                { code: 'function g() { try { return JSON.parse(r); } catch { return { valid: false }; } }', options: on },
                { code: 'function g() { try { return JSON.parse(r); } catch { return { error: "not JSON" }; } }', options: on },
                // Nested one deep, because a refusal often travels inside a response shape.
                { code: 'function g() { try { return JSON.parse(r); } catch { return { status: 400, body: { code: "NOT_JSON" } }; } }', options: on },
                // Mentions the caught error, so it has looked at it.
                { code: 'function g() { try { f(); } catch (e) { return e.message; } }', options: on },
                { code: 'function g() { try { f(); } catch (e) { return fallbackFor(e); } }', options: on },
                // Already handled by the first three shapes' escapes.
                { code: 'function g() { try { f(); } catch (e) { logger.warn("x", { e }); return cached; } }', options: on },
                { code: 'function g() { try { f(); } catch (e) { throw e; } }', options: on },
                // A truthy flag is not a refusal: `{ ok: true }` says it worked.
                { code: 'function g() { try { f(); } catch (e) { return { ok: true, from: "cache", detail: e }; } }', options: on },
            ],
            invalid: [
                {
                    // The shape that started this: resolveGhii answered a database fault with the
                    // caller's bare account name for six months, inside a directory where this rule
                    // was already an error.
                    code: 'async function r(s, owner, fallback) { try { const rec = await s.get(owner); return rec?.ghii ?? fallback; } catch { return fallback; } }',
                    options: on,
                    errors: [{ messageId: 'substitutesValue' }],
                },
                {
                    // Narrowing an owner list on a corrupt row, indistinguishable from an old row.
                    code: 'function g() { try { return JSON.parse(raw); } catch { return [creatorGhii]; } }',
                    options: on,
                    errors: [{ messageId: 'substitutesValue' }],
                },
                {
                    // A consent pattern that will not compile silently becomes exact match.
                    code: 'function g() { try { return new RegExp(p).test(k); } catch { return k === p; } }',
                    options: on,
                    errors: [{ messageId: 'substitutesValue' }],
                },
                {
                    // An unknown timezone silently becomes UTC, and quiet hours move.
                    code: 'function g() { try { return zoned(tz); } catch { return utc(); } }',
                    options: on,
                    errors: [{ messageId: 'substitutesValue' }],
                },
                {
                    // Promise-level, and a cache is the most confident wrong answer of all.
                    code: 'doWork().catch(() => cached);',
                    options: on,
                    errors: [{ messageId: 'substitutesValue' }],
                },
                {
                    // An absence literal is still shape 2, not shape 4: one finding, the older
                    // message, because "returns null" has its own story and its own fix.
                    code: 'function g() { try { f(); } catch { return null; } }',
                    options: on,
                    errors: [{ messageId: 'returnsAbsence' }],
                },
            ],
        });
        expect(true).toBe(true);
    });
});
