/**
 * @file index.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   - noRawLocaleFormat: Dates, times and numbers go through the shared formatter, which reads the
 *     reader's own region and clock rather than the page's language
 *
 * @usage
 *   import aimeatPlugin from './eslint-rules/index.js';
 *   // Then add to ESLint flat config plugins
 *
 * @version-history
 *   v1.0.0 — 2026-03-13 — Initial implementation
 *   v1.1.0 — 2026-08-07 — Added no-direct-auth (session single-source cleanup)
 *   v1.2.0 — 2026-08-10 — Added no-adhoc-extension-ctx (August 2026 audit: one sandbox context)
 *   v1.4.0 — 2026-09-12 — Added no-raw-locale-format. The formatter existed; nothing stopped the
 *     next call site from writing its own, and thirty of them had drifted apart from one another.
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
import { noRawLocaleFormat } from './no-raw-locale-format.js';

export default {
  rules: {
    'no-raw-locale-format': noRawLocaleFormat,
    'file-header': fileHeader,
    'max-file-lines': maxFileLines,
    'no-silent-catch': noSilentCatch,
    'no-direct-auth': noDirectAuth,
    'no-adhoc-extension-ctx': noAdhocExtensionCtx,
    'no-storage-in-mcp': noStorageInMcp,
    'no-express-in-service': noExpressInService,
  },
};
