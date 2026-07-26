/**
 * @file test/unit/no-silent-catch.test.ts
 * @description Tests for the aimeat/no-silent-catch ESLint rule. A lint rule that is wrong in either
 *   direction is worse than no rule: false negatives let the bug class back in, and false positives
 *   get silenced with blanket disables until the rule means nothing. Both directions are asserted
 *   here — especially the handlers that must stay ACCEPTED (HTTP response, typed failure, rethrow).
 * @usage cd aimeat && pnpm exec vitest run test/unit/no-silent-catch.test.ts
 * @version-history
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
});
