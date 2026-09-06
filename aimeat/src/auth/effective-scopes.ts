/**
 * @file src/auth/effective-scopes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An agent's EFFECTIVE scopes: what its token carries AND what its record allows right
 *   now. Pure extraction from auth/middleware.ts when that file passed the 800-line ceiling; the body
 *   is verbatim and both gates there call it.
 * @structure withCurrentScopes(storage, verified) → VerifiedToken
 * @usage req.auth = await withCurrentScopes(storage, verified);
 * @version-history
 *   v1.0.0 — 2026-09-06 — Extracted from auth/middleware.ts (max-file-lines).
 */
import type { Storage } from '../storage/interface.js';
import type { VerifiedToken } from './jwt.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { logger } from '../utils/logger.js';

/**
 * A JWT's scope list is a snapshot of the moment it was minted. Agent tokens here run long, and a
 * connector holds one for the life of its socket — the node pins it at attach and forwards every
 * tunnelled call with it. So an owner who removed a permission watched it go on being honoured for
 * the rest of that token's life, on every door, with nothing anywhere saying so. Reported from the
 * other direction (a GRANT not arriving) on 2026-09-06; the removal direction is the serious one and
 * nobody had noticed it.
 *
 * INTERSECTION, NEVER UNION, and that is the whole safety of it. A token may be deliberately
 * NARROWER than the record — a scoped PAT, an H-2 app grant, a mint issued for one job — and reading
 * the record as the answer would WIDEN those. Taking the token as the ceiling and the record as the
 * current permission means a word can only ever be taken away here, never added. Adding one still
 * requires a fresh credential, which is what the `scopes_changed` push asks a connector to get.
 *
 * UNCACHED, for the same reason the revocation check beside it is uncached and says so: an owner
 * pressing "remove" means now. It costs one keyed read on a request that already makes one.
 */
export async function withCurrentScopes(storage: Storage | null, v: VerifiedToken): Promise<VerifiedToken> {
  // Agents only. An owner session bypasses scopes entirely; a GEAI and an app grant have their
  // permission lists somewhere other than an agent record, so this must not touch them.
  if (!storage || v.anonymous || !v.roles.includes('agent')) return v;
  if (v.roles.includes('owner') || v.roles.includes('ecosystem')) return v;

  const agent = await storage.getAgent(v.sub).catch((err: unknown) => {
    // Never silently: if this read fails the request proceeds on the token's own scopes, which is
    // the pre-2026-09-06 behaviour, and an operator has to be able to see that it happened.
    logger.warn('effective-scopes: the agent record could not be read; proceeding on the token\'s own scopes', { sub: v.sub, error: String(err) });
    return null;
  });
  // A missing record is a real anomaly and it is NOT quietly turned into "no permissions": the route
  // layer answers it with agentNotFound(), which tells the operator what actually happened. Zeroing
  // the scopes here would replace that with a scope refusal naming the wrong cause.
  if (!agent) return v;

  const current = agent.defaultScopes ?? [];
  const effective = v.scopes.filter(s => scopeIsCovered(current, s));
  if (effective.length === v.scopes.length) return v;
  logger.info('effective-scopes: narrowed to the agent record', {
    sub: v.sub, token: v.scopes.join(','), record: current.join(','), effective: effective.join(','),
  });
  return { ...v, scopes: effective };
}
