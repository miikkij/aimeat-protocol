import { Router } from 'express';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { parseCsm, validateCsm, csmToJsonSchema } from '../services/csm-parser.js';
import type { CsmDefinition } from '../services/csm-parser.js';

// Load CSM templates at startup
interface CsmTemplateMeta {
  type: string;         // filename stem (e.g. "marketplace")
  name: string;         // service.name from YAML
  description: string;  // service.description from YAML
  schemaMode: string;   // schema_mode from YAML
  yaml: string;         // raw YAML content
}

function loadCsmTemplates(): CsmTemplateMeta[] {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const templatesDir = join(__dirname, '..', '..', 'docs', 'csm-examples');
  const templates: CsmTemplateMeta[] = [];

  if (!existsSync(templatesDir)) return templates;

  const files = readdirSync(templatesDir).filter(f => f.endsWith('.csm.yaml'));
  for (const file of files) {
    try {
      const yaml = readFileSync(join(templatesDir, file), 'utf-8');
      const parsed = parseCsm(yaml);
      const type = file.replace('.csm.yaml', '');
      templates.push({
        type,
        name: parsed.service.name,
        description: parsed.service.description ?? '',
        schemaMode: parsed.schemaMode,
        yaml,
      });
    } catch {
      // Skip templates that fail to parse
    }
  }

  return templates;
}

const csmTemplates = loadCsmTemplates();

