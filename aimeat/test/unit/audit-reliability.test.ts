/**
 * @file audit-reliability.test.ts
 * @description A1-A4 audit regression checks run in the regular unit gate.
 * @version-history
 *  - 1.0.0 (2026-09-08): run the native ESM audit tests without invoking a paid AI.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('audit errors and incomplete coverage cannot become approvals', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  expect(() => execFileSync(process.execPath, ['--test', resolve(root, 'security/semantic-audit/reliability.test.mjs')],
    { cwd: root, stdio: 'pipe' })).not.toThrow();
});
