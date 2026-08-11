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
 *   - noAdhocExtensionCtx: The sandbox context comes from buildExtensionCtx(), not a call-site literal
 *   - noStorageInMcp: An MCP tool calls the service REST calls, never storage directly
 *   - noExpressInService: A service takes the caller, not an Express request, so both doors reach it
 *
 * @usage
 *   import aimeatPlugin from './eslint-rules/index.js';
 *   // Then add to ESLint flat config plugins
 *
 * @version-history
 *   v1.0.0 — 2026-03-13 — Initial implementation
 *   v1.1.0 — 2026-08-07 — Added no-direct-auth (session single-source cleanup)
 *   v1.2.0 — 2026-08-10 — Added no-adhoc-extension-ctx (August 2026 audit: one sandbox context)
 *   v1.3.0 — 2026-08-11 — Added no-storage-in-mcp + no-express-in-service: the two rules that make
 *     "one capability, one implementation" enforceable rather than remembered.
 */

import { fileHeader } from './file-header.js';
import { maxFileLines } from './max-file-lines.js';
import { noSilentCatch } from './no-silent-catch.js';
import { noDirectAuth } from './no-direct-auth.js';
import { noAdhocExtensionCtx } from './no-adhoc-extension-ctx.js';
import { noStorageInMcp } from './no-storage-in-mcp.js';
import { noExpressInService } from './no-express-in-service.js';

export default {
  rules: {
    'file-header': fileHeader,
    'max-file-lines': maxFileLines,
    'no-silent-catch': noSilentCatch,
    'no-direct-auth': noDirectAuth,
    'no-adhoc-extension-ctx': noAdhocExtensionCtx,
    'no-storage-in-mcp': noStorageInMcp,
    'no-express-in-service': noExpressInService,
  },
};
