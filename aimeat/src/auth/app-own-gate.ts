/**
 * @file app-own-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description requireScopeOrOwnApp: requireScope, except for the token of the app the route
 *   addresses. An app on the app origin signs its user in with a grant token (role 'app') that names
 *   the app it was minted for (the `app` claim, "owner/filename"). On a route under
 *   /v1/apps/:owner/:filename/..., that token running the app's own code is the app acting on
 *   itself, for example its member panel managing its own roster, so it passes without the scope
 *   word a separate agent or another app needs. Every other principal goes through requireScope
 *   unchanged, owner-session bypass included.
 *
 *   It decides only whether the caller may reach the route. Whether the caller may manage what the
 *   route manages (is it the app's owner, a member, a stranger) stays the handler's decision: a
 *   member signed in to the same app holds a token of that app too.
 * @structure tokenOfThisApp(auth, appId) · requireScopeOrOwnApp(scope)
 * @usage router.post('/v1/apps/:owner/:filename/members', requireAuth(), requireScopeOrOwnApp('exchange:grant'), handler)
 * @version-history
 *   2026-10-05 — tokenOfThisApp moved to services/app-record-keys.ts and is re-exported here, so the
 *     roster services ask the same test; aimeat_app_manage calls the service in place of the route
 *     over loopback HTTP (secaudit 2026-10, M6).
 *   v1.0.0 — 2026-10-01 — Initial: the IAM defect round. The app's own member panel could not approve,
 *     remove or ask on production, because its token held only the words the app declared.
 */
import type { Request, Response, NextFunction } from 'express';
import { requireScope } from './middleware.js';
import { tokenOfThisApp } from '../services/app-record-keys.js';

export { tokenOfThisApp };

/**
 * requireScope(scope), passed without the scope by the token of the app named in the route's
 * `:owner` and `:filename` parameters.
 * @param scope The scope every other principal needs.
 */
export function requireScopeOrOwnApp(scope: string) {
  const gate = requireScope(scope);
  return (req: Request, res: Response, next: NextFunction) => {
    const appId = `${String(req.params.owner ?? '')}/${String(req.params.filename ?? '')}`;
    if (tokenOfThisApp(req.auth, appId)) return next();
    return gate(req, res, next);
  };
}
