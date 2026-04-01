/**
 * @file src/services/generator-registration.ts
 * @description Internal registration helpers used by the agent-driven generator.
 * Extracted/adapted from src/routes/csm.ts, msm.ts, extensions.ts, apps.ts
 * to allow agents to register components using owner GHII derived from their agent record.
 * @structure
 *   registerCsm(content, ownerName, storage)              — parse + validate + store CSM + schema
 *   registerMsm(content, ownerName, storage)              — parse + validate + store MSM
 *   registerExtension(content, ownerName, ownerGhii, storage, maxExtensionsPerOwner?) — parse YAML+JS + store ExtensionRecord
 *   registerApp(content, ownerName, callerGaii, storage)  — store HTML as AppRecord
 * @usage
 *   import { registerCsm, registerMsm, registerExtension, registerApp } from '../services/generator-registration.js';
 * @version-history
 *   v1.0.0 — 2026-03-18 — Initial extraction for generator agent support
 *   v1.1.0 — 2026-03-18 — Accept ownerName directly (no split('@')); add callerGaii to registerApp; add extension per-owner limit check
 */

import { parse as parseYaml } from 'yaml';
import type { Storage, AppManifest, ExtensionRecord } from '../storage/interface.js';
import { parseCsm, validateCsm, csmToJsonSchema } from './csm-parser.js';
import { parseMsm, validateMsm } from './msm-parser.js';

/**
 * Register a CSM service definition on behalf of ownerName.
 * Content is a YAML or JSON string. Mirrors POST /v1/csm logic exactly.
 */
