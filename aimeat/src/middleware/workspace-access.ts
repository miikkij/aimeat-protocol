/**
 * @file workspace-access.ts
 * @description Express middleware that gates memory operations on `organism.{id}.*` keys by
 *   organism membership, namespace role (meta = admin/creator write, shared = member, member.{owner}
 *   = self), and the consent layer. Memberships are keyed by the BARE owner name (matching
 *   organisms.ts and consent.ts). Mounted by the memory routes for every organism-namespace key.
 * @structure
 *   - workspaceAccessMiddleware(config, storage) — RequestHandler that allows or 401/403/404s
 * @usage const ws = workspaceAccessMiddleware(config, storage); router.get('/v1/memory/:key', ws, ...);
 * @version-history
 *   v1.0.0 -- 2026-02 -- Phase 2.3 organism workspace access control.
 *   v1.1.0 -- 2026-06-07 -- Key the membership lookup by bare owner name (was full GHII → 403'd members).
 */
import type { RequestHandler } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { error } from './envelope.js';

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
    // Extract memory key from request
    // Memory routes use :key param in URLs like /v1/memory/:key
    const key = (req.params as Record<string, string>).key;
    if (!key) return next();

    // Only intercept organism.* namespace keys
    const match = key.match(/^organism\.([^.]+)\./);
    if (!match) return next();

    const organismId = match[1];
    const ownerName = req.auth?.owner;

    // Require authentication for all workspace operations
    if (!ownerName) {
      res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Authentication required for workspace access'));
      return;
    }

    // Look up the organism
    const organism = await storage.getOrganism(organismId);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Organism not found: ${organismId}`));
      return;
    }

    // Check if the request is from an organism agent
    if (req.auth?.sub && organism.agentGaiis.includes(req.auth.sub)) {
      // Agent access — allowed for shared namespace reads and writes
      if (key.startsWith(`organism.${organismId}.shared.`)) {
        return next();
      }
      // Agents can read meta namespace
      if (key.startsWith(`organism.${organismId}.meta.`) && ['GET', 'HEAD'].includes(req.method)) {
        return next();
      }
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Agent not authorized for this workspace namespace'));
      return;
    }

    // Confirm the user is a registered GHII on this node.
    const userGhii = await storage.getGHIIByOwner(ownerName);

    if (!userGhii) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not a member of this organism'));
      return;
    }

    // Memberships are keyed by the BARE owner name — organisms.ts (join/leave/admin) and
    // consent.ts (organism resolution) both look up membership with req.auth.owner, NOT the
    // full GHII. Looking it up by userGhii.ghii here silently 403'd every real member.
    const membership = await storage.getMembership(organismId, ownerName);
    if (!membership || membership.status !== 'active') {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism'));
      return;
    }

    // --- Consent check (Phase 2.3) ---
    // Determine if consent is required for this operation.
    // Consent is NOT required for:
    //   - Writes to the member's own namespace (organism.{id}.member.{owner}.*)
    // Consent IS required for:
    //   - All READ operations on shared/meta namespaces
    //   - Writes to shared namespace (not own member namespace)
    const ownMemberPrefix = `organism.${organismId}.member.${ownerName}.`;
    const isOwnMemberNamespace = key.startsWith(ownMemberPrefix);

    // A human owner-role session (not an agent) acting as an active member is the principal — it
    // does not consent to itself. The consent layer governs AGENT access (and cross-node sharing);
    // agent sessions below still require a matching grant. This is what lets a logged-in human use
    // their own project workspace from the UI without provisioning an agent-owned consent.
    const isHumanOwnerSession = (req.auth?.roles ?? []).includes('owner') && !(req.auth?.roles ?? []).includes('agent');

    // Consent needed unless writing your own member namespace, or you're the human owner-principal.
    const needsConsent = !isOwnMemberNamespace && !isHumanOwnerSession;

    if (needsConsent) {
      // Look up all agents for this owner
      const agents = await storage.getAgentsByOwner(ownerName);

      if (agents.length === 0) {
        res.status(403).json(error(config.nodeId, 'CONSENT_REQUIRED', 'No agent found — consent cannot be verified'));
        return;
      }

      // Check if ANY of the owner's agents have a matching active consent
      const accessorPattern = `organism.${organismId}`;
      let hasConsent = false;

      for (const agent of agents) {
        const matching = await storage.findMatchingConsents(agent.gaii, key, accessorPattern);
        if (matching.length > 0) {
          hasConsent = true;
          break;
        }
      }

      if (!hasConsent) {
        res.status(403).json(error(config.nodeId, 'CONSENT_REQUIRED',
          `Active consent required for organism workspace access (key: ${key})`));
        return;
      }
    }

    // Meta namespace: only admins/creators can write
    if (key.startsWith(`organism.${organismId}.meta.`) && !['GET', 'HEAD'].includes(req.method)) {
      if (membership.role !== 'admin' && membership.role !== 'creator') {
        res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Admin access required for meta namespace'));
        return;
      }
    }

    // Member namespace: only the specific member can write
    const memberMatch = key.match(/^organism\.[^.]+\.member\.([^.]+)\./);
    if (memberMatch && !['GET', 'HEAD'].includes(req.method)) {
      if (memberMatch[1] !== ownerName) {
        res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Cannot write to another member\'s workspace'));
        return;
      }
    }

    next();
  };
}
