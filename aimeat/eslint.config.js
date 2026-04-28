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
 */

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import aimeatPlugin from './eslint-rules/index.js';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/**', 'node_modules/**', 'test/**', 'src/static/**'],
  },
  {
    plugins: {
      aimeat: aimeatPlugin,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],

      // Custom AIMEAT rules
      'aimeat/file-header': 'warn',
      'aimeat/max-file-lines': ['warn', { max: 500 }],
    },
  },
);
