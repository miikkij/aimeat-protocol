/**
 * @file src/auth/rest-scope-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The scope gate for the REST routes that asked no scope until node 4.0.0 (Core 2026-11
 *   AUTHZ-01 and SEC-03; ruling decision-core-2026-11-avoimet-kysymykset-ja-agenttien-automaattinen-l,
 *   open question 21).
 *
 *   WHY A GATE OF ITS OWN AND NOT requireScope. These routes let an agent, an app grant or an
 *   ecosystem app in with any scope at all, and live integrations depend on that. requireScope would
 *   refuse them on the deploy. This gate makes the same decision requireScope makes and differs in one
 *   place only: before REST_SCOPE_GATES_ENFORCED_IN, a caller without the word is still let through,
 *   the response carries the Deprecation headers (services/deprecation.ts), and the use is counted per
 *   word in GET /v1/stats (`deprecated_use_by_type`, kind `rest_scope_missing:<word>`). From that
 *   release the caller gets 403 SCOPE_DENIED, the same refusal requireScope sends.
 *
 *   The one-time grant that keeps the existing callers working is services/rest-scope-gates-migration.ts.
 *
 *   WHO PASSES WITHOUT THE WORD, as with requireScope: the owner in person (an owner session that is
 *   neither an agent, an ecosystem app nor a visitor from another node). With `unlessSelf`, also an
 *   agent acting on its own record named by `:name` (auth/self-or-scope.ts isSelfAgentTarget), the
 *   rule the node already uses for an agent's own tags and capabilities.
 * @structure REST_SCOPE_GATES_ENFORCED_IN and restScopeKind (re-exported from utils/rest-scope-release.ts) ·
 *   restScopeGatesEnforced() · requireRestScope(word, opts)
 * @usage
 *   router.post('/v1/agents/:name/tasks', requireAuth(), requireRestScope('task:write'), handler)
 *   router.put('/v1/agents/:name/offers', requireAuth(), requireRestScope('commerce:sell', { unlessSelf: config.nodeId }), handler)
 *   router.get('/v1/extensions/:name/instances', requireAuth(), requireRestScope('ext:invoke', { orScope: 'ext:write' }), handler)
 * @version-history
 *   v1.0.0 — 2026-10-12 — Initial (wish-rest-reitit-ilman-scope-tarkistusta-agentti-p-see-kaikkeen).
 */
import type { Request, Response, NextFunction } from 'express';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { isOwnerInPerson } from '../utils/gaii.js';
import { removedFrom, noteDeprecatedUse } from '../services/deprecation.js';
import { noteScopeUse } from '../services/scope-use.js';
import { logger } from '../utils/logger.js';
import { deny401, denyScope403 } from './deny.js';
import { isSelfAgentTarget } from './self-or-scope.js';
import { REST_SCOPE_GATES_ENFORCED_IN, restScopeKind } from '../utils/rest-scope-release.js';

// The release and the counter kind live in a leaf module the tool catalog can import too.
export { REST_SCOPE_GATES_ENFORCED_IN, restScopeKind };

/** True when the running version refuses (or `version`, for a test). */
export function restScopeGatesEnforced(version?: string): boolean {
  return version === undefined ? removedFrom(REST_SCOPE_GATES_ENFORCED_IN) : removedFrom(REST_SCOPE_GATES_ENFORCED_IN, version);
}

export interface RestScopeGateOptions {
  /** A second word that is also enough (requireAnyScope's rule): e.g. ext:invoke or ext:write. */
  orScope?: string;
  /** The node id. When set, an agent acting on its own record named by `:name` passes without the word. */
  unlessSelf?: string;
}

/**
 * requireScope(word) for a route that asked no scope before 4.0.0. Mounted after requireAuth(), or
 * after a router-level requireAuth.
 */
export function requireRestScope(word: string, opts: RestScopeGateOptions = {}) {
  const words = opts.orScope ? [word, opts.orScope] : [word];
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth || req.auth.anonymous) {
      deny401(req, res, 'Authentication required');
      return;
    }
    // The owner in person: the same bypass requireScope gives.
    if (isOwnerInPerson(req.auth)) {
      next();
      return;
    }
    if (opts.unlessSelf) {
      const name = typeof req.params.name === 'string' ? req.params.name : '';
      if (isSelfAgentTarget(req.auth, name, opts.unlessSelf)) { next(); return; }
    }
    const held = req.auth.scopes ?? [];
    const covered = words.find((w) => scopeIsCovered(held, w));
    if (covered) {
      // A `*` agent's admitted word feeds the narrowing its owner is offered, as in requireScope.
      // services/scope-use.ts decides at flush whether the principal is an agent holding `*`, and
      // ignores everything else, so the call needs no test of its own here.
      noteScopeUse(req.auth.sub, [covered]);
      next();
      return;
    }
    const route = `${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`;
    const wanted = words.length > 1 ? `one of "${words.join('", "')}"` : `"${word}"`;
    if (restScopeGatesEnforced()) {
      logger.warn(`[scope-denied] ${req.auth.sub} needs ${wanted}, has [${held.join(', ')}] on ${route}`);
      denyScope403(req, res, words, `Scope ${wanted} required. Agent scopes: [${held.join(', ')}]`, undefined, words.length > 1);
      return;
    }
    noteDeprecatedUse(
      {
        kind: restScopeKind(word),
        removedIn: REST_SCOPE_GATES_ENFORCED_IN,
        notice: `${route} was called without the scope ${wanted}. The call was allowed.`,
      },
      { principal: req.auth.sub, route },
    );
    next();
  };
}
