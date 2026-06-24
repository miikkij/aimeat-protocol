/**
 * @file organism-templates.ts
 * @description Generic REST routes for USE-CASE TEMPLATES (Secretary P5 / S-B) — packaged organism
 *   blueprints as DATA (content-free skeleton + template.json carrying specialists + extension deps +
 *   scope presets). NOT a per-service backend file: these two routes instantiate ANY template, never a
 *   specific one. Built on the organism export/import substrate (services/organism-template.ts).
 *   NOTE: unrelated to routes/templates.ts (the CSM/gallery marketplace).
 * @structure
 *   - POST /v1/organism-templates/export       — export an organism as a template (skeleton + template.json)
 *   - POST /v1/organism-templates/instantiate  — instantiate a template ZIP → org + workspaces + specialists
 * @usage app.use(organismTemplatesRouter(config, storage)) in routes-loader.ts
 * @version-history
 *   v1.1.0 — 2026-06-24 — Secretary P5 (S-D): export gains `publish` (catalog the template as a public
 *     record so the `templates` DiscoverySource surfaces it via /v1/discover); instantiate's unmet
 *     extension deps carry a self-heal `build_prompt`.
 *   v1.0.0 — 2026-06-24 — Initial: use-case template export + instantiate (Secretary P5 S-B)
 */
import { Router, raw } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { emitChange } from '../services/event-bus.js';
import { logger } from '../utils/logger.js';
import { ZipSecurityError } from '../services/safe-zip.js';
import { recordSecurityIncident } from '../services/security-incident.js';
import { exportTemplate, instantiateTemplate, publishTemplateCatalogEntry } from '../services/organism-template.js';
import type { TemplateSpecialist, TemplateExtensionDep } from '../services/organism-template.js';

export function organismTemplatesRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // ── POST /v1/organism-templates/export — export an organism as a use-case template ──
  // Creator/admin only. Returns base64 JSON by default (format: 'binary' for a raw ZIP download).
  router.post('/v1/organism-templates/export', requireAuth(), requireRole('owner'), async (req: Request, res: Response) => {
    try {
      const owner = req.auth!.owner as string;
      const body = (req.body ?? {}) as {
        org_id?: string; title?: string; description?: string;
        specialists?: TemplateSpecialist[]; extensions?: TemplateExtensionDep[];
        scopePresets?: Record<string, string[]>; format?: string;
        publish?: boolean; tags?: string[];
      };
      const orgId = typeof body.org_id === 'string' ? body.org_id : '';
      if (!orgId) return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'org_id is required'));

      const org = await storage.getOrganism(orgId);
      if (!org) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      const isCreatorOrAdmin = org.creatorGhii === owner || (org.admins ?? []).includes(owner);
      if (!isCreatorOrAdmin) {
        return res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the organism creator or an admin can export it as a template'));
      }

      const exportedAt = new Date().toISOString();
      const { buffer, filename, workspaces } = await exportTemplate(storage, config, {
        orgId, exporterGaii: resolveIdentity(req.auth!, config.nodeId), exportedAt,
        template: { title: body.title, description: body.description, specialists: body.specialists, extensions: body.extensions, scopePresets: body.scopePresets },
      });

      // Optionally publish into the public catalog so the `templates` DiscoverySource surfaces it (S-D).
      let published: { key: string; slug: string } | null = null;
      if (body.publish === true) {
        published = await publishTemplateCatalogEntry(storage, config, {
          publisherGhii: `${owner}@${config.nodeId}`, orgId, publishedAt: exportedAt,
          title: body.title || org.name, description: body.description, tags: body.tags,
          specialists: body.specialists, extensions: body.extensions, zipBase64: buffer.toString('base64'),
        });
        emitChange('discover');
      }

      if (body.format === 'binary') {
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
        return;
      }
      if (buffer.length > 1_500_000) {
        return res.status(413).json(error(config.nodeId, 'TOO_LARGE', 'Template too large for inline (base64) export — use format: "binary".'));
      }
      res.json(success(config.nodeId, { filename, workspaces, size_bytes: buffer.length, zip_base64: buffer.toString('base64'), published }));
    } catch (err) {
      logger.error('Failed to export template', { error: (err as Error).message });
      res.status(400).json(error(config.nodeId, 'EXPORT_FAILED', (err as Error).message || 'Could not export the template'));
    }
  });

  // ── POST /v1/organism-templates/instantiate — instantiate a template ZIP into a NEW organism ──
  // Body is the raw ZIP (application/zip) or JSON { zip_base64 }. The owner becomes the new org's creator.
  router.post('/v1/organism-templates/instantiate', requireAuth(), requireRole('owner'),
    raw({ type: (r) => !/application\/json/i.test(r.headers['content-type'] || ''), limit: '64mb' }),
    async (req: Request, res: Response) => {
      const b64 = (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) ? (req.body as { zip_base64?: string }).zip_base64 : undefined;
      const buf = Buffer.isBuffer(req.body) ? req.body : (typeof b64 === 'string' ? Buffer.from(b64, 'base64') : null);
      if (!buf || buf.length === 0) {
        return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Send the template ZIP as the raw body (Content-Type: application/zip) or JSON { zip_base64 }'));
      }
      try {
        const result = await instantiateTemplate(storage, config, {
          importerGaii: resolveIdentity(req.auth!, config.nodeId), importerOwner: req.auth!.owner as string, zip: buf,
        });
        emitChange('organisms');
        emitChange('agents');
        res.status(201).json(success(config.nodeId, result, [
          { description: 'View the new organism', method: 'GET', url: `/v1/organisms/${result.organism_id}` },
          { description: 'List specialists', method: 'GET', url: '/v1/specialists' },
        ]));
      } catch (e) {
        if (e instanceof ZipSecurityError) {
          const inc = await recordSecurityIncident(storage, config, {
            type: 'zip_import', code: e.code, actorGhii: resolveIdentity(req.auth!, config.nodeId),
            actorName: req.auth!.owner as string, detail: e.message, source: 'template_instantiate', blob: buf,
          });
          res.status(422).json(error(config.nodeId, 'ZIP_REJECTED', `Upload rejected by safety checks (${e.code}) and quarantined for review (incident ${inc.id}).`));
          return;
        }
        logger.error('Failed to instantiate template', { error: (e as Error).message });
        res.status(400).json(error(config.nodeId, 'INSTANTIATE_FAILED', (e as Error).message || 'Could not instantiate the template'));
      }
    });

  return router;
}
