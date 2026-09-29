/**
 * @file services/component-content.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The current content of one installed package component, as the string its hash is
 *   taken over. Moved unchanged out of services/component-registrar.ts, which had reached the
 *   800-line limit, and re-exported from there so no importer changes.
 * @structure fetchComponentContent(storage, type, registeredAs, ownerGaii) ·
 *   componentContentTargets(storage, type, registeredAs, ownerGaii) ·
 *   fetchComponentContentForAi(storage, reader, type, registeredAs, ownerGaii, use)
 * @version-history
 *   v1.1.0 — 2026-09-29 — TARGET-082 V4: componentContentTargets (the label addresses of the memory
 *     records a memory or translation component reads) and fetchComponentContentForAi, which asks the
 *     caller's ContentReader useForAi for them before the content is returned for a model prompt.
 *     fetchComponentContent is unchanged: its other callers only hash the content.
 *   v1.0.0 — 2026-09-28 — Pure extraction from services/component-registrar.ts (max-file-lines).
 */
import type { Storage, PackageComponentType, ContentLabelTarget } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { memoryTarget } from './classification/labels.js';
import type { ContentReader } from './classification/reader.js';

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
        const keys = await manifestKeys(storage, ownerGaii, registeredAs);
        if (!keys) return null;
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

/**
 * The label addresses of the owner's memory records a component's content is made of: every key a
 * memory component's manifest names, or a translation component's record. Other component types are
 * node-level definitions or published code and carry no content label.
 */
export async function componentContentTargets(
  storage: Storage,
  type: PackageComponentType,
  registeredAs: string,
  ownerGaii: string,
): Promise<ContentLabelTarget[]> {
  if (type === 'translation') return [memoryTarget(ownerGaii, `i18n.${registeredAs}`)];
  if (type !== 'memory') return [];
  return ((await manifestKeys(storage, ownerGaii, registeredAs)) ?? [])
    .filter((k): k is string => typeof k === 'string')
    .map(k => memoryTarget(ownerGaii, k));
}

/** The memory keys a memory component's `_pkg:` manifest names, or null when there is no manifest. */
async function manifestKeys(storage: Storage, ownerGaii: string, registeredAs: string): Promise<string[] | null> {
  const manifest = await storage.getMemory(ownerGaii, `_pkg:${registeredAs}`);
  return manifest && Array.isArray(manifest.value) ? manifest.value as string[] : null;
}

/**
 * fetchComponentContent for content that goes into a model prompt. The reader's useForAi runs first
 * and throws ClassificationError (CLASSIFIED) when a record may not reach a model, so the caller
 * answers with the refusal and composes no prompt.
 */
export async function fetchComponentContentForAi(
  storage: Storage,
  reader: ContentReader,
  type: PackageComponentType,
  registeredAs: string,
  ownerGaii: string,
  use: { capability: string },
): Promise<string | null> {
  await reader.useForAi(await componentContentTargets(storage, type, registeredAs, ownerGaii), use);
  return fetchComponentContent(storage, type, registeredAs, ownerGaii);
}
