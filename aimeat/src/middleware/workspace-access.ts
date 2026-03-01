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

    // Resolve the user's GHII via their ownerName
    const userGhii = await storage.getGHIIByOwner(ownerName);

    if (!userGhii) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not a member of this organism'));
      return;
    }

    const membership = await storage.getMembership(organismId, userGhii.ghii);
    if (!membership || membership.status !== 'active') {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism'));
      return;
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
