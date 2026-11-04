/**
 * @file src/data/openapi-body-modes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The routes whose request body middleware/openapi-body-guard.ts ENFORCES against
 *   openapi.yaml: a body that does not match the contract is answered 400 VALIDATION_ERROR with the
 *   field named, before the route runs. Every other route with a JSON body in the contract is
 *   OBSERVED: a mismatch is logged and counted, and the request is answered as before.
 *
 *   THE LIST IS EMPTY ON PURPOSE. A route moves here only when its observe log has shown no mismatch
 *   from a real client for a week (codebase analysis 2026-11-03, security-architecture finding 6):
 *   enforcing a contract that disagrees with a working client would refuse a designed use. An entry
 *   is the method and the contract's own path template, as openapi.yaml writes it
 *   (`PATCH /v1/agents/{name}/scopes`). `pnpm check:write-validation` counts an enforced route as
 *   validated, so its entry in security/write-validation-baseline.json must then be deleted, and it
 *   refuses an entry the contract has no JSON body schema for.
 * @structure ENFORCED_BODY_ROUTES
 * @usage import { ENFORCED_BODY_ROUTES } from '../data/openapi-body-modes.js';
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial, empty (codebase analysis 2026-11-03, item B5).
 */

/** Routes answered 400 when their body does not match openapi.yaml. Empty: every route observes. */
export const ENFORCED_BODY_ROUTES: readonly string[] = [];
