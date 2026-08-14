/**
 * @file src/routes/msm.ts
 * @description Routes for MSM (Merchant Service Model) integration definitions — the
 *   YAML/JSON descriptors for external service integrations. Registers/validates MSMs
 *   and serves built-in MSM templates loaded from docs/msm-examples at startup. Install
 *   role is configurable via config.msmInstallRole.
 *
 * @structure
 *   - loadMsmTemplates(): read + parse docs/msm-examples/*.msm.yaml into template metadata
 *   - msmRouter(config, storage): Router mounting the /v1/msm endpoints
 *   - POST /v1/msm: parse (YAML or JSON), validate, and register an MSM integration
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { Router } from 'express';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { parseMsm, validateMsm } from '../services/msm-parser.js';
import { emitChange } from '../services/event-bus.js';
import type { MsmDefinition } from '../services/msm-parser.js';
import { logger } from '../utils/logger.js';

// Load MSM templates at startup
interface MsmTemplateMeta {
  type: string;         // filename stem (e.g. "weather-pricing")
  name: string;         // service.name from YAML
  description: string;  // service.description from YAML
  category: string;     // service.category from YAML
  yaml: string;         // raw YAML content
}

function loadMsmTemplates(): MsmTemplateMeta[] {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  // MSM examples live at repo root: docs/msm-examples/
  // From src/routes/ we go up 3 levels to reach the repo root
  const templatesDir = join(__dirname, '..', '..', '..', 'docs', 'msm-examples');
  const templates: MsmTemplateMeta[] = [];

  if (!existsSync(templatesDir)) return templates;

  const files = readdirSync(templatesDir).filter(f => f.endsWith('.msm.yaml'));
  for (const file of files) {
    try {
      const yaml = readFileSync(join(templatesDir, file), 'utf-8');
      const parsed = parseMsm(yaml);
      const type = file.replace('.msm.yaml', '');
      templates.push({
        type,
        name: parsed.service.name,
        description: parsed.service.description ?? '',
        category: parsed.service.category,
        yaml,
      });
    } catch (err) {
      // Skip templates that fail to parse
      logger.warn('loadMsmTemplates: continuing after a suppressed failure', { error: String(err) });
    }
  }

  return templates;
}

const msmTemplates = loadMsmTemplates();

export function msmRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // POST /v1/msm — Register a new MSM integration
  // Accepts text/yaml or application/json
  router.post('/v1/msm', requireAuth(), requireRole(config.msmInstallRole), async (req, res) => {
    const ownerName = req.auth!.owner;

    let definition: MsmDefinition;

    const contentType = req.headers['content-type'] ?? '';
    if (contentType.includes('text/yaml') || contentType.includes('application/x-yaml')) {
      // YAML body
      let yamlStr: string;
      if (typeof req.body === 'string') {
        yamlStr = req.body;
      } else if (Buffer.isBuffer(req.body)) {
        yamlStr = req.body.toString('utf-8');
      } else {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
          'For YAML content, send raw text with Content-Type: text/yaml'));
        return;
      }
      try {
        definition = parseMsm(yamlStr);
      } catch (err: unknown) {
        res.status(400).json(error(config.nodeId, 'PARSE_ERROR',
          `Failed to parse YAML: ${(err as Error).message}`));
        return;
      }
    } else {
      // JSON body
      if (!req.body || typeof req.body !== 'object') {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Request body is required'));
        return;
      }

      // If JSON contains 'yaml' field, parse it
      if (typeof req.body.yaml === 'string') {
        try {
          definition = parseMsm(req.body.yaml as string);
        } catch (err: unknown) {
          res.status(400).json(error(config.nodeId, 'PARSE_ERROR',
            `Failed to parse YAML: ${(err as Error).message}`));
          return;
        }
      } else {
        // Assume the JSON body is a pre-parsed MSM definition
        definition = req.body as MsmDefinition;
      }
    }

    // Validate
    const validationErrors = validateMsm(definition);
    if (validationErrors.length > 0) {
      res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR',
        `MSM validation failed: ${validationErrors.join('; ')}`));
      return;
    }

    // Check if MSM name is already taken
    const existing = await storage.getMsm(definition.service.name);
    if (existing) {
      res.status(409).json(error(config.nodeId, 'MSM_NAME_TAKEN',
        `MSM integration "${definition.service.name}" is already registered`));
      return;
    }

    // Store MSM record
    const now = new Date().toISOString();
    let record: import('../storage/interface.js').MsmRecord;
    try {
      record = await storage.createMsm({
        name: definition.service.name,
        definition: definition as unknown as Record<string, unknown>,
        category: definition.service.category,
        authType: definition.auth.type,
        actionsCount: definition.actions.length,
        registeredBy: ownerName,
        registeredAt: now,
        updatedAt: now,
      });
    } catch (err) {
      if (String(err).includes('MSM_NAME_TAKEN')) {
        res.status(409).json(error(config.nodeId, 'MSM_NAME_TAKEN',
          `MSM integration "${definition.service.name}" is already registered`));
        return;
      }
      throw err;
    }

    res.status(201).json(success(config.nodeId, {
      integration: {
        name: record.name,
        category: record.category,
        auth_type: record.authType,
        actions_count: record.actionsCount,
        registered_by: record.registeredBy,
        registered_at: record.registeredAt,
        definition: record.definition,
      },
    }, [
      { description: 'List all MSM integrations', method: 'GET', url: '/v1/msm' },
      { description: 'View this MSM integration', method: 'GET', url: `/v1/msm/${encodeURIComponent(record.name)}` },
    ]));
    emitChange('msm');
  });

  // GET /v1/msm — List registered MSM integrations
  router.get('/v1/msm', async (req, res) => {
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const msms = await storage.listMsms({ category });

    res.json(success(config.nodeId, {
      integrations: msms.map(m => ({
        name: m.name,
        category: m.category,
        auth_type: m.authType,
        actions_count: m.actionsCount,
        registered_by: m.registeredBy,
        registered_at: m.registeredAt,
        updated_at: m.updatedAt,
      })),
      total: msms.length,
    }));
  });

  // GET /v1/msm/templates — List available MSM templates (public, Tier 0)
  router.get('/v1/msm/templates', (_req, res) => {
    res.json(success(config.nodeId, {
      templates: msmTemplates.map(t => ({
        type: t.type,
        name: t.name,
        description: t.description,
        category: t.category,
      })),
      total: msmTemplates.length,
    }, [
      ...msmTemplates.map(t => ({
        description: `View ${t.type} template`,
        method: 'GET',
        url: `/v1/msm/templates/${t.type}`,
      })),
    ]));
  });

  // GET /v1/msm/templates/:type — Get a specific MSM template as YAML
  router.get('/v1/msm/templates/:type', (req, res) => {
    const type = req.params.type as string;
    const template = msmTemplates.find(t => t.type === type);
    if (!template) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND',
        `MSM template "${type}" not found. Use GET /v1/msm/templates to list available templates.`));
      return;
    }

    res.status(200).type('application/x-yaml').send(template.yaml);
  });

  // GET /v1/msm/:name — Get a single MSM integration
  // Note: unauthenticated — strip auth env var names from definition to avoid leaking infrastructure config
  router.get('/v1/msm/:name', async (req, res) => {
    const name = req.params.name as string;
    const msm = await storage.getMsm(name);
    if (!msm) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `MSM integration "${name}" not found`));
      return;
    }

    // Strip sensitive auth config (env var names) from the public definition
    const safeDef = { ...msm.definition } as Record<string, unknown>;
    if (safeDef.auth && typeof safeDef.auth === 'object') {
      const authObj = safeDef.auth as Record<string, unknown>;
      safeDef.auth = Object.fromEntries(
        Object.entries(authObj).filter(([k]) => k !== 'env_var' && k !== 'env_var_secret'),
      );
    }

    res.json(success(config.nodeId, {
      integration: {
        name: msm.name,
        category: msm.category,
        auth_type: msm.authType,
        actions_count: msm.actionsCount,
        registered_by: msm.registeredBy,
        registered_at: msm.registeredAt,
        updated_at: msm.updatedAt,
        definition: safeDef,
      },
    }, [
      { description: 'Delete this MSM integration', method: 'DELETE', url: `/v1/msm/${encodeURIComponent(msm.name)}` },
    ]));
  });

  // DELETE /v1/msm/:name — Delete an MSM integration
  router.delete('/v1/msm/:name', requireAuth(), requireRole('owner'), async (req, res) => {
    const name = req.params.name as string;
    const ownerName = req.auth!.owner;

    const msm = await storage.getMsm(name);
    if (!msm) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `MSM integration "${name}" not found`));
      return;
    }

    // Only the registerer or an operator can delete
    const isOperator = req.auth!.roles.includes('operator');
    if (msm.registeredBy !== ownerName && !isOperator) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'You can only delete MSM integrations you registered'));
      return;
    }

    // Delete the MSM record
    await storage.deleteMsm(name);

    res.json(success(config.nodeId, {
      deleted: true,
      name,
    }, [
      { description: 'Register a new MSM integration', method: 'POST', url: '/v1/msm' },
      { description: 'List remaining MSM integrations', method: 'GET', url: '/v1/msm' },
    ]));
    emitChange('msm');
  });

  return router;
}
