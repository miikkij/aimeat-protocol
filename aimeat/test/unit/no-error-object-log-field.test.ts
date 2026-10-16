/**
 * @file test/unit/no-error-object-log-field.test.ts
 * @description Tests for the aimeat/no-error-object-log-field ESLint rule: a caught error passed as
 *   a log field is refused, in a catch clause and in a .catch() handler, under any field name and as
 *   a shorthand; the forms that carry the reason as text pass (QA audit E1-04, F5-07, S5-07).
 * @usage cd aimeat && pnpm exec vitest run test/unit/no-error-object-log-field.test.ts
 * @version-history
 *   2026-10-16 — Initial (QA audit E1-04).
 */
import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import { noErrorObjectLogField } from '../../eslint-rules/no-error-object-log-field.js';

const ruleTester = new RuleTester({
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

describe('aimeat/no-error-object-log-field', () => {
    it('refuses a caught error as a log field and accepts its text', () => {
        ruleTester.run('no-error-object-log-field', noErrorObjectLogField as never, {
            valid: [
                { code: 'try { f(); } catch (err) { logger.error("failed", { ...errorFields(err) }); }' },
                { code: 'try { f(); } catch (err) { logger.error("failed", errorFields(err)); }' },
                { code: 'try { f(); } catch (err) { logger.error("failed", { error: String(err) }); }' },
                { code: 'try { f(); } catch (err) { logger.warn("failed", { error: err.message, id }); }' },
                { code: 'p.catch((e) => logger.error("failed", { error: String(e) }));' },
                // Not a caught value: an ordinary variable named err.
                { code: 'const err = "text"; logger.error("failed", { error: err });' },
                // Not a logger call.
                { code: 'try { f(); } catch (err) { report("failed", { error: err }); }' },
            ],
            invalid: [
                {
                    code: 'try { f(); } catch (err) { logger.error("failed", { error: err }); }',
                    errors: [{ messageId: 'errorObject' }],
                },
                {
                    code: 'try { f(); } catch (e) { logger.warn("failed", { id, error: e }); }',
                    errors: [{ messageId: 'errorObject' }],
                },
                {
                    code: 'try { f(); } catch (err) { logger.error("failed", { err }); }',
                    errors: [{ messageId: 'errorObject' }],
                },
                {
                    code: 'p.catch(err => logger.error("failed", { nodeId, error: err }));',
                    errors: [{ messageId: 'errorObject' }],
                },
                {
                    code: 'class A { m() { try { f(); } catch (err) { this.logger.info("x", { cause: err }); } } }',
                    errors: [{ messageId: 'errorObject' }],
                },
            ],
        });
    });
});
