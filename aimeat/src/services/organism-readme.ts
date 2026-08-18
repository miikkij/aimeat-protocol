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
 * @structure getOrganismReadme(storage, orgId); setOrganismReadme(storage, config, orgId, readme, creatorGhii)
 * @usage import { getOrganismReadme, setOrganismReadme } from './organism-readme.js';
 * @version-history
 *   v1.0.0 — 2026-06-22 — Initial: organism README accessor (display + edit + MCP fill).
 */
import type { Storage, MemoryRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';

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

/** Read an organism's README markdown, or '' if none has been written. */
export async function getOrganismReadme(storage: Storage, orgId: string): Promise<string> {
  const rec = await findReadmeRecord(storage, orgId);
  return rec && typeof rec.value === 'string' ? rec.value : '';
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
