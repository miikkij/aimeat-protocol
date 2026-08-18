/**
 * @file app-tool-names.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The sellable tool names of one published app, for the agent-discovery block injected
 *   into its served HTML. Cached for a minute: an app page is a hot path and the manifest changes
 *   only when its owner republishes it, so the read must not ride on every view. A missing or
 *   malformed manifest yields an empty list — the discovery block still names the app id and the
 *   endpoints, which is the part that was actually missing.
 * @structure appToolNames(storage, ownerGhii, filename)
 * @usage const tools = await appToolNames(storage, `${owner}@${config.nodeId}`, filename);
 * @version-history
 *   v1.0.0 — 2026-07-27 — Initial, for the app-origin discovery block.
 */
import type { Storage } from '../storage/interface.js';
import { appToolsKey } from '../models/app-tool-schemas.js';
import { cached, TTL } from './cache.js';
import { logger } from '../utils/logger.js';

export async function appToolNames(storage: Storage, ownerGhii: string, filename: string): Promise<string[]> {
  try {
    return await cached(`apptoolnames:${ownerGhii}:${filename}`, TTL.dashboard, async () => {
      const rec = await storage.getMemory(ownerGhii, appToolsKey(filename));
      if (!rec || rec.visibility !== 'public') return [];
      const doc = rec.value as { tools?: Array<{ name?: unknown }> } | undefined;
      return (doc?.tools ?? [])
        .map(t => (typeof t?.name === 'string' ? t.name : null))
        .filter((n): n is string => !!n)
        .slice(0, 24);
    }, [`app:${ownerGhii}:${filename}`]);
  } catch (err) {
    // The names are a courtesy inside a page that is already being served; a storage hiccup must
    // never cost the visitor the app itself. Say so rather than letting "no tools" look like truth.
    logger.warn('app tool names unavailable for the discovery block', { ownerGhii, filename, error: String(err) });
    return [];
  }
}
