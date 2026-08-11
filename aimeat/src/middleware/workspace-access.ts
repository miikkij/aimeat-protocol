/**
 * @file workspace-access.ts
 * @description Express wrapper over the organism-namespace access rule. The rule itself lives in
 *   services/organism-namespace-access.ts, because it is not about HTTP: the MCP write path needs
 *   the same answer and could not call a RequestHandler. This file turns a request into a caller and
 *   a refusal into a response, and decides nothing on its own.
 * @structure
 *   - workspaceAccessMiddleware(config, storage) — RequestHandler that allows or 401/403/404s
 * @usage const ws = workspaceAccessMiddleware(config, storage); router.get('/v1/memory/:key', ws, ...);
 * @version-history
 *   v1.0.0 -- 2026-02 -- Phase 2.3 organism workspace access control.
 *   v1.1.0 -- 2026-06-07 -- Key the membership lookup by bare owner name (was full GHII → 403'd members).
 *   v1.2.0 -- 2026-06-09 -- A same-owner agent (the workspace creator's own agent) bypasses the consent
 *     check, like the human owner session — so a CrewAI sub-agent can write to its owner's workspace.
 *   v1.3.0 -- 2026-06-09 -- Workspace CONTENT writes require the creator's 'contributor' role grant only
 *     (revocable); 'viewer' is read-only. Flat organism namespaces still use the writer's own contribution
 *     consent. Splits the consent check by workspace key vs flat key.
 *   v1.4.0 -- 2026-07-15 -- An org manager (creator/admin) bypasses the consent check for organism keys —
 *     full read+write access to every workspace under the organism (the member.{owner}.* self-write and
 *     meta.* admin-role gates still apply).
 *   v2.0.0 -- 2026-08-11 -- The rule moves to services/organism-namespace-access.ts so every door gets
 *     it. This file keeps its behaviour and becomes the Express half of it.
 */
import type { RequestHandler } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { error } from './envelope.js';
import { checkOrganismNamespaceAccess } from '../services/organism-namespace-access.js';

/**
 * Workspace access middleware — Phase 2.3
 *
 * Intercepts memory operations on organism.* namespace keys
 * and enforces membership + role-based access control.
 *
 * Namespace conventions:
 *   organism.{id}.shared.*  — All members + organism agents can read/write
 *   organism.{id}.meta.*    — All members can read, only admins/creators can write
 *   organism.{id}.member.{owner}.* — All members can read, only the specific member can write
 */
export function workspaceAccessMiddleware(
  config: AimeatConfig,
  storage: Storage,
): RequestHandler {
  return async (req, res, next) => {
    // Memory routes use :key param in URLs like /v1/memory/:key
    const key = (req.params as Record<string, string>).key;
    if (!key || !key.startsWith('organism.')) return next();

    const refusal = await checkOrganismNamespaceAccess({ storage, config }, {
      principal: req.auth?.sub ?? '',
      owner: (req.auth?.owner as string) ?? '',
      roles: req.auth?.roles ?? [],
    }, key, ['GET', 'HEAD'].includes(req.method) ? 'read' : 'write');

    if (refusal) {
      res.status(refusal.status).json(error(config.nodeId, refusal.code, refusal.message));
      return;
    }
    next();
  };
}
