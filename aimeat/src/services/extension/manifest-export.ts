/**
 * @file src/services/extension/manifest-export.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An installed extension written back out as the manifest and the scripts that install
 *   it again: buildExtensionRecordFromManifest(manifestOfRecord(ext)) gives the same record.
 *
 *   WHY. The node keeps the record a manifest was turned into, not the manifest. An author who no
 *   longer had the source (a session that ended, a machine that changed) could read every script back
 *   with include_source, but not the manifest, and aimeat_extension_install refuses scripts without
 *   one; rebuilding it by hand lost the config types, the schedules and the snake_case limits, and the
 *   reinstall changed what the extension did (appdev pitfall
 *   ext/update-live-extension-without-its-source-manifest).
 *
 *   WHAT IS NOT WRITTEN. A secret's value (only `type: secret` is: an update that gives no value keeps
 *   the stored one); the node's own config keys (`emailPolicy`, set by an operator, and every `__`
 *   key the node writes for itself); a `payMorsels` of 0, which the manifest never had to say.
 * @structure manifestOfRecord(ext) → { manifest, scripts } · scriptNameOf(actionId)
 * @usage
 *   const { manifest, scripts } = manifestOfRecord(ext);
 *   // aimeat_extension_install { manifest, scripts, update: true } installs the same extension
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (pitfall round A6).
 */
import { stringify as stringifyYaml } from 'yaml';
import type { ExtensionRecord } from '../../storage/interface.js';
import { SECRET_KEYS_FIELD } from './secrets.js';
import { WORKSPACE_DECLARATION_KEY } from './workspace-declaration.js';
import { CAPABILITY_DECLARATION_KEY, NETWORK_HOSTS_KEY } from './capability-declaration.js';
import { NETWORK_HOST_FIELDS_KEY, type NetworkHostField } from './network-hosts.js';
import { USES_SECRETS_KEY } from './secret-uses.js';
import { AI_PROVIDER_DECLARATION_KEY, type ExtensionAiProviderDeclaration } from './ai-provider-declaration.js';
import { NODE_OWNED_CONFIG_KEYS } from './manifest.js';

/** The manifest's price field names, keyed by the record's (manifest.ts PRICE_FIELDS, reversed). */
const PRICE_NAMES: Record<string, string> = {
  inPerMtok: 'in_per_mtok', outPerMtok: 'out_per_mtok', perImage: 'per_image', perSecond: 'per_second',
};

/** The script file an action's code is written to. The ZIP's `scripts/` folder holds the same name. */
export function scriptNameOf(actionId: string): string {
  return `${actionId}.js`;
}

/** The type word a config value is written with, so a reader of the manifest sees what it holds. */
function typeOf(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'string';
  return typeof value === 'object' ? 'object' : typeof value;
}

/** A record value read as a plain object, or undefined. */
function objectAt(config: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = config[key];
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
}

/** The `config:` block: every field the author declared, secrets by type only. */
function configBlock(config: Record<string, unknown>): Record<string, unknown> | undefined {
  const secretKeys = Array.isArray(config[SECRET_KEYS_FIELD]) ? config[SECRET_KEYS_FIELD] as string[] : [];
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (key.startsWith('__') || NODE_OWNED_CONFIG_KEYS.includes(key)) continue;
    out[key] = secretKeys.includes(key) ? { type: 'secret' } : { type: typeOf(value), default: value };
  }
  // A secret declared without a value is not in the stored config at all, only in the key list.
  for (const key of secretKeys) if (!(key in out)) out[key] = { type: 'secret' };
  return Object.keys(out).length ? out : undefined;
}

/** `provides.ai_provider` in the manifest's own spelling. */
function providesBlock(decl: ExtensionAiProviderDeclaration | undefined): Record<string, unknown> | undefined {
  if (!decl) return undefined;
  return {
    ai_provider: {
      ops: decl.ops,
      models: decl.models.map(m => ({
        id: m.id, name: m.name,
        ...(m.caps ? { caps: m.caps } : {}),
        ...(m.price ? { price: Object.fromEntries(Object.entries(m.price).map(([k, v]) => [PRICE_NAMES[k] ?? k, v])) } : {}),
      })),
      data_statement: decl.dataStatement,
      hosts: decl.hosts,
      ...(decl.authHeader ? { auth_header: decl.authHeader } : {}),
    },
  };
}

