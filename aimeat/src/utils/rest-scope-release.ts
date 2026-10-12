/**
 * @file src/utils/rest-scope-release.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The release from which the scope words added to the REST routes and their MCP twins on
 *   2026-10-12 are enforced (Core 2026-11 AUTHZ-01, ruling decision-core-2026-11-avoimet-kysymykset-ja-
 *   agenttien-automaattinen-l Q21), and the counter kind both surfaces count a missing word under.
 *   A leaf module, so the tool catalog (a bottom layer that imports nothing above utils/) can name the
 *   same release as the REST gate (auth/rest-scope-gate.ts).
 * @structure REST_SCOPE_GATES_ENFORCED_IN · restScopeKind(word)
 * @usage import { REST_SCOPE_GATES_ENFORCED_IN } from '../utils/rest-scope-release.js';
 * @version-history
 *   v1.0.0 — 2026-10-12 — Initial (wish-rest-reitit-ilman-scope-tarkistusta-agentti-p-see-kaikkeen).
 */

/** From this release a caller without the word is refused; before it the call is allowed and counted. */
export const REST_SCOPE_GATES_ENFORCED_IN = '4.0.0';

/** The deprecation counter kind for one word (GET /v1/stats deprecated_use_by_type): `rest_scope_missing:task:write`. */
export function restScopeKind(word: string): string {
  return `rest_scope_missing:${word}`;
}
