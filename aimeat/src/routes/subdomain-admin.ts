/**
 * @file subdomain-admin.ts
 * @description Operator-only CRUD for subdomain mappings (`/v1/admin/subdomains`). Split from
 *   subdomains.ts, which serves them: managing which label points where and answering a request
 *   on that label are different jobs, and only the serving half is on the request hot path.
 * @structure subdomainAdminRouter(config, storage)
 * @usage app.use(subdomainAdminRouter(config, storage)) in routes-loader
 * @version-history
 *   v1.0.0 — 2026-08-07 — Extracted verbatim from subdomains.ts (max-file-lines) when the company
 *     origin landed there; behaviour unchanged.
 */
import { Router, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, SubdomainSiteRecord } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import {
  RESERVED_SUBDOMAINS, SUBDOMAIN_RE, resolveAppTarget, appIsRestricted,
} from './subdomains.js';

/** Operator-only management CRUD for subdomain mappings. */
export function subdomainAdminRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const operatorOnly = [requireAuth(), requireRole('operator')] as const;

  // Validates kind+target; sends the error response and returns false on failure.
  async function validateTarget(res: Response, kind: string, target: string): Promise<boolean> {
    if (kind === 'redirect') {
      if (!/^https?:\/\/\S+$/.test(target)) {
        res.status(400).json(error(config.nodeId, 'INVALID_TARGET', 'Redirect target must be an absolute http(s) URL'));
        return false;
      }
      return true;
    }
    // kind === 'app'
    const app = await resolveAppTarget(storage, target);
    if (!app) {
      res.status(404).json(error(config.nodeId, 'APP_NOT_FOUND', `No published app matches target "${target}" (expected "owner/filename")`));
      return false;
    }
    if (appIsRestricted(config, app)) {
      res.status(400).json(error(config.nodeId, 'APP_RESTRICTED', 'An app that needs a code or a payment cannot sit at its own web address. Serve it from the main site instead.'));
      return false;
    }
    return true;
  }

  // GET /v1/admin/subdomains — list all mappings
  router.get('/v1/admin/subdomains', ...operatorOnly, async (_req, res) => {
    const sites = await storage.listSubdomainSites();
    res.json(success(config.nodeId, { sites, total: sites.length }));
  });

  // POST /v1/admin/subdomains — create a mapping
  router.post('/v1/admin/subdomains', ...operatorOnly, async (req, res) => {
    const body = req.body ?? {};
    const subdomain = String(body.subdomain ?? '').trim().toLowerCase();
    const kind = String(body.kind ?? 'app');
    const target = String(body.target ?? '').trim();
    const enabled = body.enabled === undefined ? true : Boolean(body.enabled);

    if (!SUBDOMAIN_RE.test(subdomain)) {
      res.status(400).json(error(config.nodeId, 'INVALID_SUBDOMAIN',
        'Subdomain must be 2-63 chars of lowercase a-z, 0-9 and hyphens, not starting or ending with a hyphen'));
      return;
    }
    if (RESERVED_SUBDOMAINS.has(subdomain)) {
      res.status(400).json(error(config.nodeId, 'RESERVED_SUBDOMAIN', `The name "${subdomain}" is kept for the node itself. Choose a different one.`));
      return;
    }
    if (kind !== 'app' && kind !== 'redirect') {
      res.status(400).json(error(config.nodeId, 'INVALID_KIND', 'kind must be "app" or "redirect"'));
      return;
    }
    if (!target) {
      res.status(400).json(error(config.nodeId, 'INVALID_TARGET', 'target is required'));
      return;
    }
    if (!(await validateTarget(res, kind, target))) return;

    if (await storage.getSubdomainSite(subdomain)) {
      res.status(409).json(error(config.nodeId, 'ALREADY_EXISTS', `Subdomain "${subdomain}" is already mapped`));
      return;
    }

    const now = new Date().toISOString();
    const site: SubdomainSiteRecord = {
      subdomain, kind, target, enabled,
      createdBy: resolveIdentity(req.auth!, config.nodeId),
      createdAt: now, updatedAt: now,
    };
    await storage.createSubdomainSite(site);
    res.status(201).json(success(config.nodeId, { site }));
  });

  // PATCH /v1/admin/subdomains/:subdomain — update kind/target/enabled
  router.patch('/v1/admin/subdomains/:subdomain', ...operatorOnly, async (req, res) => {
    const subdomain = (req.params.subdomain as string).trim().toLowerCase();
    const existing = await storage.getSubdomainSite(subdomain);
    if (!existing) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Subdomain "${subdomain}" is not mapped`));
      return;
    }

    const body = req.body ?? {};
    const updates: Partial<Pick<SubdomainSiteRecord, 'kind' | 'target' | 'enabled'>> = {};
    if (body.kind !== undefined) {
      if (body.kind !== 'app' && body.kind !== 'redirect') {
        res.status(400).json(error(config.nodeId, 'INVALID_KIND', 'kind must be "app" or "redirect"'));
        return;
      }
      updates.kind = body.kind;
    }
    if (body.target !== undefined) updates.target = String(body.target).trim();
    if (body.enabled !== undefined) updates.enabled = Boolean(body.enabled);

    // Cross-validate the effective kind/target pair when either changes
    if (updates.kind !== undefined || updates.target !== undefined) {
      const kind = updates.kind ?? existing.kind;
      const target = updates.target ?? existing.target;
      if (!target) {
        res.status(400).json(error(config.nodeId, 'INVALID_TARGET', 'target is required'));
        return;
      }
      if (!(await validateTarget(res, kind, target))) return;
    }

    const site = await storage.updateSubdomainSite(subdomain, updates);
    res.json(success(config.nodeId, { site }));
  });

  // DELETE /v1/admin/subdomains/:subdomain — remove a mapping
  router.delete('/v1/admin/subdomains/:subdomain', ...operatorOnly, async (req, res) => {
    const subdomain = (req.params.subdomain as string).trim().toLowerCase();
    const deleted = await storage.deleteSubdomainSite(subdomain);
    if (!deleted) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Subdomain "${subdomain}" is not mapped`));
      return;
    }
    res.json(success(config.nodeId, { deleted: true, subdomain }));
  });

  return router;
}
