/**
 * @file organism-readme.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Read/write the organism-level free-form README — a markdown description (mermaid
 *   allowed) that explains what the organism is about, shown at the top of the organism home. Stored
 *   as a single creator-owned memory key `organism.{id}.meta.readme`, parallel to the per-workspace
 *   readme (`organism.{id}.w.{ws}.meta.readme`). The short `OrganismRecord.description` stays the
 *   tagline; this README is the long-form body. The backend stays protocol-only: this is just a
 *   typed accessor over the generic memory API, shared by the REST routes and the MCP update tool.
 * @structure showOrganismReadme(storage, reader, orgId); getOrganismReadme(storage, orgId);
 *   setOrganismReadme(storage, config, orgId, readme, creatorGhii)
 * @usage import { showOrganismReadme, setOrganismReadme } from './organism-readme.js';
 * @version-history
 *   v1.1.0 — 2026-09-29 — TARGET-082 V4: showOrganismReadme, the README as a caller may see it (the
 *     record passes the caller's ContentReader; one it may not see reads as ''). getOrganismReadme
 *     stays for the node's own echo after an update.
 *   v1.0.0 — 2026-06-22 — Initial: organism README accessor (display + edit + MCP fill).
 */
import type { Storage, MemoryRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { memoryTarget } from './classification/labels.js';
import type { ContentReader } from './classification/reader.js';

/** The memory key holding an organism's README. */
export function organismReadmeKey(orgId: string): string {
  return `organism.${orgId}.meta.readme`;
}

/** Find the existing README record (memory is keyed by (ownerGaii, key); we don't know the owner up
 *  front, so scan the exact key across owners and take the match). */
async function findReadmeRecord(storage: Storage, orgId: string): Promise<MemoryRecord | null> {
  const key = organismReadmeKey(orgId);
  const { items } = await storage.listAllMemory({ prefix: key, limit: 5 });
  return items.find(r => r.key === key) ?? null;
}

/**
 * Read an organism's README markdown as stored, or '' if none has been written. For the node's own
 * use; what goes to a caller reads through showOrganismReadme.
 */
export async function getOrganismReadme(storage: Storage, orgId: string): Promise<string> {
  const rec = await findReadmeRecord(storage, orgId);
  return rec && typeof rec.value === 'string' ? rec.value : '';
}

/** The README markdown this reader may see, or '' when there is none or it may not see it. */
export async function showOrganismReadme(storage: Storage, reader: ContentReader, orgId: string): Promise<string> {
  const rec = await findReadmeRecord(storage, orgId);
  const [shown] = rec ? await reader.show([rec], r => memoryTarget(r.ownerGaii, r.key)) : [];
  return shown && typeof shown.value === 'string' ? shown.value : '';
}

/** Write/update an organism's README. Keeps it owned by the organism's creator (full GHII) so it
 *  doesn't fork into a duplicate under a second identity; reuses the existing record's owner on update.
 *  `creatorGhii` is the bare owner name (the convention on OrganismRecord) — normalized to a full GHII. */
export async function setOrganismReadme(
  storage: Storage,
  config: AimeatConfig,
  orgId: string,
  readme: string,
  creatorGhii: string,
): Promise<void> {
  const key = organismReadmeKey(orgId);
  const prev = await findReadmeRecord(storage, orgId);
  const now = new Date().toISOString();
  const ownerGaii = prev?.ownerGaii ?? (creatorGhii.includes('@') ? creatorGhii : `${creatorGhii}@${config.nodeId}`);
  await storage.setMemory({
    key,
    ownerGaii,
    value: readme,
    visibility: prev?.visibility ?? 'private',
    tags: prev?.tags ?? [],
    ttlHours: prev?.ttlHours ?? null,
    version: (prev?.version ?? 0) + 1,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  });
}
