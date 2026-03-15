/**
 * @file ghii-resolver.ts
 * @description Shared utility to resolve an owner's GHII (Global Human Identity Identifier)
 *   from the storage identity system, falling back to the provided GAII.
 * @usage
 *   import { resolveGhii } from '../utils/ghii-resolver.js';
 *   const ghii = await resolveGhii(storage, ownerName, req.auth!.sub);
 * @version-history
 *   v1.0.0 — 2026-03-15 — extracted from packages.ts, instances.ts, templates.ts
 */

import type { Storage } from '../storage/interface.js';

/** Resolve owner's GHII, falling back to agent GAII */
export async function resolveGhii(storage: Storage, ownerName: string, fallback: string): Promise<string> {
  try {
    const ghiiRecord = await storage.getGHIIByOwner(ownerName);
    return ghiiRecord?.ghii ?? fallback;
  } catch {
    return fallback;
  }
}