/** One action as the manifest declares it. */
function actionBlock(a: ExtensionRecord['actions'][number]): Record<string, unknown> {
  const commercial = a.commercial ? { ...a.commercial } as Record<string, unknown> : undefined;
  if (commercial && !commercial.payMorsels) delete commercial.payMorsels;
  const hasSchema = (s: unknown) => !!s && typeof s === 'object' && Object.keys(s as object).length > 0;
  return {
    id: a.id,
    method: a.method,
    path: a.path,
    script: scriptNameOf(a.id),
    ...(hasSchema(a.inputSchema) ? { input: a.inputSchema } : {}),
    ...(hasSchema(a.outputSchema) ? { output: a.outputSchema } : {}),
    ...(a.tollMorsels !== undefined ? { tollMorsels: a.tollMorsels } : {}),
    ...(a.public === true ? { public: true } : {}),
    ...(a.decision ? { decision: a.decision } : {}),
    ...(commercial && Object.keys(commercial).length ? { commercial } : {}),
  };
}

/**
 * The manifest (YAML, block style) and the scripts map that install this extension again as it is.
 * Pass both to aimeat_extension_install with `update: true` and the next version to change it.
 */
export function manifestOfRecord(ext: ExtensionRecord): { manifest: string; scripts: Record<string, string> } {
  const config = (ext.config ?? {}) as Record<string, unknown>;
  const hostFields = Array.isArray(config[NETWORK_HOST_FIELDS_KEY]) ? config[NETWORK_HOST_FIELDS_KEY] as NetworkHostField[] : [];
  const hosts = Array.isArray(config[NETWORK_HOSTS_KEY]) ? config[NETWORK_HOSTS_KEY] as string[] : [];
  const workspace = objectAt(config, WORKSPACE_DECLARATION_KEY);
  const usesSecrets = Array.isArray(config[USES_SECRETS_KEY]) ? config[USES_SECRETS_KEY] as unknown[] : [];
  const schedules = Array.isArray(config.__schedules) ? config.__schedules as unknown[] : [];
  const limits = ext.limits;
  const provides = providesBlock(objectAt(config, AI_PROVIDER_DECLARATION_KEY) as unknown as ExtensionAiProviderDeclaration | undefined);
  const declared = configBlock(config);
  const doc: Record<string, unknown> = {
    metadata: { name: ext.name, version: ext.version, description: ext.description, author: ext.author },
    ...(ext.requiredApis?.length ? { required_apis: ext.requiredApis } : {}),
    ...(Array.isArray(config[CAPABILITY_DECLARATION_KEY]) ? { capabilities: config[CAPABILITY_DECLARATION_KEY] } : {}),
    ...(hosts.length || hostFields.length ? {
      network: {
        ...(hosts.length ? { hosts } : {}),
        ...(hostFields.length ? { host_fields: Object.fromEntries(hostFields.map(f => [f.field, f.required ? 'required' : 'optional'])) } : {}),
      },
    } : {}),
    ...(workspace ? { workspace: Object.fromEntries(Object.entries(workspace).filter(([, v]) => v === true)) } : {}),
    ...(provides ? { provides } : {}),
    ...(usesSecrets.length ? { uses_secrets: usesSecrets } : {}),
    ...(declared ? { config: declared } : {}),
    ...(schedules.length ? { schedules } : {}),
    ...(limits ? {
      limits: {
        memory_mb: limits.memoryMb, timeout_ms: limits.timeoutMs, max_api_calls: limits.maxApiCalls,
        ...(limits.fetchMaxBytes !== undefined ? { fetch_max_mb: limits.fetchMaxBytes / (1024 * 1024) } : {}),
      },
    } : {}),
    ...(ext.federation && (ext.federation.advertise || ext.federation.capabilities?.length)
      ? { federation: { advertise: !!ext.federation.advertise, capabilities: ext.federation.capabilities ?? [] } } : {}),
    ...(ext.instances?.supported ? {
      instances: { supported: true, ...(ext.instances.configSchema ? { config_per_instance: ext.instances.configSchema } : {}) },
    } : {}),
    actions: ext.actions.map(actionBlock),
  };
  const scripts = Object.fromEntries(ext.actions.map(a => [scriptNameOf(a.id), a.scriptContent]));
  return { manifest: stringifyYaml(doc, { lineWidth: 0 }), scripts };
}
