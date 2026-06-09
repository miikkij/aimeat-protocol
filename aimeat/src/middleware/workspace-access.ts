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
 *   v1.2.0 -- 2026-06-09 -- A same-owner agent (the workspace creator's own agent) bypasses the consent
 *     check, like the human owner session — so a CrewAI sub-agent can write to its owner's workspace.
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

    // An AGENT of the workspace's OWN creator (same owner) is the creator's tool — like the human owner
    // session, it does not consent to itself. Without this, a same-owner sub-agent (e.g. a CrewAI crew)
    // could not write to its owner's organism workspace at all. Cross-owner member agents still need a
    // granted 'workspace-contribution' consent. Scoped to workspace keys (organism.{id}.w.{ws}.*).
    let isOwnWorkspaceAgent = false;
    const wsMatch = key.match(/^organism\.[^.]+\.w\.([^.]+)\./);
    if (wsMatch && !isHumanOwnerSession) {
      const ws = wsMatch[1];
      const regKey = `organism.${organismId}.meta.workspaces`;
      const { items } = await storage.listAllMemory({ prefix: regKey, limit: 1000 });
      for (const rec of items) {
        if (rec.key !== regKey) continue;
        const list = (rec.value as { workspaces?: Array<{ id: string; createdBy?: string }> } | null)?.workspaces ?? [];
        const entry = list.find(w => w.id === ws);
        if (entry) {
          const createdBy = entry.createdBy ?? (rec.ownerGaii.includes('#') ? rec.ownerGaii.split('#')[1] : rec.ownerGaii).split('@')[0];
          if (createdBy === ownerName) isOwnWorkspaceAgent = true;
          break;
        }
      }
    }

    // Consent needed unless writing your own member namespace, you're the human owner-principal, or
    // you're an agent of the workspace's own creator.
    const needsConsent = !isOwnMemberNamespace && !isHumanOwnerSession && !isOwnWorkspaceAgent;

    if (needsConsent) {
      // The workspace-contribution consent (created when the member requested access) is owned by the
      // identity that made the request: the member's OWNER GHII (owner/MCP-serve session) OR one of
      // their agents (agent/connector path). Check BOTH, so an approved member writes through any path —
      // otherwise an approved member could read but not write via their agent (the consent was under the
      // owner GHII). Membership is by bare owner name, so this stays per-owner.
      const ownerGhii = `${ownerName}@${config.nodeId}`;
      const agents = await storage.getAgentsByOwner(ownerName);
      const accessors = [ownerGhii, ...agents.map(a => a.gaii)];

      // Check if the owner (or ANY of their agents) holds a matching active consent.
      const accessorPattern = `organism.${organismId}`;
      let hasConsent = false;

      for (const accessor of accessors) {
        const matching = await storage.findMatchingConsents(accessor, key, accessorPattern);
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
