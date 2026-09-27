/**
 * @file subdomain-admin.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Operator CRUD for subdomain mappings (`/v1/admin/subdomains`). Split from
 *   subdomains.ts, which serves them: managing which label points where and answering a request
 *   on that label are different jobs, and only the serving half is on the request hot path.
 *   Who may call: the operator in person, or an agent the operator gave operator:admin
 *   (requireOperatorPrincipal, the same door as the node's MCP server registry). No wildcard
 *   carries that word, an app grant never passes, and a federated session never passes.
 *   The work itself is services/subdomain-sites.ts; these handlers parse and render.
 * @structure subdomainAdminRouter(config, storage)
 * @usage app.use(subdomainAdminRouter(config, storage)) in routes-loader
 * @version-history
 *   v1.1.0 — 2026-09-27 — requireRole('operator') became requireOperatorPrincipal(storage,
 *     OPERATOR_ADMIN_SCOPE) on all four doors, so an agent holding operator:admin may manage the list
 *     (developer decision 2026-09-27). List, validation, create, update and delete moved to
 *     services/subdomain-sites.ts with the same codes and messages.
 *   v1.0.0 — 2026-08-07 — Extracted verbatim from subdomains.ts (max-file-lines) when the company
 *     origin landed there; behaviour unchanged.
 */
import { Router, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireOperatorPrincipal } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { OPERATOR_ADMIN_SCOPE } from '../utils/scope-coverage.js';
import {
  listSubdomainSites, createSubdomainSite, updateSubdomainSite, deleteSubdomainSite,
  type SubdomainRefusal,
} from '../services/subdomain-sites.js';

/** Operator management CRUD for subdomain mappings. */
export function subdomainAdminRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const operatorOnly = [requireAuth(), requireOperatorPrincipal(storage, OPERATOR_ADMIN_SCOPE)] as const;

  const refuse = (res: Response, r: SubdomainRefusal): void => {
    res.status(r.status).json(error(config.nodeId, r.code, r.message));
  };

  // GET /v1/admin/subdomains — list all mappings
  router.get('/v1/admin/subdomains', ...operatorOnly, async (_req, res) => {
    res.json(success(config.nodeId, await listSubdomainSites(storage)));
  });

  // POST /v1/admin/subdomains — create a mapping
  router.post('/v1/admin/subdomains', ...operatorOnly, async (req, res) => {
    const out = await createSubdomainSite(storage, config, req.body ?? {}, resolveIdentity(req.auth!, config.nodeId));
    if (!out.ok) { refuse(res, out); return; }
    res.status(201).json(success(config.nodeId, { site: out.site }));
  });

  // PATCH /v1/admin/subdomains/:subdomain — update kind/target/enabled
  router.patch('/v1/admin/subdomains/:subdomain', ...operatorOnly, async (req, res) => {
    const out = await updateSubdomainSite(storage, config, req.params.subdomain as string, req.body ?? {});
    if (!out.ok) { refuse(res, out); return; }
    res.json(success(config.nodeId, { site: out.site }));
  });

  // DELETE /v1/admin/subdomains/:subdomain — remove a mapping
  router.delete('/v1/admin/subdomains/:subdomain', ...operatorOnly, async (req, res) => {
    const out = await deleteSubdomainSite(storage, req.params.subdomain as string);
    if (!out.ok) { refuse(res, out); return; }
    res.json(success(config.nodeId, { deleted: true, subdomain: out.subdomain }));
  });

  return router;
}
