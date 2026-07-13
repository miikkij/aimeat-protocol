/**
 * @file src/utils/catalogue-hash.ts
 * @description Computes the SHA-256 federation catalogue hash used for change-detection between
 *   peers, hashing sorted "name:updatedAt" entries of CSMs marked federate:true (RFC v1.6 §13.11.3).
 *
 * @structure
 *   - computeCatalogueHash: filters federable CSMs, sorts entries, returns their SHA-256 digest
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { createHash } from 'node:crypto';
import type { Storage } from '../storage/interface.js';

/**
 * Compute a SHA-256 catalogue hash over all federable entries.
 * Algorithm per RFC v1.6 §13.11.3: SHA-256 of sorted entries mapped to "id:updatedAt",
 * joined by newline.
 *
 * Only includes entries from CSMs with `federate: true`.
 */
export async function computeCatalogueHash(storage: Storage): Promise<string> {
  const csms = await storage.listCsms();
  const federableCsms = csms.filter(csm => csm.federate === true);

  if (federableCsms.length === 0) {
    return createHash('sha256').update('').digest('hex');
  }

  // Build sorted entry list: "name:updatedAt" for each federable CSM
  const entries = federableCsms
    .map(csm => `${csm.name}:${csm.updatedAt}`)
    .sort();

  return createHash('sha256')
    .update(entries.join('\n'))
    .digest('hex');
}
