/**
 * @file component-registrar.ts
 * @description Service for registering, deleting, and fetching package components
 *   via native AIMEAT storage APIs. Adapts PackageComponent content strings into
 *   the format each storage repository expects. Used by the install, migration,
 *   and uninstall flows in instances.ts.
 * @structure
 *   - registerComponent() — register a single component in its native storage
 *   - deleteComponent() — remove a component from its native storage
 *   - fetchComponentContent() — retrieve current content for hash comparison
 *   - computeHash() — SHA-256 hash utility
 *   - ComponentRegistrationResult — result type
 * @usage
 *   import { registerComponent, deleteComponent, fetchComponentContent, computeHash } from '../services/component-registrar.js';
 * @version-history
 *   v1.3.0 — 2026-08-10 — An extension component goes through buildExtensionRecordFromManifest, the
 *     same builder POST /v1/extensions uses. This file had its own, lenient one, so a component
 *     registered here skipped every gate the front door applies — and the content is not always a
 *     published package's: apply-migration takes it from the request body. Adds
 *     validateComponentContent() so a caller can refuse bad content BEFORE deleting the old.
 *   v1.0.0 — 2026-03-15 — initial implementation
 *   v1.1.0 — 2026-03-16 — fix memory component key management: use manifest key
 *     instead of prefix-based lookup for delete/fetch; store keys as-is without
 *     registeredAs prefix
 *   v1.2.0 — 2026-05-05 — preserve lib component fields (filename, exports,
 *     api_surface) in cortex registration; pass package metadata to app manifests
 */

import { createHash } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import { buildExtensionRecordFromManifest, EXT_NAME_PATTERN } from '../routes/extensions/manifest.js';
import YAML from 'yaml';
import type { Storage, PackageComponentType, CortexComponent } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

// ── Types ────────────────────────────────────────────────────────────

export interface ComponentRegistrationResult {
  success: boolean;
  componentId: string;
  registeredAs: string;
  error?: string;
  /** Short name from the source manifest (only set for cortex + extension). */
  originalShortName?: string;
}

export interface ComponentRegistrationInput {
  /** Node config: the extension builder needs it for limit ceilings and currency validation. */
  config: AimeatConfig;
  componentId: string;
  type: PackageComponentType;
  registeredAs: string;
  content: string;
  label: string;
  owner: string;
  ownerGaii: string;
  packageName: string;
  packageCategory?: string;
  packageTags?: string[];
  packageDescription?: string;
  /**
   * URL rewrites applied to app HTML content at install time. Built by the
   * installer from already-registered cortex/extension components in the same
   * package. Without this, app HTML containing
   *   loadScript('/v1/cortex/comicland-v2/libs/comicland-v2.js')
   * would 404 once the cortex is registered as
   *   comicland-v2-alice-06c4c5af-cortex-comicland-v2
   * (the package-install scheme).
   */
  urlRewrites?: {
    /** Map<originalShortName, registeredAs> for cortex components. */
    cortexNames?: Map<string, string>;
    /** Map<originalShortName, registeredAs> for extension components. */
    extensionNames?: Map<string, string>;
  };
}

// ── Hash utility ─────────────────────────────────────────────────────

/** Compute SHA-256 hash of content string */
export function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

// ── URL rewriting for package install ────────────────────────────────

/**
 * Rewrite hardcoded short-name references in a content string so they point
 * at the per-instance registered component names. Used for both app HTML and
 * cortex lib JS at install time.
 *
 * Patterns covered:
 *   /v1/cortex/<shortName>/...   → /v1/cortex/<registeredAs>/...
 *   /v1/ext/<shortName>/...      → /v1/ext/<registeredAs>/...
 *   "ext:<shortName>" (literal)  → "ext:<registeredAs>"  (memory namespace strings)
 *   ext%3A<shortName>            → ext%3A<registeredAs>  (URL-encoded variant)
 */
