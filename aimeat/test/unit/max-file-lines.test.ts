/**
 * @file test/unit/max-file-lines.test.ts
 * @description Tests for the aimeat/max-file-lines ESLint rule: the limit counts the lines after the
 *   file's leading header comment, so a long @version-history no longer pushes a file over it; a file
 *   with no leading header counts every line; a block comment that is not first in the file does not
 *   count as the header; a trailing newline is not a line.
 * @usage cd aimeat && pnpm exec vitest run test/unit/max-file-lines.test.ts
 * @version-history
 *   2026-11-05 — Initial (codebase analysis 2026-11-03, item D-c; Jouni 2026-11-05, decision 15).
 */
import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import { maxFileLines } from '../../eslint-rules/max-file-lines.js';

const ruleTester = new RuleTester({
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

const header = (n: number): string => ['/**', ...Array.from({ length: n }, (_, i) => ` * history line ${i}`), ' */'].join('\n');
const code = (n: number): string => Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join('\n');

describe('aimeat/max-file-lines', () => {
    it('counts the lines after the leading header, and every line when there is none', () => {
        ruleTester.run('max-file-lines', maxFileLines as never, {
            valid: [
                // 52 header lines and 5 code lines: 5 counted.
                { code: `${header(50)}\n${code(5)}\n`, options: [{ max: 5 }] },
                // A shebang before the header does not stop it being the header.
                { code: `#!/usr/bin/env node\n${header(20)}\n${code(4)}\n`, options: [{ max: 5 }] },
                // No header: 5 lines, limit 5.
                { code: `${code(5)}\n`, options: [{ max: 5 }] },
            ],
            invalid: [
                // No header: 6 lines over a limit of 5.
                { code: `${code(6)}\n`, options: [{ max: 5 }], errors: [{ messageId: 'tooLong' }] },
                // Header plus 6 code lines over a limit of 5.
                { code: `${header(30)}\n${code(6)}\n`, options: [{ max: 5 }], errors: [{ messageId: 'tooLong' }] },
                // A block comment after code is not the leading header: every line counts.
                { code: `export const a = 1;\n${header(10)}\n${code(2)}\n`, options: [{ max: 5 }], errors: [{ messageId: 'tooLong' }] },
            ],
        });
    });
});
