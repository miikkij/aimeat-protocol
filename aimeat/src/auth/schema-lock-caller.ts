/**
 * @file src/auth/schema-lock-caller.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may set or remove a schema lock: one gate for PUT and DELETE /v1/memory/:key/schema
 *   (routes/schemas.ts; codebase analysis 2026-11-03 item B4, decision 13a of 2026-11-05).
 *
 *   WHY. PUT admitted the owner role and the operator, and DELETE any principal holding memory:write.
 *   The owner's agent could remove a lock it held and not change it, and the operator's agent holding
 *   operator:admin could change a lock and not remove it.
 *
 *   THE RULE, on both verbs. The operator passes (isOperatorCaller: the operator in person, or
 *   something acting for the operator account that holds operator:admin), and then requireScope
 *   ('memory:write') decides: the owner in person passes, and anything else must hold the word, with
 *   requireScope's own refusal (the agent's card and its one-press allow address). A visitor from
 *   another node and the anonymous identity are refused first: a lock governs every account's writes
 *   to a matching key. The handler then limits an app grant and an ecosystem app to a lock they
 *   already hold (lockKindRefusal), so neither sets a new one.
 * @structure requireSchemaLockCaller(storage) · lockKindRefusal(auth, holdsIt)
 * @usage router.put('/v1/memory/:key/schema', requireAuth(), requireSchemaLockCaller(storage), handler)
 * @version-history
 *   v1.0.0 — 2026-11-06 — Initial (decision 13a of 2026-11-05).
 */
import type { Request, Response, NextFunction } from 'express';
import type { Storage } from '../storage/interface.js';
import { requireScope } from './middleware.js';
import { deny401, deny403 } from './deny.js';
import { isAnonymousPrincipal } from './anonymous-principal.js';
import { isForeignPrincipal } from '../utils/gaii.js';
import { credentialKind } from '../services/caller-facts.js';
import { isOperatorCaller } from '../services/operator-override.js';

const REFUSAL = 'Setting or removing a structure lock needs the account holder, an agent of theirs holding memory:write, or the operator.';

export function requireSchemaLockCaller(storage: Storage) {
  const byScope = requireScope('memory:write');
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      deny401(req, res, 'Authentication required');
      return;
    }
    if (isAnonymousPrincipal(req.auth) || isForeignPrincipal(req.auth)) {
      deny403(req, res, 'ACCESS_DENIED', REFUSAL);
      return;
    }
    if (await isOperatorCaller(storage, req.auth)) {
      next();
      return;
    }
    byScope(req, res, next);
  };
}

/**
 * The handler's half of the rule: an app grant or an ecosystem app acts only on a lock it already
 * holds (`holdsIt`). Null when the caller may go on, else the refusal's code and message.
 */
export function lockKindRefusal(auth: NonNullable<Request['auth']>, holdsIt: boolean): { code: string; message: string } | null {
  const kind = credentialKind(auth);
  if ((kind === 'app' || kind === 'ecosystem') && !holdsIt) {
    return { code: 'ACCESS_DENIED', message: `${REFUSAL} An app changes or removes only a lock it set itself.` };
  }
  return null;
}