export function csmRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // POST /v1/csm — Register a new CSM service
  // Accepts text/yaml or application/json
  router.post('/v1/csm', requireAuth(), requireRole('owner'), async (req, res) => {
    const ownerName = req.auth!.owner;

    let definition: CsmDefinition;

    const contentType = req.headers['content-type'] ?? '';
    if (contentType.includes('text/yaml') || contentType.includes('application/x-yaml')) {
      // YAML body — Express won't parse this by default, so req.body may be a string or buffer
      let yamlStr: string;
      if (typeof req.body === 'string') {
        yamlStr = req.body;
      } else if (Buffer.isBuffer(req.body)) {
        yamlStr = req.body.toString('utf-8');
      } else {
        // Express already parsed it as JSON — try to get raw
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
          'For YAML content, send raw text with Content-Type: text/yaml'));
        return;
      }
      try {
        definition = parseCsm(yamlStr);
      } catch (err: unknown) {
        res.status(400).json(error(config.nodeId, 'PARSE_ERROR',
          `Failed to parse YAML: ${(err as Error).message}`));
        return;
      }
    } else {
      // JSON body — expect CSM definition directly
      if (!req.body || typeof req.body !== 'object') {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Request body is required'));
        return;
      }

      // If JSON contains 'yaml' field, parse it
      if (typeof req.body.yaml === 'string') {
        try {
          definition = parseCsm(req.body.yaml as string);
        } catch (err: unknown) {
          res.status(400).json(error(config.nodeId, 'PARSE_ERROR',
            `Failed to parse YAML: ${(err as Error).message}`));
          return;
        }
      } else {
        // Assume the JSON body is a pre-parsed CSM definition
        definition = req.body as CsmDefinition;
      }
    }

    // Validate
    const validationErrors = validateCsm(definition);
    if (validationErrors.length > 0) {
      res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR',
        `CSM validation failed: ${validationErrors.join('; ')}`));
      return;
    }

    // Check if CSM name is already taken
    const existing = await storage.getCsm(definition.service.name);
    if (existing) {
      res.status(409).json(error(config.nodeId, 'CSM_NAME_TAKEN',
        `CSM service "${definition.service.name}" is already registered`));
      return;
    }

    // Generate JSON Schema from CSM data_schema
    const jsonSchema = csmToJsonSchema(definition);
    const schemaKey = `csm.${definition.service.name}`;

    // Extract semantic annotation from CSM service.semantic (Phase 0.7)
    const serviceSemantic = definition.service.semantic && typeof definition.service.semantic === 'object'
      ? definition.service.semantic as Record<string, unknown>
      : undefined;

    // Build semanticContext for Schema Locking from CSM semantic
    const semanticContext = serviceSemantic
      ? {
          '@context': serviceSemantic['@context'] as Record<string, string> | undefined,
          '@type': serviceSemantic['@type'] as string | undefined,
        }
      : undefined;

    // Register schema in Schema Locking system
    const now = new Date().toISOString();
    await storage.setSchema({
      keyPattern: schemaKey,
      applyTo: 'prefix',
      schemaJson: jsonSchema,
      schemaMode: definition.schemaMode,
      lockedBy: ownerName,
      setAt: now,
      updatedAt: now,
      ...(semanticContext ? { semanticContext } : {}),
    });

    // Store CSM record
    const record = await storage.createCsm({
      name: definition.service.name,
      definition: definition as unknown as Record<string, unknown>,
      jsonSchemaKey: schemaKey,
      serviceType: definition.service.type,
      registeredBy: ownerName,
      registeredAt: now,
      updatedAt: now,
      ...(serviceSemantic ? { semantic: serviceSemantic } : {}),
    });

    res.status(201).json(success(config.nodeId, {
      csm: {
        name: record.name,
        service_type: record.serviceType,
        json_schema_key: record.jsonSchemaKey,
        registered_by: record.registeredBy,
        registered_at: record.registeredAt,
        definition: record.definition,
        semantic: record.semantic ?? null,
      },
    }, [
      { description: 'List all CSM services', method: 'GET', url: '/v1/csm' },
      { description: 'View this CSM service', method: 'GET', url: `/v1/csm/${encodeURIComponent(record.name)}` },
      { description: 'Write data matching this schema', method: 'POST', url: '/v1/memory' },
    ]));
  });

  // GET /v1/csm — List registered CSM services
  router.get('/v1/csm', async (req, res) => {
    const serviceType = typeof req.query.type === 'string' ? req.query.type : undefined;
    const csms = await storage.listCsms({ serviceType });

    res.json(success(config.nodeId, {
      services: csms.map(c => ({
        name: c.name,
        service_type: c.serviceType,
        json_schema_key: c.jsonSchemaKey,
        registered_by: c.registeredBy,
        registered_at: c.registeredAt,
        updated_at: c.updatedAt,
        has_semantic: !!c.semantic,
      })),
      total: csms.length,
    }));
  });

  // GET /v1/csm/templates — List available CSM templates (public, Tier 0)
  router.get('/v1/csm/templates', (_req, res) => {
    res.json(success(config.nodeId, {
      templates: csmTemplates.map(t => ({
        type: t.type,
        name: t.name,
        description: t.description,
        schema_mode: t.schemaMode,
      })),
      total: csmTemplates.length,
    }, [
      ...csmTemplates.map(t => ({
        description: `View ${t.type} template`,
        method: 'GET',
        url: `/v1/csm/templates/${t.type}`,
      })),
    ]));
  });

  // GET /v1/csm/templates/:type — Get a specific CSM template as YAML
  router.get('/v1/csm/templates/:type', (req, res) => {
    const type = req.params.type as string;
    const template = csmTemplates.find(t => t.type === type);
    if (!template) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND',
        `CSM template "${type}" not found. Use GET /v1/csm/templates to list available templates.`));
      return;
    }

    res.status(200).type('application/x-yaml').send(template.yaml);
  });

  // GET /v1/csm/:name — Get a single CSM service
  router.get('/v1/csm/:name', async (req, res) => {
    const name = req.params.name as string;
    const csm = await storage.getCsm(name);
    if (!csm) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `CSM service "${name}" not found`));
      return;
    }

    res.json(success(config.nodeId, {
      csm: {
        name: csm.name,
        service_type: csm.serviceType,
        json_schema_key: csm.jsonSchemaKey,
        registered_by: csm.registeredBy,
        registered_at: csm.registeredAt,
        updated_at: csm.updatedAt,
        definition: csm.definition,
        semantic: csm.semantic ?? null,
      },
    }, [
      { description: 'View the generated JSON Schema', method: 'GET', url: `/v1/memory/${encodeURIComponent(csm.jsonSchemaKey)}/schema` },
      { description: 'Delete this CSM service', method: 'DELETE', url: `/v1/csm/${encodeURIComponent(csm.name)}` },
    ]));
  });

  // DELETE /v1/csm/:name — Delete a CSM service and its schema
  router.delete('/v1/csm/:name', requireAuth(), requireRole('owner'), async (req, res) => {
    const name = req.params.name as string;
    const ownerName = req.auth!.owner;

    const csm = await storage.getCsm(name);
    if (!csm) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `CSM service "${name}" not found`));
      return;
    }

    // Only the registerer or an operator can delete
    const isOperator = req.auth!.roles.includes('operator');
    if (csm.registeredBy !== ownerName && !isOperator) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'You can only delete CSM services you registered'));
      return;
    }

    // Delete the associated schema
    await storage.deleteSchema(csm.jsonSchemaKey);

    // Delete the CSM record
    await storage.deleteCsm(name);

    res.json(success(config.nodeId, {
      deleted: true,
      name,
      schema_deleted: csm.jsonSchemaKey,
    }, [
      { description: 'Register a new CSM service', method: 'POST', url: '/v1/csm' },
      { description: 'List remaining CSM services', method: 'GET', url: '/v1/csm' },
    ]));
  });

  return router;
}