function rewriteComponentRefs(
  content: string,
  cortexMap: Map<string, string> | undefined,
  extMap: Map<string, string> | undefined,
): string {
  if (!content) return content;
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let out = content;
  if (cortexMap) {
    for (const [shortName, regAs] of cortexMap) {
      if (!shortName || shortName === regAs) continue;
      const esc = escapeRe(shortName);
      out = out.replace(
        new RegExp('(\\/v1\\/cortex\\/)' + esc + '(?=[\\/?#"\\\'\\s]|$)', 'g'),
        '$1' + regAs,
      );
    }
  }
  if (extMap) {
    for (const [shortName, regAs] of extMap) {
      if (!shortName || shortName === regAs) continue;
      const esc = escapeRe(shortName);
      // /v1/ext/<name>(/ or terminator)
      out = out.replace(
        new RegExp('(\\/v1\\/ext\\/)' + esc + '(?=[\\/?#"\\\'\\s]|$)', 'g'),
        '$1' + regAs,
      );
      // ext:<name> in memory-namespace strings — common in cortex libs:
      //   AIMEAT.data.getPublic('ext:comicland-v2', 'config.app')
      // Terminator is whatever closes the string / next segment.
      out = out.replace(
        new RegExp('(ext:)' + esc + '(?=[/"\\\'\\s,\\]}]|$)', 'g'),
        '$1' + regAs,
      );
      // URL-encoded variant for any place that already escapes the colon.
      out = out.replace(
        new RegExp('(ext%3A)' + esc + '(?=[%/"\\\'\\s,\\]}]|$)', 'gi'),
        '$1' + regAs,
      );
    }
  }
  return out;
}

// ── Pre-flight validation ────────────────────────────────────────────

/**
 * Can this content be registered as this component type? Answers WITHOUT touching storage.
 *
 * The migration flow deletes the existing component and then registers the new one, which was safe
 * only while registration accepted anything. It does not any more: an extension component now goes
 * through the same manifest builder as POST /v1/extensions, so a caller-supplied `content` that the
 * builder refuses would leave the old component deleted and nothing in its place. Callers check
 * this first, before they delete.
 *
 * Only `extension` has anything to check today. Every other type returns ok, so a caller can run
 * this unconditionally.
 */
export function validateComponentContent(
  type: PackageComponentType,
  content: string,
  registeredAs: string,
  config: AimeatConfig,
  owner: string,
): { ok: true } | { ok: false; error: string } {
  if (type !== 'extension') return { ok: true };

  let parsed: { manifest?: string; scripts?: Record<string, string> };
  try { parsed = JSON.parse(content); }
  // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: the input is not of that shape
  catch { parsed = { manifest: content }; }

  const built = buildExtensionRecordFromManifest(
    parsed.manifest ?? '', parsed.scripts ?? {}, config, owner, new Date().toISOString(), false,
  );
  if (!built.ok) return { ok: false, error: `${built.code}: ${built.message}` };
  if (!EXT_NAME_PATTERN.test(registeredAs)) {
    return { ok: false, error: `INVALID_NAME: "${registeredAs}" is not a valid extension name` };
  }
  return { ok: true };
}

// ── Register component ───────────────────────────────────────────────

