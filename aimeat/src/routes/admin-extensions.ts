/**
 * @file src/routes/admin-extensions.ts
 * @description Operator-only admin routes for managing bundled extensions: it reads the
 *   `docs/extensions/` directory, exposes the catalogue of available extensions, and lets operators
 *   install/reinstall them, scaffold new ones, and edit action scripts.
 *
 * @structure
 *   - getBundledExtensionsDir/readBundledExtensions: discover + parse extension.yaml manifests on disk
 *   - adminExtensionsRouter: builds the Express router (all routes require operator role)
 *   - GET /available + /:name/install + /:name/reinstall: catalogue and install lifecycle
 *   - /scaffold, /:name/actions, GET|PUT /:name/scripts/:actionId: authoring endpoints
 *
 * @version-history
 *   v1.1.0 — 2026-08-16 — Bundled install registers its schedules through
 *     services/extension-schedules.ts. Its own copy produced a second id shape (`ext.name.id`) for
 *     the same schedule, left out the `ownerScope` the executor needs, and picked the jobs up by
 *     restarting the whole scheduler — which re-ran every @activate job on the node.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { Router } from 'express';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import type { AimeatConfig } from '../config.js';
import type { Storage, ExtensionRecord } from '../storage/interface.js';
import type { Scheduler } from '../services/scheduler.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { registerExtensionSchedules } from '../services/extension-schedules.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Resolve the bundled extensions directory.
 * In dev:  src/routes/../../docs/extensions  (repo root)
 * In dist: dist/src/routes/../../../docs/extensions
 */
function getBundledExtensionsDir(): string {
  const candidates = [
    join(__dirname, '..', '..', '..', 'docs', 'extensions'),   // dist
    join(__dirname, '..', '..', 'docs', 'extensions'),          // dev (src/)
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0]; // fallback
}

interface BundledExtensionInfo {
  name: string;
  version: string;
  description: string;
  author: string;
  actionsCount: number;
  actions: { id: string; method: string }[];
  instancesSupported: boolean;
  requiredApis: string[];
}

