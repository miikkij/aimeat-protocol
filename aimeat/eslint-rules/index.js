/**
 * @file index.js
 * @description Custom ESLint plugin for AIMEAT project rules.
 *   Provides file-header enforcement and max-file-lines checks.
 *
 * @structure
 *   - fileHeader: Enforces @file + @description header comments
 *   - maxFileLines: Warns when files exceed configurable line limit
 *   - noSilentCatch: A caught error must be logged, rethrown, or surfaced to the caller
 *   - noDirectAuth: Frontend reads the session via /js/services/auth.js, not window.AIMEAT.auth
 *
 * @usage
 *   import aimeatPlugin from './eslint-rules/index.js';
 *   // Then add to ESLint flat config plugins
 *
 * @version-history
 *   v1.0.0 — 2026-03-13 — Initial implementation
 *   v1.1.0 — 2026-08-07 — Added no-direct-auth (session single-source cleanup)
 */

import { fileHeader } from './file-header.js';
import { maxFileLines } from './max-file-lines.js';
import { noSilentCatch } from './no-silent-catch.js';
import { noDirectAuth } from './no-direct-auth.js';

export default {
  rules: {
    'file-header': fileHeader,
    'max-file-lines': maxFileLines,
    'no-silent-catch': noSilentCatch,
    'no-direct-auth': noDirectAuth,
  },
};