/** Register a single component in its native storage repository */
export async function registerComponent(
  storage: Storage,
  input: ComponentRegistrationInput,
): Promise<ComponentRegistrationResult> {
  const { config, componentId, type, registeredAs, content, label, owner, ownerGaii, packageName } = input;
  const now = new Date().toISOString();
  // Set inside cortex / extension cases below; surfaced in the result so the
  // installer can build a "originalShortName → registeredAs" map for app rewrites.
  let originalShortName: string | undefined;

  try {
    switch (type) {
      case 'csm': {
        let definition: Record<string, unknown>;
        try {
          definition = YAML.parse(content) as Record<string, unknown>;
        } catch (err) {
          logger.warn('component-registrar: suppressed failure, continuing', { error: String(err) });
          // Content might be JSON
          try { definition = JSON.parse(content) as Record<string, unknown>; }
          // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: the input is not of that shape
          catch { definition = { raw: content }; }
        }
        const serviceObj = definition.service as Record<string, unknown> | undefined;
        const serviceType = (serviceObj?.type as string) ?? 'other';
        await storage.createCsm({
          name: registeredAs,
          definition,
          jsonSchemaKey: `csm.${registeredAs}`,
          serviceType,
          registeredBy: owner,
          registeredAt: now,
          updatedAt: now,
        });
        break;
      }

      case 'extension': {
        // Content: JSON { manifest: "YAML", scripts: { "name": "code" } } or raw string
        let parsed: { manifest?: string; scripts?: Record<string, string> };
        try { parsed = JSON.parse(content); }
        // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: the input is not of that shape
        catch { parsed = { manifest: content }; }

        // ONE builder, the same one POST /v1/extensions uses. This branch used to parse the manifest
        // itself and write `config: meta.config` straight through — a second, lenient implementation
        // of install that applied none of the gates the first one has. That mattered because the
        // content does not always come from a published package: routes/instances/migration.ts takes
        // it from the request body under `custom` and `replace`, so an ordinary owner could register
        // an extension with a config of their choosing, active, past everything the front door
        // checks. Whatever the manifest builder refuses, this refuses.
        //
        // installerIsOperator is false here on purpose. A package's extension component has no
        // business granting itself emailPolicy, and none of the seeded packages tries to.
        const built = buildExtensionRecordFromManifest(
          parsed.manifest ?? '', parsed.scripts ?? {}, config, owner, now, false,
        );
        if (!built.ok) {
          return { success: false, componentId, registeredAs, error: `${built.code}: ${built.message}` };
        }
        originalShortName = built.record.name;

        // The record is stored under the package's generated name, not the manifest's own, and the
        // stored name IS the memory address (`ext:{name}` / `ext:{name}.{instanceId}`). The builder
        // validated metadata.name; this is the one that ends up in the namespace, so it is checked
        // with the same pattern rather than trusted for being generated.
        if (!EXT_NAME_PATTERN.test(registeredAs)) {
          return {
            success: false, componentId, registeredAs,
            error: `INVALID_NAME: "${registeredAs}" is not a valid extension name (lowercase letters, `
              + 'digits and hyphens, 3 to 128 characters). The name becomes this extension\'s memory address.',
          };
        }

        await storage.createExtension({
          ...built.record,
          name: registeredAs,
          description: built.record.description || label,
          // A package component is live as soon as its package is installed; there is no separate
          // activate step in that flow.
          status: 'active',
        });
        break;
      }

      case 'cortex': {
        // Content: JSON { manifest: "YAML", libs: { "file.js": "code" } } or raw string
        let parsed: { manifest?: string; libs?: Record<string, string> };
        try { parsed = JSON.parse(content); }
        // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: the input is not of that shape
        catch { parsed = { manifest: content }; }

        const manifestStr = parsed.manifest ?? content;
        const libs = parsed.libs ?? {};

        let meta: Record<string, unknown> = {};
        try { meta = (YAML.parse(manifestStr) as Record<string, unknown>) ?? {}; }
        catch (err) { logger.warn('config: use defaults', { error: String(err) }); }

        const metadata = (meta.metadata ?? meta) as Record<string, unknown>;
        originalShortName = (metadata.name as string) || undefined;
        const componentsRaw = (meta.components ?? []) as Array<Record<string, unknown>>;

        const cortexComponents = componentsRaw.map(c => {
          const comp: Record<string, unknown> = {
            type: (c.type as string) ?? 'lib',
            name: (c.name as string) ?? '',
            content: typeof c.content === 'string' ? c.content : JSON.stringify(c.content ?? ''),
          };
          if (c.filename) comp.filename = c.filename as string;
          if (c.exports) comp.exports = c.exports;
          if (c.api_surface) comp.api_surface = c.api_surface as string;
          if (c.key_pattern) comp.key_pattern = c.key_pattern as string;
          if (c.apply_to) comp.apply_to = c.apply_to as string;
          return comp;
        });

        await storage.createCortexExtension({
          name: registeredAs,
          namespace: owner,
          shortName: (metadata.name as string) ?? label,
          apiVersion: (metadata.api_version as string) ?? 'v1',
          version: (metadata.version as string) ?? '1.0.0',
          description: (metadata.description as string) ?? label,
          author: (metadata.author as string) ?? owner,
          tags: (metadata.tags as string[]) ?? [],
          labels: {},
          status: 'active',
          visibility: 'private',
          activatedAt: now,
          installedAt: now,
          installedBy: owner,
          manifest: manifestStr,
          components: cortexComponents as unknown as CortexComponent[],
          activationArtifacts: {
            schemaKeys: [],
            promptKeys: [],
            actionIds: [],
            boardIds: [],
            seedDataKeys: [],
            ontologyKeys: [],
            libFiles: Object.keys(libs),
          },
        });

        // Store lib files — rewrite extension and cortex short-name
        // references so they hit the per-instance registered names. Without
        // this, comicland-v2.js's hardcoded
        //   session.fetch('/v1/ext/comicland-v2/users', ...)
        //   AIMEAT.data.getPublic('ext:comicland-v2', 'config.app')
        // would 404 once the extension is registered as
        //   comicland-v2-alice-cade9406-extension-comicland-v2.
        for (const [libName, libContent] of Object.entries(libs)) {
          const rewrittenLib = rewriteComponentRefs(
            libContent,
            input.urlRewrites?.cortexNames,
            input.urlRewrites?.extensionNames,
          );
          await storage.setCortexLibFile(registeredAs, libName, rewrittenLib);
        }

        // Auto-activate: process components that need native registration
        for (const comp of cortexComponents) {
          const compType = comp.type as string;
          if (compType === 'schema' && comp.key_pattern) {
            try {
              await storage.setSchema({
                keyPattern: comp.key_pattern as string,
                applyTo: ((comp.apply_to as string) ?? 'prefix') as 'exact' | 'prefix',
                schemaJson: (comp.schema ?? comp.content ?? {}) as Record<string, unknown>,
                schemaMode: 'strict',
                lockedBy: ownerGaii,
                setAt: now,
                updatedAt: now,
              });
            // eslint-disable-next-line aimeat/no-silent-catch -- schema may already exist
            } catch { /* schema may already exist */ }
          } else if (compType === 'prompt' && comp.name) {
            const promptKey = `__cortex__/${registeredAs}/prompts/${comp.name}`;
            await storage.setMemory({
              key: promptKey,
              ownerGaii,
              value: { name: comp.name, content: comp.content, variables: comp.variables },
              visibility: 'public',
              tags: ['cortex', 'prompt', registeredAs],
              ttlHours: null,
              version: 1,
              createdAt: now,
              updatedAt: now,
            });
          }
        }
        break;
      }

      case 'app': {
        // Rewrite hardcoded cortex/extension references in the app HTML
        // (loadScript URLs, fetch URLs, AND ext:<name> memory namespaces) so
        // they point at the per-instance registered component names.
        const rewritten = rewriteComponentRefs(
          content,
          input.urlRewrites?.cortexNames,
          input.urlRewrites?.extensionNames,
        );
        await storage.createApp({
          ownerGaii,
          ownerName: owner,
          filename: registeredAs,
          versionNumber: 1,
          manifest: {
            name: label,
            description: input.packageDescription
              ? `${label} -- ${input.packageDescription}`
              : `Installed from package: ${packageName}`,
            version: '1.0.0',
            category: input.packageCategory || 'utility',
            tags: [...(input.packageTags || []), 'package-installed'],
            authorDisplay: owner,
            usesCortex: [],
          },
          mimeType: 'text/html',
          size: Buffer.byteLength(rewritten, 'utf-8'),
          data: Buffer.from(rewritten, 'utf-8'),
          createdAt: now,
        });
        break;
      }

      case 'msm': {
        let definition: Record<string, unknown>;
        try { definition = YAML.parse(content) as Record<string, unknown>; }
        catch (err) {
          logger.warn('component-registrar: suppressed failure, continuing', { error: String(err) });
          try { definition = JSON.parse(content) as Record<string, unknown>; }
          // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: the input is not of that shape
          catch { definition = { raw: content }; }
        }
        const auth = definition.auth as Record<string, unknown> | undefined;
        const actionsArr = (definition.actions ?? []) as unknown[];
        await storage.createMsm({
          name: registeredAs,
          definition,
          category: (definition.category as string) ?? 'utility',
          authType: (auth?.type as string) ?? 'none',
          actionsCount: actionsArr.length,
          registeredBy: owner,
          registeredAt: now,
          updatedAt: now,
        });
        break;
      }

      case 'memory': {
        // Content: JSON { entries: [{ key, value, visibility?, tags? }] } or simple object
        // When entries have explicit keys, use them as-is (no prefix).
        // Fallback: store entire content under registeredAs key.
        let parsed: { entries?: Array<{ key: string; value: unknown; visibility?: string; tags?: string[] }> };
        try { parsed = JSON.parse(content); }
        // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: the input is not of that shape
        catch { parsed = { entries: [{ key: registeredAs, value: content }] }; }

        const entries = parsed.entries ?? [{ key: registeredAs, value: parsed }];
        const storedKeys: string[] = [];
        for (const entry of entries) {
          // Use entry key as-is — the package author controls the final memory key names
          const memKey = entry.key;
          storedKeys.push(memKey);
          await storage.setMemory({
            key: memKey,
            ownerGaii,
            value: entry.value,
            visibility: (entry.visibility as 'private' | 'owner' | 'public') ?? 'private',
            tags: entry.tags ?? ['package-installed'],
            ttlHours: null,
            version: 1,
            createdAt: now,
            updatedAt: now,
          });
        }
        // Store a manifest key so delete/fetch can find these entries later
        await storage.setMemory({
          key: `_pkg:${registeredAs}`,
          ownerGaii,
          value: storedKeys,
          visibility: 'private',
          tags: ['package-manifest'],
          ttlHours: null,
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
        break;
      }

      case 'translation': {
        // Content: JSON { "en": { ... }, "fi": { ... } }
        const memKey = `i18n.${registeredAs}`;
        let value: unknown;
        try { value = JSON.parse(content); }
        // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: the input is not of that shape
        catch { value = { raw: content }; }
        await storage.setMemory({
          key: memKey,
          ownerGaii,
          value,
          visibility: 'public',
          tags: ['translation', 'package-installed'],
          ttlHours: null,
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
        break;
      }

      default:
        return { success: false, componentId, registeredAs, error: `Unknown component type: ${type}` };
    }

    return { success: true, componentId, registeredAs, originalShortName };
  } catch (err) {
    return { success: false, componentId, registeredAs, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Delete component ─────────────────────────────────────────────────

/** Delete a previously registered component from its native storage */
export async function deleteComponent(
  storage: Storage,
  type: PackageComponentType,
  registeredAs: string,
  ownerGaii: string,
): Promise<boolean> {
  try {
    switch (type) {
      case 'csm':
        return await storage.deleteCsm(registeredAs);
      case 'extension':
        return await storage.deleteExtension(registeredAs);
      case 'cortex': {
        const ctx = await storage.getCortexExtension(registeredAs);
        if (ctx) {
          for (const libFile of ctx.activationArtifacts.libFiles) {
            await storage.deleteCortexLibFile(registeredAs, libFile);
          }
          for (const key of ctx.activationArtifacts.seedDataKeys) {
            await storage.deleteMemory(ctx.installedBy, key);
          }
          for (const key of ctx.activationArtifacts.promptKeys) {
            await storage.deleteMemory(ctx.installedBy, key);
          }
          for (const key of ctx.activationArtifacts.ontologyKeys) {
            await storage.deleteMemory(ctx.installedBy, key);
          }
        }
        return await storage.deleteCortexExtension(registeredAs);
      }
      case 'app':
        return await storage.deleteApp(ownerGaii, registeredAs);
      case 'msm':
        return await storage.deleteMsm(registeredAs);
      case 'memory': {
        // Read the manifest key to find which memory keys belong to this component
        const manifest = await storage.getMemory(ownerGaii, `_pkg:${registeredAs}`);
        if (manifest && Array.isArray(manifest.value)) {
          for (const key of manifest.value as string[]) {
            await storage.deleteMemory(ownerGaii, key);
          }
        }
        // Delete the manifest key itself
        await storage.deleteMemory(ownerGaii, `_pkg:${registeredAs}`);
        return true;
      }
      case 'translation':
        return await storage.deleteMemory(ownerGaii, `i18n.${registeredAs}`);
      default:
        return false;
    }
  } catch (err) {
    logger.warn('component-registrar: suppressed failure, continuing', { error: String(err) });
    return false;
  }
}

// ── Fetch component content ──────────────────────────────────────────

/** Fetch current content string for a component (for hash comparison) */
export async function fetchComponentContent(
  storage: Storage,
  type: PackageComponentType,
  registeredAs: string,
  ownerGaii: string,
): Promise<string | null> {
  try {
    switch (type) {
      case 'csm': {
        const csm = await storage.getCsm(registeredAs);
        if (!csm) return null;
        return JSON.stringify(csm.definition);
      }
      case 'extension': {
        const ext = await storage.getExtension(registeredAs);
        if (!ext) return null;
        return JSON.stringify({
          name: ext.name,
          version: ext.version,
          actions: ext.actions.map(a => ({ id: a.id, scriptContent: a.scriptContent })),
        });
      }
      case 'cortex': {
        const ctx = await storage.getCortexExtension(registeredAs);
        if (!ctx) return null;
        return ctx.manifest;
      }
      case 'app': {
        const app = await storage.getApp(ownerGaii, registeredAs);
        if (!app) return null;
        return app.data.toString('utf-8');
      }
      case 'msm': {
        const msm = await storage.getMsm(registeredAs);
        if (!msm) return null;
        return JSON.stringify(msm.definition);
      }
      case 'memory': {
        // Read the manifest key to find which memory keys belong to this component
        const manifest = await storage.getMemory(ownerGaii, `_pkg:${registeredAs}`);
        if (!manifest || !Array.isArray(manifest.value)) return null;
        const keys = manifest.value as string[];
        const entries: Array<{ key: string; value: unknown }> = [];
        for (const key of keys) {
          const mem = await storage.getMemory(ownerGaii, key);
          if (mem) entries.push({ key: mem.key, value: mem.value });
        }
        if (entries.length === 0) return null;
        const sorted = entries.sort((a, b) => a.key.localeCompare(b.key));
        return JSON.stringify(sorted);
      }
      case 'translation': {
        const mem = await storage.getMemory(ownerGaii, `i18n.${registeredAs}`);
        if (!mem) return null;
        return JSON.stringify(mem.value);
      }
      default:
        return null;
    }
  } catch (err) {
    logger.warn('component-registrar: suppressed failure, continuing', { error: String(err) });
    return null;
  }
}
