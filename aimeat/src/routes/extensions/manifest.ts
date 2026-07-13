/**
 * @file src/routes/extensions/manifest.ts
 * @description Shared extension-manifest validator/builder — validates a YAML manifest + scripts map
 *   and builds the ExtensionRecord it describes. Extracted from src/routes/extensions.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/extensions.ts (max-file-lines)
 */
import type { AimeatConfig } from '../../config.js';
import type { ExtensionRecord } from '../../storage/interface.js';
import { parse as parseYaml } from 'yaml';
import { SECRET_KEYS_FIELD, computeManifestSecretKeys } from '../../services/extension-secrets.js';

/** Discriminated result of validating an extension install/upsert payload. */
export type ExtBuildResult =
  | { ok: true; record: ExtensionRecord }
  | { ok: false; status: number; code: string; message: string };

/**
 * Validate an extension install payload (YAML manifest + scripts map) and build the
 * ExtensionRecord it describes. Shared by POST (install) and PUT (upsert) so both validate the
 * manifest identically and produce the same record. Does NOT enforce quota, duplicate-name, or
 * permission — those are caller-specific (create vs. update). The caller supplies the lifecycle
 * fields (installedBy/installedAt); status defaults to 'inactive'.
 */
export function buildExtensionRecordFromManifest(
  manifestYaml: string | undefined,
  scripts: Record<string, string> | undefined,
  config: AimeatConfig,
  installedBy: string,
  installedAt: string,
): ExtBuildResult {
  if (!manifestYaml || typeof manifestYaml !== 'string') {
    return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'manifest (YAML string) is required' };
  }
  if (!scripts || typeof scripts !== 'object') {
    return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'scripts object is required' };
  }

  let manifest: Record<string, unknown>;
  try {
    manifest = parseYaml(manifestYaml) as Record<string, unknown>;
  } catch {
    return { ok: false, status: 400, code: 'INVALID_MANIFEST', message: 'Failed to parse manifest YAML' };
  }

  const metadata = manifest.metadata as Record<string, unknown> | undefined;
  if (!metadata?.name || !metadata?.version || !metadata?.description || !metadata?.author) {
    return { ok: false, status: 400, code: 'INVALID_MANIFEST',
      message: 'metadata.name, metadata.version, metadata.description, and metadata.author are required' };
  }

  const actions = manifest.actions as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(actions) || actions.length === 0) {
    return { ok: false, status: 400, code: 'INVALID_MANIFEST', message: 'actions array is required and must not be empty' };
  }
  for (const action of actions) {
    if (!action.id || !action.method || !action.path || !action.script) {
      return { ok: false, status: 400, code: 'INVALID_MANIFEST', message: 'Each action must have id, method, path, and script fields' };
    }
    if (!scripts[action.script as string]) {
      return { ok: false, status: 400, code: 'MISSING_SCRIPT',
        message: `Script "${action.script as string}" referenced in action "${action.id as string}" not found in scripts object` };
    }
  }

  const manifestInstances = manifest.instances as Record<string, unknown> | undefined;
  if (manifestInstances) {
    if (typeof manifestInstances.supported !== 'boolean') {
      return { ok: false, status: 400, code: 'INVALID_MANIFEST', message: 'instances.supported must be a boolean' };
    }
    if (manifestInstances.config_per_instance !== undefined
      && (typeof manifestInstances.config_per_instance !== 'object' || manifestInstances.config_per_instance === null)) {
      return { ok: false, status: 400, code: 'INVALID_MANIFEST', message: 'instances.config_per_instance must be an object (JSON Schema)' };
    }
  }

  for (const [scriptKey, scriptContent] of Object.entries(scripts)) {
    const sizeKb = Buffer.byteLength(scriptContent, 'utf8') / 1024;
    if (sizeKb > config.extensionMaxCodeSizeKb) {
      return { ok: false, status: 400, code: 'CODE_TOO_LARGE',
        message: `Script "${scriptKey}" is ${sizeKb.toFixed(1)}KB, max is ${config.extensionMaxCodeSizeKb}KB` };
    }
  }

  const manifestConfig = manifest.config as Record<string, unknown> | undefined;
  const manifestLimits = manifest.limits as Record<string, unknown> | undefined;
  const manifestFederation = manifest.federation as Record<string, unknown> | undefined;
  const manifestSchedules = manifest.schedules as Array<Record<string, unknown>> | undefined;

  const record: ExtensionRecord = {
    name: metadata.name as string,
    version: metadata.version as string,
    description: metadata.description as string,
    author: metadata.author as string,
    status: 'inactive',
    requiredApis: (manifest.required_apis as string[]) ?? [],
    actions: actions.map(a => ({
      id: a.id as string,
      method: (a.method as string).toUpperCase(),
      path: a.path as string,
      inputSchema: (a.input as Record<string, unknown>) ?? {},
      outputSchema: (a.output as Record<string, unknown>) ?? {},
      scriptContent: scripts[a.script as string],
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
      // Record which config fields are `type: 'secret'` so the route can encrypt their values
      // at rest and the runtime can decrypt before the VM (the descriptor type is otherwise
      // lost by the flatten above). See services/extension-secrets.ts.
      ...((): Record<string, unknown> => {
        const secretKeys = computeManifestSecretKeys(manifestConfig);
        return secretKeys.length ? { [SECRET_KEYS_FIELD]: secretKeys } : {};
      })(),
    },
    limits: {
      memoryMb: Math.min((manifestLimits?.memory_mb as number) ?? config.extensionMaxMemoryMb, config.extensionMaxMemoryMb),
      timeoutMs: Math.min((manifestLimits?.timeout_ms as number) ?? config.extensionTimeoutMs, config.extensionTimeoutMs),
      maxApiCalls: Math.min((manifestLimits?.max_api_calls as number) ?? config.extensionMaxApiCalls, config.extensionMaxApiCalls),
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
    installedBy,
    installedAt,
  };

  return { ok: true, record };
}
