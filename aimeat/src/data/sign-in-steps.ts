/**
 * @file sign-in-steps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The SPA addresses that are steps of signing in: an app's consent window, an
 *   invitation, an allow page. The browser side has the same list as SIGN_IN_STEPS in
 *   public/js/site.js, which a page cannot import from src/; test/unit/sign-in-steps.test.ts holds
 *   the two lists equal.
 *
 *   One reader on the server: routes/portal-spa.ts serves these addresses with the static
 *   agent-facing footer hidden. The store's sign-in window showed the glossary, site map, llms.txt,
 *   AGENTS.md and API contract to a buyer in the middle of signing in (Jouni, 2026-10-31, v27
 *   follow-up B).
 * @structure SIGN_IN_STEP_PATHS
 * @usage import { SIGN_IN_STEP_PATHS } from '../data/sign-in-steps.js';
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial.
 */

export const SIGN_IN_STEP_PATHS: ReadonlySet<string> = new Set([
  '/v1/app-grant', '/v1/app-open', '/v1/invite', '/v1/oauth-round', '/v1/allow', '/v1/secret-allow', '/v1/eco-capability-allow',
]);
