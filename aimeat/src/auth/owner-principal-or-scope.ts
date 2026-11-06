/**
 * @file src/auth/owner-principal-or-scope.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The account holder, or a principal holding one scope word: the union of
 *   requireOwnerPrincipal() and requireScope(word), for a resource whose writing verbs had one each.
 *
 *   WHY A UNION. Jouni ruled on 2026-11-05 (codebase analysis 2026-11-03, decision 13a) that where
 *   the verbs of one path check permissions differently, the looser side decides, so that the owner's
 *   agent keeps every right it had on either verb. Renaming a connector asked `agent:write` and
 *   forgetting it asked the account holder in person (requireOwnerPrincipal, which also admits an
 *   agent the owner gave `account:security`). Neither side admitted everything the other did, so
 *   the looser side is both together: the account holder passes as before, and anyone else takes
 *   requireScope(word) unchanged, with its refusal.
 *
 *   NOT A KIND CHECK. requireScope admits any principal holding the word, an app grant or an
 *   ecosystem app included, so a route that is for the account holder and their own agents asks the
 *   caller's kind itself after this gate (routes/agents-v2/connectors.ts does).
 * @structure requireOwnerPrincipalOrScope(word)
 * @usage router.delete('/v1/agents/v2/connectors/:id', requireAuth(), requireOwnerPrincipalOrScope('agent:write'), handler)
 * @version-history
 *   v1.0.0 — 2026-11-05 — Initial (codebase analysis 2026-11-03, decision 13a of 2026-11-05).
 */
import type { Request, Response, NextFunction } from 'express';
import { requireScope } from './middleware.js';
import { isOwnerPrincipal } from './account-security.js';
import { isAnonymousPrincipal } from './anonymous-principal.js';

export function requireOwnerPrincipalOrScope(word: string) {
  const byScope = requireScope(word);
  return (req: Request, res: Response, next: NextFunction) => {
    // requireOwnerPrincipal's own test, with its refusal of a shared anonymous identity.
    if (req.auth && !isAnonymousPrincipal(req.auth) && isOwnerPrincipal(req.auth)) {
      next();
      return;
    }
    byScope(req, res, next);
  };
}
