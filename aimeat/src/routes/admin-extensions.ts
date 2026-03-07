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
  } catch {
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

      results.push({
        name: metadata.name as string,
        version: (metadata.version as string) || '1.0.0',
        description: (metadata.description as string) || '',
        author: (metadata.author as string) || 'aimeat-core',
        actionsCount: Array.isArray(actions) ? actions.length : 0,
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

      // Register scheduled jobs if any
      if (manifestSchedules && scheduler) {
        const now = new Date().toISOString();
        for (const sched of manifestSchedules) {
          try {
            await storage.createScheduledJob({
              id: `ext.${name}.${sched.id as string}`,
              name: `${name}: ${sched.description || sched.id}`,
              type: 'extension',
              cron: sched.cron as string,
              enabled: true,
              extensionName: name,
              actionId: sched.action as string,
              createdBy: req.auth!.sub,
              createdAt: now,
              updatedAt: now,
            });
          } catch (schedErr) {
            logger.warn(`Failed to register schedule ${sched.id as string} for ${name}`, {
              error: (schedErr as Error).message,
            });
          }
        }
        // Restart scheduler to pick up new jobs
        scheduler.stop();
        await scheduler.start();
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
    } catch (err) {
      logger.error('Failed to install bundled extension', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to install bundled extension'));
    }
  });

  return router;
}