function readBundledExtensions(): BundledExtensionInfo[] {
  const dir = getBundledExtensionsDir();
  if (!existsSync(dir)) return [];

  const results: BundledExtensionInfo[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch (err) {
    logger.warn('admin-extensions: suppressed failure, continuing', { error: String(err) });
    return [];
  }

  for (const entry of entries) {
    const yamlPath = join(dir, entry, 'extension.yaml');
    if (!existsSync(yamlPath)) continue;

    try {
      const manifest = parseYaml(readFileSync(yamlPath, 'utf-8')) as Record<string, unknown>;
      const metadata = manifest.metadata as Record<string, unknown> | undefined;
      if (!metadata?.name) continue;

      const actions = manifest.actions as Array<Record<string, unknown>> | undefined;
      const instances = manifest.instances as Record<string, unknown> | undefined;

      const actionList = Array.isArray(actions)
        ? actions.map(a => ({ id: a.id as string, method: (a.method as string) || 'POST' }))
        : [];

      results.push({
        name: metadata.name as string,
        version: (metadata.version as string) || '1.0.0',
        description: (metadata.description as string) || '',
        author: (metadata.author as string) || 'aimeat-core',
        actionsCount: actionList.length,
        actions: actionList,
        instancesSupported: !!(instances?.supported),
        requiredApis: Array.isArray(manifest.required_apis) ? manifest.required_apis as string[] : [],
      });
    } catch {
      logger.warn(`Failed to parse bundled extension: ${entry}`);
    }
  }

  return results;
}

function readBundledExtensionFull(name: string): { manifest: string; scripts: Record<string, string> } | null {
  const dir = getBundledExtensionsDir();
  const extDir = join(dir, name);
  const yamlPath = join(extDir, 'extension.yaml');

  if (!existsSync(yamlPath)) return null;

  const manifestYaml = readFileSync(yamlPath, 'utf-8');

  // Parse to find action scripts
  const manifest = parseYaml(manifestYaml) as Record<string, unknown>;
  const actions = manifest.actions as Array<Record<string, unknown>> | undefined;

  const scripts: Record<string, string> = {};
  if (Array.isArray(actions)) {
    for (const action of actions) {
      const scriptPath = action.script as string | undefined;
      if (!scriptPath) continue;
      const fullPath = join(extDir, scriptPath);
      if (existsSync(fullPath)) {
        scripts[scriptPath] = readFileSync(fullPath, 'utf-8');
      }
    }
  }

  return { manifest: manifestYaml, scripts };
}

export function adminExtensionsRouter(config: AimeatConfig, storage: Storage, scheduler?: Scheduler): Router {
  const router = Router();

  // ── GET /v1/admin/extensions/available — List bundled extensions ──
  router.get('/v1/admin/extensions/available', requireAuth(), requireRole('operator'), async (_req, res) => {
    try {
      const bundled = readBundledExtensions();

      // Check which are already installed
      const installed = await storage.listExtensions();
      const installedNames = new Set(installed.map(e => e.name));

      const available = bundled.map(ext => ({
        ...ext,
        installed: installedNames.has(ext.name),
        status: installedNames.has(ext.name)
          ? installed.find(e => e.name === ext.name)?.status || 'unknown'
          : 'not_installed',
      }));

      res.json(success(config.nodeId, { extensions: available, total: available.length }));
    } catch (err) {
      logger.error('Failed to list available extensions', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to list available extensions'));
    }
  });

  // ── POST /v1/admin/extensions/available/:name/install — One-click install bundled extension ──
  router.post('/v1/admin/extensions/available/:name/install', requireAuth(), requireRole('operator'), async (req, res) => {
    try {
      const name = req.params.name as string;

      // Check if already installed
      const existingExt = await storage.getExtension(name);
      if (existingExt) {
        res.status(409).json(error(config.nodeId, 'ALREADY_EXISTS', `Extension "${name}" is already installed`));
        return;
      }

      // Read bundled extension
      const bundled = readBundledExtensionFull(name);
      if (!bundled) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Bundled extension "${name}" not found`));
        return;
      }

      // Parse manifest
      let manifest: Record<string, unknown>;
      try {
        manifest = parseYaml(bundled.manifest) as Record<string, unknown>;
      } catch {
        res.status(500).json(error(config.nodeId, 'INVALID_MANIFEST', 'Failed to parse bundled manifest'));
        return;
      }

      const metadata = manifest.metadata as Record<string, unknown>;
      const actions = manifest.actions as Array<Record<string, unknown>>;
      const manifestConfig = manifest.config as Record<string, unknown> | undefined;
      const manifestLimits = manifest.limits as Record<string, unknown> | undefined;
      const manifestFederation = manifest.federation as Record<string, unknown> | undefined;
      const manifestInstances = manifest.instances as Record<string, unknown> | undefined;
      const manifestSchedules = manifest.schedules as Array<Record<string, unknown>> | undefined;

      // Enforce max installed limit
      const existing = await storage.listExtensions();
      if (existing.length >= config.extensionMaxInstalled) {
        res.status(409).json(error(config.nodeId, 'LIMIT_EXCEEDED',
          `Maximum ${config.extensionMaxInstalled} extensions allowed`));
        return;
      }

      // Build ExtensionRecord (same logic as POST /v1/extensions)
      const record: ExtensionRecord = {
        name: metadata.name as string,
        version: metadata.version as string,
        description: metadata.description as string,
        author: metadata.author as string,
        status: 'active',  // bundled extensions activate immediately
        requiredApis: (manifest.required_apis as string[]) ?? [],
        actions: actions.map(a => ({
          id: a.id as string,
          method: (a.method as string).toUpperCase(),
          path: a.path as string,
          inputSchema: (a.input as Record<string, unknown>) ?? {},
          outputSchema: (a.output as Record<string, unknown>) ?? {},
          scriptContent: bundled.scripts[a.script as string] || '',
        })),
        config: {
          ...(manifestConfig
            ? Object.fromEntries(
                Object.entries(manifestConfig).map(([k, v]) => {
                  if (v && typeof v === 'object' && 'default' in (v as Record<string, unknown>)) {
                    return [k, (v as Record<string, unknown>).default];
                  }
                  return [k, v];
                }),
              )
            : {}),
          ...(manifestSchedules ? { __schedules: manifestSchedules } : {}),
        },
        limits: {
          memoryMb: Math.min(
            (manifestLimits?.memory_mb as number) ?? config.extensionMaxMemoryMb,
            config.extensionMaxMemoryMb,
          ),
          timeoutMs: Math.min(
            (manifestLimits?.timeout_ms as number) ?? config.extensionTimeoutMs,
            config.extensionTimeoutMs,
          ),
          maxApiCalls: Math.min(
            (manifestLimits?.max_api_calls as number) ?? config.extensionMaxApiCalls,
            config.extensionMaxApiCalls,
          ),
        },
        federation: {
          advertise: (manifestFederation?.advertise as boolean) ?? false,
          capabilities: (manifestFederation?.capabilities as string[]) ?? [],
        },
        ...(manifestInstances?.supported ? {
          instances: {
            supported: true,
            configSchema: (manifestInstances.config_per_instance as Record<string, unknown>) ?? undefined,
          },
        } : {}),
        installedBy: req.auth!.sub,
        installedAt: new Date().toISOString(),
        activatedAt: new Date().toISOString(),
      };

      const created = await storage.createExtension(record);

      // Register the schedules the manifest declares. Through the same builder every other install
      // door uses: this route had its own copy, which produced a second id shape (`ext.name.id`) for
      // the same schedule and left out the owner scope the executor needs at run time. It also
      // restarted the whole scheduler to pick the jobs up, which re-ran every @activate job on the
      // node; addJob inside the builder does it for these jobs alone.
      if (manifestSchedules && scheduler) {
        try {
          await registerExtensionSchedules({ storage, config, scheduler }, created, req.auth!.sub);
          // A bundled extension installs ACTIVE, so its @activate jobs are due now. The restart used
          // to do this as a side effect, for every extension on the node rather than for this one.
          scheduler.runActivateJobs(name).catch(err =>
            logger.error(`Failed to run @activate jobs for ${name}`, { error: String(err) }));
        } catch (schedErr) {
          logger.warn(`Failed to register schedules for ${name}`, { error: (schedErr as Error).message });
        }
      }

      logger.info(`Bundled extension installed: ${created.name}`, { version: created.version, by: req.auth!.sub });

      res.status(201).json(success(config.nodeId, {
        extension: {
          name: created.name,
          version: created.version,
          description: created.description,
          status: created.status,
          actionsCount: created.actions.length,
        },
      }));
      emitChange('admin-extensions');
    } catch (err) {
      logger.error('Failed to install bundled extension', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to install bundled extension'));
    }
  });

  // ── POST /v1/admin/extensions/scaffold — Create extension files on disk ──
  router.post('/v1/admin/extensions/scaffold', requireAuth(), requireRole('operator'), async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const name = body.name as string;
      const description = body.description as string || 'Custom extension';
      const multiInstance = body.multiInstance as boolean ?? true;
      const apis = (body.apis as string[]) ?? ['memory'];

      if (!name || typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(name)) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR',
          'name is required (3-64 chars, lowercase alphanumeric + hyphens)'));
        return;
      }

      const dir = getBundledExtensionsDir();
      const extDir = join(dir, name);
      if (existsSync(extDir)) {
        res.status(409).json(error(config.nodeId, 'ALREADY_EXISTS', `Extension directory "${name}" already exists`));
        return;
      }

      // Create directory structure
      const { mkdirSync, writeFileSync } = await import('node:fs');
      mkdirSync(join(extDir, 'actions'), { recursive: true });

      // Generate extension.yaml
      const apisYaml = apis.map(a => `  - ${a}`).join('\n');
      const instancesYaml = multiInstance ? `
instances:
  supported: true
  config_per_instance:
    type: object
    properties:
      visibility:
        type: string
        enum: [public, private]
        default: public` : '';

      const yaml = `extension: "1.0"

metadata:
  name: "${name}"
  version: "1.0.0"
  description: "${description.replace(/"/g, '\\"')}"
  author: "custom"

required_apis:
${apisYaml}
${instancesYaml}

actions:
  - id: list
    description: "List items"
    method: POST
    path: "/v1/ext/${name}/:instanceId/list"
    auth: required
    input:
      status:
        type: string
      offset:
        type: integer
      limit:
        type: integer
    output:
      items:
        type: array
      total:
        type: integer
    script: "actions/list.js"

  - id: create
    description: "Create an item"
    method: POST
    path: "/v1/ext/${name}/:instanceId/create"
    auth: required
    input:
      title:
        type: string
        required: true
      description:
        type: string
    output:
      id:
        type: string
      item:
        type: object
    script: "actions/create.js"
`;

      const listScript = `export default async function(ctx, input) {
  // ctx.memory   — get/set/search/delete key-value data
  // ctx.wallet   — consume morsels, check balance
  // ctx.caller   — { gaii, owner, roles }
  // ctx.config   — extension-wide config
  // ctx.instance — { id, config } (instance-specific)
  // ctx.log      — info/warn/error logging

  const results = await ctx.memory.search('item.');
  let items = results.map(r => r.value);

  // Filter by status
  const status = input.status || 'active';
  if (status !== 'all') {
    items = items.filter(i => i.status === status);
  }

  // Sort newest first
  items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  // Paginate
  const total = items.length;
  const offset = input.offset || 0;
  const limit = Math.min(input.limit || 20, 100);
  items = items.slice(offset, offset + limit);

  return { items, total, offset, limit };
}
`;

      const createScript = `export default async function(ctx, input) {
  if (!input.title || typeof input.title !== 'string') {
    throw new Error('title is required');
  }

  const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const item = {
    id,
    title: input.title,
    description: input.description || '',
    creator: ctx.caller.gaii,
    status: 'active',
    createdAt: new Date().toISOString(),
  };

  await ctx.memory.set('item.' + id, item);
  ctx.log.info('Item created', { id, creator: ctx.caller.gaii });

  return { id, item };
}
`;

      writeFileSync(join(extDir, 'extension.yaml'), yaml, 'utf-8');
      writeFileSync(join(extDir, 'actions', 'list.js'), listScript, 'utf-8');
      writeFileSync(join(extDir, 'actions', 'create.js'), createScript, 'utf-8');

      logger.info(`Extension scaffolded on disk: ${name}`, { dir: extDir, by: req.auth!.sub });

      res.status(201).json(success(config.nodeId, {
        name,
        directory: extDir,
        files: ['extension.yaml', 'actions/list.js', 'actions/create.js'],
      }));
      emitChange('admin-extensions');
    } catch (err) {
      logger.error('Failed to scaffold extension', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to scaffold extension'));
    }
  });

  // ── GET /v1/admin/extensions/available/:name/scripts/:actionId — Read action script from disk ──
  router.get('/v1/admin/extensions/available/:name/scripts/:actionId', requireAuth(), requireRole('operator'), async (req, res) => {
    try {
      const name = req.params.name as string;
      const actionId = req.params.actionId as string;
      const dir = getBundledExtensionsDir();
      const scriptPath = join(dir, name, 'actions', `${actionId}.js`);

      if (!existsSync(scriptPath)) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Script "${actionId}" not found for extension "${name}"`));
        return;
      }

      const content = readFileSync(scriptPath, 'utf-8');
      res.json(success(config.nodeId, { actionId, scriptContent: content }));
    } catch (err) {
      logger.error('Failed to read extension script', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to read extension script'));
    }
  });

  // ── PUT /v1/admin/extensions/available/:name/scripts/:actionId — Write action script to disk ──
  router.put('/v1/admin/extensions/available/:name/scripts/:actionId', requireAuth(), requireRole('operator'), async (req, res) => {
    try {
      const name = req.params.name as string;
      const actionId = req.params.actionId as string;
      const body = req.body as Record<string, unknown>;
      const scriptContent = body.scriptContent as string;

      if (!scriptContent || typeof scriptContent !== 'string') {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'scriptContent (string) is required'));
        return;
      }

      const dir = getBundledExtensionsDir();
      const extDir = join(dir, name);
      if (!existsSync(extDir)) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension "${name}" not found on disk`));
        return;
      }

      const actionsDir = join(extDir, 'actions');
      if (!existsSync(actionsDir)) {
        const { mkdirSync } = await import('node:fs');
        mkdirSync(actionsDir, { recursive: true });
      }

      const { writeFileSync: wfs } = await import('node:fs');
      wfs(join(actionsDir, `${actionId}.js`), scriptContent, 'utf-8');

      logger.info(`Extension script saved: ${name}/actions/${actionId}.js`, { by: req.auth!.sub });
      res.json(success(config.nodeId, { actionId, saved: true }));
      emitChange('admin-extensions');
    } catch (err) {
      logger.error('Failed to write extension script', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to write extension script'));
    }
  });

  // ── POST /v1/admin/extensions/available/:name/actions — Add new action to disk extension ──
  router.post('/v1/admin/extensions/available/:name/actions', requireAuth(), requireRole('operator'), async (req, res) => {
    try {
      const name = req.params.name as string;
      const { id, method, description } = req.body as { id?: string; method?: string; description?: string };

      if (!id || typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'id is required (lowercase, hyphens, digits only)'));
        return;
      }

      const dir = getBundledExtensionsDir();
      const extDir = join(dir, name);
      const yamlPath = join(extDir, 'extension.yaml');

      if (!existsSync(yamlPath)) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension "${name}" not found on disk`));
        return;
      }

      // Parse existing manifest
      const yamlContent = readFileSync(yamlPath, 'utf-8');
      const manifest = parseYaml(yamlContent) as Record<string, unknown>;
      const actions = (manifest.actions as Array<Record<string, unknown>>) || [];

      // Check for duplicate
      if (actions.some(a => a.id === id)) {
        res.status(409).json(error(config.nodeId, 'DUPLICATE', `Action "${id}" already exists`));
        return;
      }

      const actionMethod = (method || 'POST').toUpperCase();
      const instancesSupported = !!(manifest.instances as Record<string, unknown>)?.supported;
      const pathPrefix = instancesSupported
        ? `/v1/ext/${name}/:instanceId/${id}`
        : `/v1/ext/${name}/${id}`;

      // Add action to manifest
      const newAction: Record<string, unknown> = {
        id,
        description: description || `Action: ${id}`,
        method: actionMethod,
        path: pathPrefix,
        auth: 'required',
        input: {},
        output: {},
        script: `actions/${id}.js`,
      };
      actions.push(newAction);
      manifest.actions = actions;

      // Write updated YAML
      const { stringify: yamlStringify } = await import('yaml');
      const { writeFileSync: wfs, mkdirSync } = await import('node:fs');
      wfs(yamlPath, yamlStringify(manifest, { lineWidth: 120 }), 'utf-8');

      // Create script file with template
      const actionsDir = join(extDir, 'actions');
      if (!existsSync(actionsDir)) mkdirSync(actionsDir, { recursive: true });

      const scriptTemplate = `// Action: ${id}
// Method: ${actionMethod}
// Extension: ${name}

const { input, memory, caller, instance, log } = ctx;

log('${id} called by ' + caller.gaii);

// TODO: implement action logic

return { ok: true };
`;
      wfs(join(actionsDir, `${id}.js`), scriptTemplate, 'utf-8');

      logger.info(`New action added: ${name}/${id}`, { by: req.auth!.sub });
      res.json(success(config.nodeId, { id, method: actionMethod, created: true }));
      emitChange('admin-extensions');
    } catch (err) {
      logger.error('Failed to add action', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to add action'));
    }
  });

  // ── POST /v1/admin/extensions/available/:name/reinstall — Reinstall from disk (update) ──
  router.post('/v1/admin/extensions/available/:name/reinstall', requireAuth(), requireRole('operator'), async (req, res) => {
    try {
      const name = req.params.name as string;

      // Read updated files from disk
      const bundled = readBundledExtensionFull(name);
      if (!bundled) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension "${name}" not found on disk`));
        return;
      }

      const manifest = parseYaml(bundled.manifest) as Record<string, unknown>;
      const metadata = manifest.metadata as Record<string, unknown>;
      const actions = manifest.actions as Array<Record<string, unknown>>;
      const manifestConfig = manifest.config as Record<string, unknown> | undefined;
      const manifestLimits = manifest.limits as Record<string, unknown> | undefined;
      const manifestFederation = manifest.federation as Record<string, unknown> | undefined;
      const manifestInstances = manifest.instances as Record<string, unknown> | undefined;

      // Check if already installed
      const existingExt = await storage.getExtension(name);

      const record: ExtensionRecord = {
        name: metadata.name as string,
        version: metadata.version as string,
        description: metadata.description as string,
        author: metadata.author as string,
        status: 'active',
        requiredApis: (manifest.required_apis as string[]) ?? [],
        actions: actions.map(a => ({
          id: a.id as string,
          method: (a.method as string).toUpperCase(),
          path: a.path as string,
          inputSchema: (a.input as Record<string, unknown>) ?? {},
          outputSchema: (a.output as Record<string, unknown>) ?? {},
          scriptContent: bundled.scripts[a.script as string] || '',
        })),
        config: {
          ...(manifestConfig
            ? Object.fromEntries(
                Object.entries(manifestConfig).map(([k, v]) => {
                  if (v && typeof v === 'object' && 'default' in (v as Record<string, unknown>)) {
                    return [k, (v as Record<string, unknown>).default];
                  }
                  return [k, v];
                }),
              )
            : {}),
        },
        limits: {
          memoryMb: Math.min(
            (manifestLimits?.memory_mb as number) ?? config.extensionMaxMemoryMb,
            config.extensionMaxMemoryMb,
          ),
          timeoutMs: Math.min(
            (manifestLimits?.timeout_ms as number) ?? config.extensionTimeoutMs,
            config.extensionTimeoutMs,
          ),
          maxApiCalls: Math.min(
            (manifestLimits?.max_api_calls as number) ?? config.extensionMaxApiCalls,
            config.extensionMaxApiCalls,
          ),
        },
        federation: {
          advertise: (manifestFederation?.advertise as boolean) ?? false,
          capabilities: (manifestFederation?.capabilities as string[]) ?? [],
        },
        ...(manifestInstances?.supported ? {
          instances: {
            supported: true,
            configSchema: (manifestInstances.config_per_instance as Record<string, unknown>) ?? undefined,
          },
        } : {}),
        installedBy: req.auth!.sub,
        installedAt: existingExt?.installedAt ?? new Date().toISOString(),
        activatedAt: new Date().toISOString(),
      };

      if (existingExt) {
        // Update existing — preserve instances
        await storage.updateExtension(name, {
          version: record.version,
          description: record.description,
          actions: record.actions,
          config: record.config,
          limits: record.limits,
          requiredApis: record.requiredApis,
          federation: record.federation,
          ...(record.instances ? { instances: record.instances } : {}),
        });
        logger.info(`Extension reinstalled (updated): ${name}`, { by: req.auth!.sub });
      } else {
        // Fresh install
        await storage.createExtension(record);
        logger.info(`Extension installed from disk: ${name}`, { by: req.auth!.sub });
      }

      res.json(success(config.nodeId, {
        extension: { name, version: record.version, status: 'active', actionsCount: record.actions.length },
        reinstalled: !!existingExt,
      }));
      emitChange('admin-extensions');
    } catch (err) {
      logger.error('Failed to reinstall extension', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to reinstall extension'));
    }
  });

  return router;
}
