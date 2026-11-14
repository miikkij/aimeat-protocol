/**
 * @file src/data/openapi-body-modes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two modes of middleware/openapi-body-guard.ts and the routes it leaves observed in
 *   enforce mode.
 *
 *   THE MODES. The node setting security.request_body_check (AIMEAT_REQUEST_BODY_CHECK, config/
 *   security.ts) picks one, and the guard reads it on every request, so an operator's change on the
 *   Config tab or through aimeat_admin_config_set applies at once, without a restart:
 *   - enforce (the default): every contract operation with an `application/json` body schema is
 *     enforced. A body that does not match is answered 400 VALIDATION_ERROR with the field named,
 *     before the route runs, for a caller with a session; a caller without one gets the route's own
 *     answer, as before. The routes in EXEMPT_BODY_ROUTES are observed instead.
 *   - observe: every route is observed: a mismatch is logged and counted, and the request is
 *     answered as before. It is the way back when a working client turns out to send a body the
 *     contract does not describe.
 *
 *   AN EXEMPT ENTRY is the method and the contract's own path template, as openapi.yaml writes it
 *   (`PATCH /v1/agents/{name}/scopes`), with the reason. `pnpm check:write-validation` refuses an entry
 *   the contract has no JSON body schema for, or that no route in src/routes/ declares, because it
 *   would exempt nothing.
 * @structure BODY_CHECK_MODES · BodyCheckMode · DEFAULT_BODY_CHECK_MODE · bodyCheckModeFrom(raw) ·
 *   ExemptBodyRoute · EXEMPT_BODY_ROUTES
 * @usage import { EXEMPT_BODY_ROUTES, bodyCheckModeFrom } from '../data/openapi-body-modes.js';
 * @version-history
 *   v2.0.0 — 2026-11-14 — The per-route list of enforced routes is replaced by the node setting
 *     security.request_body_check (enforce by default) and the list of exempt routes (structure
 *     programme 2026-11, unit 1).
 *   v1.0.0 — 2026-11-04 — Initial, empty (codebase analysis 2026-11-03, item B5).
 */

/** The values of security.request_body_check. */
export const BODY_CHECK_MODES = ['observe', 'enforce'] as const;
export type BodyCheckMode = typeof BODY_CHECK_MODES[number];
export const DEFAULT_BODY_CHECK_MODE: BodyCheckMode = 'enforce';

/** The mode a raw value names; anything else is the default. */
export function bodyCheckModeFrom(raw: string | undefined): BodyCheckMode {
    const v = (raw ?? '').trim().toLowerCase();
    return (BODY_CHECK_MODES as readonly string[]).includes(v) ? v as BodyCheckMode : DEFAULT_BODY_CHECK_MODE;
}

export interface ExemptBodyRoute {
    /** `METHOD /path/{template}`, as openapi.yaml writes it. */
    readonly route: string;
    /** Why the route is observed in enforce mode. */
    readonly reason: string;
}

/** Routes observed in enforce mode, each with its reason. */
export const EXEMPT_BODY_ROUTES: readonly ExemptBodyRoute[] = [];
