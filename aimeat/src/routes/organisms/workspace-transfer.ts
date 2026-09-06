/**
 * @file src/routes/organisms/workspace-transfer.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Backup and restore, for one workspace and for a whole organism: the two export doors
 *   that hand back a base64 ZIP, and the two import doors that build a NEW workspace or organism
 *   from one. Pure extraction from workspace-ops.ts, which crossed the 800-line ceiling; the
 *   handlers are unchanged from the day they moved.
 * @structure registerOrganismWorkspaceTransferRoutes(router, config, storage, H)
 * @usage
 *   import { registerOrganismWorkspaceTransferRoutes } from './organisms/workspace-transfer.js';
 *   registerOrganismWorkspaceTransferRoutes(router, config, storage, H);
 * @version-history
 *   v1.0.0 -- 2026-09-06 -- Extracted from workspace-ops.ts (max-file-lines).
 */
import { raw, type Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { requireAuth, requireRole, requireScope } from '../../auth/middleware.js';
import { resolveIdentity } from '../../utils/gaii.js';
import { emitChange } from '../../services/event-bus.js';
import { exportWorkspace } from '../../services/workspace-export.js';
import { importWorkspace } from '../../services/workspace-import.js';
import { exportOrganism } from '../../services/organism-export.js';
import { importOrganism } from '../../services/organism-import.js';
import { ZipSecurityError } from '../../services/safe-zip.js';
import { recordSecurityIncident } from '../../services/security-incident.js';
import type { OrganismHelpers } from './shared.js';

export function registerOrganismWorkspaceTransferRoutes(router: Router, config: AimeatConfig, storage: Storage, H: OrganismHelpers): void {
  const { memberRole, findWsEntry, bareOwner } = H;

  /* ── GET /v1/organisms/:id/workspace/export?ws= — download a full-fidelity ZIP backup of a
   * workspace (workspace.json + images/). The workspace creator (or an org admin) only. ── */
  router.get('/v1/organisms/:id/workspace/export', requireAuth(), requireScope('organism:read'), async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : undefined;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!ws) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws is required')); return; }
    const role = await memberRole(req, organism, id);
    if (!role) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    const entry = await findWsEntry(id, ws);
    if (!entry) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Workspace not found')); return; }
    const createdBy = entry.createdBy ?? bareOwner(entry.ownerGaii);
    if (createdBy !== (req.auth!.owner as string) && role !== 'creator' && role !== 'admin') {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the workspace creator or an org admin can export')); return;
    }
    const { buffer, filename } = await exportWorkspace(storage, config, {
      orgId: id, ws, exporterGaii: resolveIdentity(req.auth!, config.nodeId), exportedAt: new Date().toISOString(),
      isOrgManager: role === 'creator' || role === 'admin',
    });
    // Programmatic/MCP callers can request the ZIP as base64 JSON (size-capped to keep it out of an
    // agent's context); the UI downloads the binary directly.
    if (req.query.format === 'base64') {
      if (buffer.length > 1_500_000) {
        res.status(413).json(error(config.nodeId, 'TOO_LARGE', 'This workspace is too big to send in one piece. Download it from the page instead.'));
        return;
      }
      res.json(success(config.nodeId, { filename, size_bytes: buffer.length, zip_base64: buffer.toString('base64') }));
      return;
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  });

  /* ── POST /v1/organisms/:id/workspace/import — restore a workspace ZIP as a NEW workspace in this
   * organism. Body is the raw ZIP (Content-Type application/zip). Member of the target org only;
   * the importer becomes the new workspace's creator. ── */
  router.post('/v1/organisms/:id/workspace/import', requireAuth(), requireScope('organism:write'),
    // Raw-parse the body EXCEPT application/json (which the global json parser handles → { zip_base64 }).
    raw({ type: (r) => !/application\/json/i.test(r.headers['content-type'] || ''), limit: '64mb' }),
    async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!(await memberRole(req, organism, id))) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    const b64 = (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) ? (req.body as { zip_base64?: string }).zip_base64 : undefined;
    const buf = Buffer.isBuffer(req.body) ? req.body : (typeof b64 === 'string' ? Buffer.from(b64, 'base64') : null);
    if (!buf || buf.length === 0) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Send the workspace ZIP as the raw body (Content-Type: application/zip) or JSON { zip_base64 }')); return; }
    try {
      const result = await importWorkspace(storage, config, { orgId: id, importerGaii: resolveIdentity(req.auth!, config.nodeId), importerOwner: req.auth!.owner as string, zip: buf });
      emitChange('organisms');
      res.status(201).json(success(config.nodeId, result));
    } catch (e) {
      if (e instanceof ZipSecurityError) {
        const inc = await recordSecurityIncident(storage, config, { type: 'zip_import', code: e.code, actorGhii: resolveIdentity(req.auth!, config.nodeId), actorName: req.auth!.owner as string, detail: e.message, source: 'workspace_import', blob: buf });
        res.status(422).json(error(config.nodeId, 'ZIP_REJECTED', `Upload rejected by safety checks (${e.code}) and quarantined for review (incident ${inc.id}).`));
        return;
      }
      res.status(400).json(error(config.nodeId, 'IMPORT_FAILED', (e as Error).message || 'Could not import the workspace'));
    }
  });

  /* ── GET /v1/organisms/:id/export — download a ZIP backup of the WHOLE organism (settings + all
   * its workspaces). Any ACTIVE MEMBER (membership keyed by the bare owner name — org agents in
   * agentGaiis don't qualify): the bundle contains only what the member can already read live, so
   * the gate matches the read model instead of silently 403ing members the UI shows the button to.
   * ?format=base64 for a size-capped JSON payload. ── */
  router.get('/v1/organisms/:id/export', requireAuth(), requireScope('organism:read'), async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const ownerName = req.auth!.owner as string | undefined;
    const m = ownerName ? await storage.getMembership(id, ownerName) : null;
    if (!m || m.status !== 'active') { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only an active member of the organism can export it')); return; }
    // Export as the member's owner GHII — a member reads the whole organism live, and the per-creator
    // registry + records are GHII-owned (an agent-session GAII used to yield a near-empty bundle).
    const { buffer, filename } = await exportOrganism(storage, config, { orgId: id, exporterGaii: `${ownerName}@${config.nodeId}`, exportedAt: new Date().toISOString() });
    if (req.query.format === 'base64') {
      if (buffer.length > 1_500_000) { res.status(413).json(error(config.nodeId, 'TOO_LARGE', 'This organism is too big to send in one piece. Download it from the page instead.')); return; }
      res.json(success(config.nodeId, { filename, size_bytes: buffer.length, zip_base64: buffer.toString('base64') }));
      return;
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  });

  /* ── POST /v1/organisms/import — restore an organism bundle ZIP as a NEW organism (the importer
   * becomes its creator). Body is the raw ZIP (application/zip) or JSON { zip_base64 }. ── */
  // Same word the sibling workspace/import door has always carried, and the one
  // aimeat_organism_import publishes.
  router.post('/v1/organisms/import', requireAuth(), requireRole('agent'), requireScope('organism:write'),
    raw({ type: (r) => !/application\/json/i.test(r.headers['content-type'] || ''), limit: '128mb' }),
    async (req, res) => {
    const b64 = (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) ? (req.body as { zip_base64?: string }).zip_base64 : undefined;
    const buf = Buffer.isBuffer(req.body) ? req.body : (typeof b64 === 'string' ? Buffer.from(b64, 'base64') : null);
    if (!buf || buf.length === 0) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Send the organism ZIP as the raw body (Content-Type: application/zip) or JSON { zip_base64 }')); return; }
    try {
      const result = await importOrganism(storage, config, { importerGaii: resolveIdentity(req.auth!, config.nodeId), importerOwner: req.auth!.owner as string, zip: buf });
      emitChange('organisms');
      res.status(201).json(success(config.nodeId, result));
    } catch (e) {
      if (e instanceof ZipSecurityError) {
        const inc = await recordSecurityIncident(storage, config, { type: 'zip_import', code: e.code, actorGhii: resolveIdentity(req.auth!, config.nodeId), actorName: req.auth!.owner as string, detail: e.message, source: 'organism_import', blob: buf });
        res.status(422).json(error(config.nodeId, 'ZIP_REJECTED', `Upload rejected by safety checks (${e.code}) and quarantined for review (incident ${inc.id}).`));
        return;
      }
      res.status(400).json(error(config.nodeId, 'IMPORT_FAILED', (e as Error).message || 'Could not import the organism'));
    }
  });

}
