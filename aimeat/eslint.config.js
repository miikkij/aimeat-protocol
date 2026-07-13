/**
 * @file eslint.config.js
 * @description ESLint flat config for AIMEAT project. Includes TypeScript-ESLint recommended
 *   rules plus custom AIMEAT rules for file headers and file size limits.
 *
 * @usage
 *   pnpm lint
 *
 * @version-history
 *   v1.0.0 — 2026-03-13 — Header added; file pre-dates header standard
 *   v1.1.0 — 2026-03-13 — Added custom aimeat plugin (file-header, max-file-lines)
 *   v1.2.0 — 2026-06-05 — Ignore src/generated/** (Prisma clients, openapi types)
 *   v1.3.0 — 2026-06-19 — Lint public/ (frontend); ignore vendored frontend dirs;
 *     defer no-undef to tsc (tsconfig.frontend.json checkJs) for browser globals
 */

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import aimeatPlugin from './eslint-rules/index.js';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'test/**',
      'src/static/**',
      'src/generated/**',
      // Vendored / generated frontend bundles — not our source.
      'public/lib/**',
      'public/cortex-bundled/**',
      'public/samples/**',
    ],
  },
  {
    plugins: {
      aimeat: aimeatPlugin,
    },
    rules: {
      // Cleaned to zero on 2026-07-13 and ratcheted to 'error'. The Prisma storage provider
      // keeps 3 documented per-line disables (dynamic dual client); everything else is typed.
      '@typescript-eslint/no-explicit-any': 'error',
      // Cleaned to zero on 2026-07-13 and ratcheted to 'error' — unused imports/vars/params
      // now fail the pre-commit hook + CI instead of accumulating. Unused args prefixed with `_`.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

      // Custom AIMEAT rules
      // file-header cleaned to zero on 2026-07-13 and ratcheted to 'error' — every source
      // file must carry a header, enforced by the pre-commit hook + CI.
      'aimeat/file-header': 'error',
      // Cap raised 500→800 and ratcheted to 'error' on 2026-07-13 once every source file
      // was brought under 800 (large routes/services/views/storage-providers split into
      // sibling modules). New files over 800 now fail the pre-commit hook + CI.
      'aimeat/max-file-lines': ['error', { max: 800 }],
    },
  },
  {
    // The no-build frontend in public/ is type-checked by tsconfig.frontend.json (checkJs),
    // which detects undefined names with full type info. eslint's no-undef can't see the
    // browser/SDK globals (window, document, AIMEAT, …) and would only flood with false
    // positives that tsc already covers — defer it to tsc.
    files: ['public/**/*.js', 'public/**/*.d.ts'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'no-undef': 'off',
      // Preact uses the same hook contract as React, so these rules apply. Warn-level for now
      // (gradual adoption) — surfaces missing/incorrect effect deps and hook-ordering issues.
      // rules-of-hooks + exhaustive-deps cleaned to zero on 2026-07-13 and ratcheted to
      // 'error'. Intentional mount/[key] effects carry a documented per-line disable with
      // justification; genuine missing deps were added (stable values / useCallback-wrapped).
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      // Legacy-frontend findings surfaced when lint coverage was extended to public/
      // (2026-06-19). Cleaned to zero on 2026-07-13 and ratcheted to 'error' so new
      // occurrences fail the pre-commit hook + CI instead of silently accumulating.
      'no-useless-escape': 'error',
      'preserve-caught-error': 'error',
      'no-useless-assignment': 'error',
    },
  },
);