export async function registerCsm(content: string, ownerName: string, storage: Storage): Promise<void> {

  let definition: ReturnType<typeof parseCsm>;
  try {
    definition = parseCsm(content);
  } catch (err: unknown) {
    throw new Error(`Failed to parse CSM YAML: ${(err as Error).message}`, { cause: err });
  }

  const validationErrors = validateCsm(definition);
  if (validationErrors.length > 0) {
    throw new Error(`CSM validation failed: ${validationErrors.join('; ')}`);
  }

  // If CSM already exists, remove it first (generator always overwrites)
  const existing = await storage.getCsm(definition.service.name);
  if (existing) {
    await storage.deleteCsm(definition.service.name);
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
  await storage.createCsm({
    name: definition.service.name,
    definition: definition as unknown as Record<string, unknown>,
    jsonSchemaKey: schemaKey,
    serviceType: definition.service.type,
    registeredBy: ownerName,
    registeredAt: now,
    updatedAt: now,
    ...(serviceSemantic ? { semantic: serviceSemantic } : {}),
  });
}

/**
 * Register an MSM integration on behalf of ownerName.
 * Content is a YAML or JSON string. Mirrors POST /v1/msm logic exactly.
 */
export async function registerMsm(content: string, ownerName: string, storage: Storage): Promise<void> {

  let definition: ReturnType<typeof parseMsm>;
  try {
    definition = parseMsm(content);
  } catch (err: unknown) {
    throw new Error(`Failed to parse MSM YAML: ${(err as Error).message}`, { cause: err });
  }

  const validationErrors = validateMsm(definition);
  if (validationErrors.length > 0) {
    throw new Error(`MSM validation failed: ${validationErrors.join('; ')}`);
  }

  // If MSM already exists, remove it first (generator always overwrites)
  const existing = await storage.getMsm(definition.service.name);
  if (existing) {
    await storage.deleteMsm(definition.service.name);
  }

  const now = new Date().toISOString();
  await storage.createMsm({
    name: definition.service.name,
    definition: definition as unknown as Record<string, unknown>,
    category: definition.service.category,
    authType: definition.auth.type,
    actionsCount: definition.actions.length,
    registeredBy: ownerName,
    registeredAt: now,
    updatedAt: now,
  });
}

/**
 * Install an extension on behalf of ownerName.
 * Content is the YAML+JS composite string produced by the generator.
 * The YAML block contains the manifest; JS fenced blocks contain action scripts.
 * Mirrors POST /v1/extensions logic exactly.
 * @param maxExtensionsPerOwner — optional per-owner limit; throws if exceeded
 */
export async function registerExtension(content: string, ownerName: string, ownerGhii: string, storage: Storage, maxExtensionsPerOwner?: number): Promise<void> {

  // Split content into manifest YAML and embedded scripts.
  // The generator stores YAML at the top, followed by ```javascript ... ``` blocks.
  // Each fenced JS block has a preceding comment "// actions/<filename>.js".
  const scripts: Record<string, string> = {};

  // Extract all fenced JS blocks — they map to action.script field values.
  // Two formats are accepted:
  //   Format A: preceded by "// actions/<scriptname>.js"
  //   Format B: preceded by an action id comment or just sequential
  // We rely on the manifest's actions[].script to know the key name.
  // Extract raw JS blocks in order.
  const jsBlockRegex = /```javascript\s*\n([\s\S]*?)```/gi;
  const jsBlocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = jsBlockRegex.exec(content)) !== null) {
    jsBlocks.push(match[1]!.trim());
  }

  // Also handle unfenced format "// actions/<name>.js\n<code>" used by some generator outputs.
  // Split by action markers instead of regex — the old regex used `$` with `m` flag which
  // matched end-of-line instead of end-of-string, truncating each script to ~1 line.
  const unfencedBlocks: Array<{ name: string; code: string }> = [];
  const actionMarkerRegex = /^\/\/\s*actions\/([\w-]+\.js)\s*$/gm;
  const markers: Array<{ name: string; index: number }> = [];
  let um: RegExpExecArray | null;
  while ((um = actionMarkerRegex.exec(content)) !== null) {
    markers.push({ name: um[1]!, index: um.index + um[0].length });
  }
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i]!.index;
    const end = i + 1 < markers.length
      ? content.lastIndexOf('\n', content.indexOf(`// actions/${markers[i + 1]!.name}`, start))
      : content.length;
    const code = content.slice(start, end).trim();
    if (code) unfencedBlocks.push({ name: markers[i]!.name, code });
  }

  // Extract just the YAML part (everything before the first JS block or comment)
  const jsStart = content.search(/```javascript|^\/\/\s*actions\//m);
  const manifestYaml = jsStart > 0 ? content.slice(0, jsStart).trim() : content.trim();

  let manifest: Record<string, unknown>;
  try {
    manifest = parseYaml(manifestYaml) as Record<string, unknown>;
  } catch {
    throw new Error('Failed to parse extension manifest YAML');
  }

  const metadata = manifest.metadata as Record<string, unknown> | undefined;
  if (!metadata?.name || !metadata?.version || !metadata?.description || !metadata?.author) {
    throw new Error('metadata.name, metadata.version, metadata.description, and metadata.author are required');
  }

  const actions = manifest.actions as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error('actions array is required and must not be empty');
  }

  for (const action of actions) {
    if (!action.id || !action.method || !action.path || !action.script) {
      throw new Error('Each action must have id, method, path, and script fields');
    }
  }

  // Build scripts map from the parsed blocks.
  // If unfenced blocks found, use them (name → code).
  if (unfencedBlocks.length > 0) {
    for (const { name, code } of unfencedBlocks) {
      scripts[name] = code;
    }
  } else {
    // Map sequential fenced blocks to action.script values in order.
    for (let i = 0; i < actions.length && i < jsBlocks.length; i++) {
      const scriptKey = actions[i]!.script as string;
      scripts[scriptKey] = jsBlocks[i]!;
    }
  }

  // Validate that all referenced scripts are present
  for (const action of actions) {
    const scriptKey = action.script as string;
    if (!scripts[scriptKey]) {
      throw new Error(`Script "${scriptKey}" referenced in action "${action.id as string}" not found in content`);
    }
  }

  // Enforce maxExtensionsPerOwner limit if configured
  if (maxExtensionsPerOwner && maxExtensionsPerOwner > 0) {
    const allExts = await storage.listExtensions();
    const ownerExts = allExts.filter(e => e.installedBy === ownerName);
    if (ownerExts.length >= maxExtensionsPerOwner) {
      throw new Error(`Extension limit reached: owner ${ownerName} already has ${ownerExts.length}/${maxExtensionsPerOwner} extensions`);
    }
  }

  // If extension already exists, remove it first (generator always overwrites)
  const name = metadata.name as string;
  const existingExt = await storage.getExtension(name);
  if (existingExt) {
    await storage.deleteExtension(name);
  }

  // Build ExtensionRecord — mirrors POST /v1/extensions exactly
  const manifestConfig = manifest.config as Record<string, unknown> | undefined;
  const manifestLimits = manifest.limits as Record<string, unknown> | undefined;
  const manifestFederation = manifest.federation as Record<string, unknown> | undefined;
  const manifestSchedules = manifest.schedules as Array<Record<string, unknown>> | undefined;
  const manifestInstances = manifest.instances as Record<string, unknown> | undefined;

  const record: ExtensionRecord = {
    name,
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
      scriptContent: scripts[a.script as string]!,
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
      memoryMb: (manifestLimits?.memory_mb as number) ?? 64,
      timeoutMs: (manifestLimits?.timeout_ms as number) ?? 30000,
      maxApiCalls: (manifestLimits?.max_api_calls as number) ?? 100,
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
    installedBy: ownerName,
    installedAt: new Date().toISOString(),
  };

  await storage.createExtension(record);
}

/**
 * Publish an app on behalf of ownerName / callerGaii.
 * Content is base64-encoded HTML (or raw HTML). Mirrors POST /v1/apps logic.
 * The generator stores raw HTML; we accept both base64 and raw.
 * @param callerGaii — storage identity used as ownerGaii (matches what apps.ts stores for agents)
 */
export async function registerApp(content: string, ownerName: string, callerGaii: string, storage: Storage): Promise<void> {

  // Detect if content is base64 — try to decode; if it looks like HTML, treat as raw
  let data: Buffer;
  const mimeType = 'text/html';
  const trimmed = content.trim();

  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.startsWith('<!--')) {
    // Raw HTML
    data = Buffer.from(trimmed, 'utf-8');
  } else {
    // Assume base64-encoded
    try {
      data = Buffer.from(content, 'base64');
      // Sanity check: decoded should look like HTML
      const decoded = data.toString('utf-8', 0, 20);
      if (!decoded.includes('<') && !decoded.startsWith('<!')) {
        // Not HTML — fall back to raw
        data = Buffer.from(trimmed, 'utf-8');
      }
    } catch {
      data = Buffer.from(trimmed, 'utf-8');
    }
  }

  // Extract AIMEAT App Manifest comment from HTML
  // Format: <!-- AIMEAT App Manifest\nname: ...\ndescription: ...\n-->
  const manifestMatch = data.toString('utf-8').match(/<!--\s*AIMEAT App Manifest\s*\n([\s\S]*?)-->/i);
  const manifestData: Record<string, string> = {};
  if (manifestMatch) {
    for (const line of manifestMatch[1]!.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const val = line.slice(colonIdx + 1).trim();
        manifestData[key] = val;
      }
    }
  }

  // Derive filename from name or default
  const appName = manifestData['name'] ?? 'generated-app';
  const filename = appName
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') + '.html';

  // Auto-increment version number
  const existingVersion = await storage.getLatestVersionNumber(callerGaii, filename);
  const newVersion = existingVersion + 1;

  const now = new Date().toISOString();
  const manifest: AppManifest = {
    name: appName,
    description: manifestData['description'] ?? '',
    version: manifestData['version'] ?? `1.0.${newVersion - 1}`,
    category: manifestData['category'] ?? 'utility',
    tags: manifestData['tags'] ? manifestData['tags'].split(',').map(t => t.trim()).filter(Boolean) : [],
    authorDisplay: ownerName,
    usesCortex: manifestData['uses_cortex'] ? manifestData['uses_cortex'].split(',').map(t => t.trim()).filter(Boolean) : [],
  };
  if (manifestData['icon']) manifest.icon = manifestData['icon'];

  await storage.createApp({
    ownerGaii: callerGaii,
    ownerName,
    filename,
    versionNumber: newVersion,
    manifest,
    mimeType,
    size: data.length,
    data,
    createdAt: now,
  });
}
