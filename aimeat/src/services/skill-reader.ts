/**
 * @file src/services/skill-reader.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The classification check of the skills registry (TARGET-082 V4). services/skills.ts
 *   hands every user-scope and workspace-scope record it returns (manifests, SKILL.md and other file
 *   bodies, version snapshots) through here before a caller sees it. A node-scope skill is the node's
 *   own library, stored under `system@{node}`, and passes unchanged, so the anonymous discovery of
 *   node skills reads as before.
 *
 *   Kept apart from skills.ts, which is at the 800-line limit, and typed structurally so it imports
 *   nothing from skills.ts (no import cycle).
 * @structure SkillReaderAccessor · skillReaderOf(deps, accessor) · showSkillRecords(deps, accessor, records)
 * @usage
 *   const shown = await showSkillRecords({ storage, config }, accessor, records);
 * @version-history
 *   v1.0.0 — 2026-09-29 — TARGET-082 V4. Initial.
 */
import type { Storage, MemoryRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { readerFor, readerForAgent, type ContentReader } from './classification/reader.js';
import { memoryTarget } from './classification/labels.js';

/** The accessor fields this reads. services/skills.ts SkillAccessor fits. */
export interface SkillReaderAccessor {
  ownerName: string | null;
  gaii?: string;
  /** The caller's reader. REST and MCP callers set it from their credential. */
  reader?: ContentReader;
}

/**
 * The reader behind an accessor. A caller that did not set one is read from what the accessor
 * says: nobody (anonymous) when there is no owner, an AI when the identity is an agent's, and the
 * owner otherwise.
 */
export function skillReaderOf(
  deps: { storage: Storage; config: AimeatConfig }, accessor: SkillReaderAccessor,
): ContentReader {
  if (accessor.reader) return accessor.reader;
  if (!accessor.ownerName) return readerFor(deps, null);
  if (accessor.gaii && accessor.gaii.includes('#')) return readerForAgent(deps, accessor.gaii);
  return readerFor(deps, { sub: accessor.ownerName, owner: accessor.ownerName, roles: ['owner'] });
}

/**
 * The records this accessor may see, in order. A record of the node's own library passes; every
 * other record passes the reader's show, so a record hidden from this reader is left out.
 */
export async function showSkillRecords(
  deps: { storage: Storage; config: AimeatConfig }, accessor: SkillReaderAccessor, records: readonly MemoryRecord[],
): Promise<MemoryRecord[]> {
  if (records.length === 0) return [];
  const system = `system@${deps.config.nodeId}`;
  if (records.every(r => r.ownerGaii === system)) return [...records];
  return skillReaderOf(deps, accessor).show(records, r => (r.ownerGaii === system ? null : memoryTarget(r.ownerGaii, r.key)));
}
