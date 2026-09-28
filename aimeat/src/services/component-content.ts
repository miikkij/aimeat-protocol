/**
 * @file services/component-content.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The current content of one installed package component, as the string its hash is
 *   taken over. Moved unchanged out of services/component-registrar.ts, which had reached the
 *   800-line limit, and re-exported from there so no importer changes.
 * @structure fetchComponentContent(storage, type, registeredAs, ownerGaii)
 * @version-history
 *   v1.0.0 — 2026-09-28 — Pure extraction from services/component-registrar.ts (max-file-lines).
 */
import type { Storage, PackageComponentType } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

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
