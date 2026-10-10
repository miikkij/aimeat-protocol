/**
 * @file src/auth/self-or-scope.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A scope that guards another agent's record and not the caller's own.
 *
 *   `agent:write` is the word for acting on the owner's agents: it lets an agent approve a new agent
 *   by itself (routes/agents/device-auth.ts) and change a sibling's mode, run mode or tags. An
 *   agent DESCRIBING ITSELF is a different act. A crew runtime sets the agent's tags on every start,
 *   so with the scope required for its own record too, an agent without agent:write could finish no
 *   task (measured 2026-10-02 on a hosted place: the basic agents hold no agent:write on purpose, and
 *   since aimeat-crewai 0.31.0 a run with a refused call ends as refused). Jouni ruled the same day:
 *   an agent sets its own tags without agent:write, and another agent's still need it.
 *
 *   The same shape the node already uses for an agent's own capabilities and onboarding steps, which
 *   need no scope because the identity comes from the session.
 *
 *   WHAT COUNTS AS SELF. An agent principal of this node whose own GAII is the target that `:name`
 *   resolves to under its owner. An app grant, an ecosystem app and a visitor from another node are
 *   never self, so they take the scope check unchanged. The owner in person passes the scope check
 *   as before.
 * @structure isSelfAgentTarget(auth, identifier, nodeId) · requireScopeUnlessSelf(scope, nodeId)
 * @usage router.patch('/v1/agents/:name/tags', requireAuth(), requireScopeUnlessSelf('agent:write', config.nodeId), handler)
 * @version-history
 *   v1.0.1 — 2026-10-10 — `:name` is read as Express 5 decoded it; the second decode threw a URIError
 *     (500) on `%25zz` (secaudit 2026-10-10 I0).
 *   v1.0.0 — 2026-10-02 — Initial, for PATCH /v1/agents/:name/tags and aimeat_agent_tags_set.
 */
import type { Request, Response, NextFunction } from 'express';
import { requireScope } from './middleware.js';
import { agentGaiiFromIdentifier, isForeignPrincipal } from '../utils/gaii.js';

interface SelfAuth { sub: string; owner: string; roles: readonly string[]; federated?: boolean }

/** Is `identifier` (a bare name or a GAII) the calling agent's own record? */
export function isSelfAgentTarget(auth: SelfAuth | undefined, identifier: string, nodeId: string): boolean {
  if (!auth || !identifier) return false;
  const roles = auth.roles ?? [];
  if (!roles.includes('agent') || roles.includes('app') || roles.includes('ecosystem')) return false;
  if (isForeignPrincipal(auth)) return false;
  return agentGaiiFromIdentifier(identifier, auth.owner, nodeId) === auth.sub;
}

/** `requireScope(scope)`, except for an agent writing its own record named by `:name`. */
export function requireScopeUnlessSelf(scope: string, nodeId: string) {
  const gate = requireScope(scope);
  return (req: Request, res: Response, next: NextFunction) => {
    // Express 5 has already decoded `:name`. A second decode threw a URIError (500) on `%25zz`, and
    // the handlers behind this gate read the parameter the same way, so both resolve one target
    // (secaudit 2026-10-10 I0).
    const name = typeof req.params.name === 'string' ? req.params.name : '';
    if (isSelfAgentTarget(req.auth, name, nodeId)) { next(); return; }
    gate(req, res, next);
  };
}
