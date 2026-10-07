/**
 * @file src/auth/operator-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The HTTP gates for the node operator's routes: requireOperatorPrincipal (a door that
 *   names its own operator word) and requireOperator (operator:admin, every operator route). Moved
 *   unchanged out of auth/middleware.ts when that file passed 800 lines; middleware.ts re-exports both.
 * @structure requireOperatorPrincipal(storage, scope) · requireOperator(storage)
 * @usage const operator = [requireAuth(), requireOperator(storage)]; then spread `...operator` into a route.
 * @version-history
 *   v1.0.1 — 2026-10-07 — requireOperatorPrincipal refuses the anonymous identity with 401 (code scanning alert 1702).
 *   v1.0.0 — 2026-10-05 — Moved from auth/middleware.ts (max-file-lines), with requireOperator added
 *     the same day (secaudit 2026-10, C2).
 */
import type { Request, Response, NextFunction } from 'express';
import type { Storage } from '../storage/interface.js';
import { isForeignPrincipal } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';
import { OPERATOR_ORGANISM_REPAIR_SCOPE, OPERATOR_ADMIN_SCOPE } from '../utils/scope-coverage.js';
import { deny401, deny403, denyScope403 } from './deny.js';
import { askOperator } from '../services/operator-principal.js';

/**
 * Require the NODE OPERATOR, or something the operator explicitly sent. For the break-glass doors
 * that reach across accounts: repairing an organism whose owner is unreachable is the first of them.
 *
 * WHY NOT requireRole('operator'). That tests the token's own role list, so it admits the operator's
 * browser session and refuses the operator's AGENTS — and an agent should be able to do what a
 * person can. This gate asks the question one level up: is the ACCOUNT behind this principal an
 * operator account? The four `aimeat_admin_*` MCP tools already resolve the operator that way
 * (mcp/core-admin.ts), so the two surfaces now agree instead of disagreeing by accident.
 *
 * WHY A SCOPE ON TOP. The role alone would hand every one of the operator's agents a node-wide
 * capability the moment it exists, and that is the shape of the incident this door was built for: an
 * agent with no scope limit called the ownership transfer during a test run and gave away the node's
 * own development organism. The word is tested as the EXACT string — no wildcard carries it
 * (SCOPES_OUTSIDE_WILDCARD), nobody was grandfathered onto it, and `app` principals are refused
 * outright, because an app grant is consent to use the account and never consent to act as the node.
 *
 * WHY THE WORD IS A PARAMETER. Organism repair was the first door of this shape and is the default,
 * so its two call sites read exactly as before. The compliance report (BR-02) is the second, and it
 * needs two different words for reading and writing. A near-copy of this function per door is how
 * three copies of the scope test came to live in this file, none of them knowing about the exception
 * the vocabulary module was written to hold — so the door varies by its word, not by its code.
 *
 * Federated sessions are refused for the same reason requireRole('operator') refuses them: operator
 * power stops at this node's own front door.
 *
 * THE DECISION IS askOperator() (services/operator-principal.ts), the one operator question every door
 * asks, tool surface included; this gate keeps its own refusals and their codes.
 */
export function requireOperatorPrincipal(storage: Storage, scope: string = OPERATOR_ORGANISM_REPAIR_SCOPE) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth || req.auth.anonymous) {
      deny401(req, res, 'Authentication required');
      return;
    }
    if (isForeignPrincipal(req.auth)) {
      deny403(req, res, 'FORBIDDEN', 'Federated sessions cannot access operator functions');
      return;
    }
    if (req.auth.roles.includes('app')) {
      deny403(req, res, 'ACCESS_DENIED', 'An app grant cannot carry operator functions');
      return;
    }
    // The operator in person passes; anything acting for an operator account passes on the exact word.
    const answer = await askOperator(storage, {
      sub: req.auth.sub, owner: req.auth.owner, roles: req.auth.roles, scopes: req.auth.scopes,
    }, scope);
    if (!answer.ok && answer.why !== 'needs-word') {
      deny403(req, res, 'ACCESS_DENIED', 'Node operator required');
      return;
    }
    if (!answer.ok) {
      logger.warn(`[operator-scope-denied] ${req.auth.sub} on ${req.method} ${req.path}`);
      denyScope403(req, res, [scope], `Scope "${scope}" required. The node operator grants it per agent, `
        + 'and no wildcard carries it.');
      return;
    }
    next();
  };
}

/**
 * The node operator's routes: the operator in person, or the operator's agent holding operator:admin,
 * asked through askOperator() as the MCP admin tools ask it. requireRole('operator') read the role off
 * the token, which an agent token never carries, so the operator's agent was refused on REST what it
 * was given on MCP (secaudit 2026-10, C2; Jouni 2026-10-05: "Agent must be capable of maintaining the
 * system fully when using operator:admin rights").
 */
export function requireOperator(storage: Storage) {
  return requireOperatorPrincipal(storage, OPERATOR_ADMIN_SCOPE);
}
