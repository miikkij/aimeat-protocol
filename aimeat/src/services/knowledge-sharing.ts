/**
 * @file src/services/knowledge-sharing.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who reads a knowledge package and each of its entries: the two writes behind PATCH
 *   /v1/knowledge/:id/sharing and PATCH /v1/knowledge/:id/entries/:entryKey/visibility, moved out of
 *   routes/knowledge/sharing.ts so an approved publish request makes a package or an entry public
 *   through the same code (services/publish-requests/apply-knowledge.ts; plan doc-mvcn6c7e4e5q, V4).
 *
 *   The callers validate first (services/audience-write.ts); these functions write. The manifest is
 *   the record the knowledge views read, and its memory tier follows the package's audience
 *   (services/knowledge-audience.ts); an entry's own record follows the entry's visibility.
 * @structure KnowledgeManifestRow · KnowledgeSharingChange · setKnowledgeSharing ·
 *   setKnowledgeEntryVisibility · findKnowledgeEntry · knowledgeEntryKey
 * @usage
 *   const { manifest } = await setKnowledgeSharing({ storage, config }, found, packageId, { audience: 'public' });
 * @version-history
 *   v1.0.0 — 2026-10-18 — Extracted from routes/knowledge/sharing.ts (plan doc-mvcn6c7e4e5q, V4).
 *   v1.0.1 — 2026-10-19 — setKnowledgeEntryVisibility sets the entry record's visibility on the
 *     record's version (record-cas.ts updateMemoryRecord) (check:atomic-writes).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, KnowledgeManifest, MemoryRecord } from '../storage/interface.js';
import { emitChange } from './event-bus.js';
import { recordPublicActivity } from './public-activity.js';
import { presentKnowledgeManifest } from './toll-morsels-names.js';
import { manifestRecordVisibility, entryRecordVisibility } from './knowledge-audience.js';
import { logger } from '../utils/logger.js';
import { updateMemoryRecord, UNCHANGED } from './record-cas.js';

interface Deps { storage: Storage; config: AimeatConfig }

/** A package's manifest record and the namespace it is stored in. */
export interface KnowledgeManifestRow { record: MemoryRecord; ownerGaii: string }

export interface KnowledgeSharingChange {
  /** owner, members, organism:<id> or public; checked by the caller. */
  audience?: string;
  catalog_listed?: unknown;
  allow_clone?: unknown;
}

/** The manifest value of a record, as an object this module may change. */
function manifestOf(record: MemoryRecord): KnowledgeManifest {
  return typeof record.value === 'string'
    ? JSON.parse(record.value as string)
    : { ...(record.value as KnowledgeManifest) };
}

async function writeManifest(storage: Storage, row: KnowledgeManifestRow, packageId: string, manifest: KnowledgeManifest): Promise<void> {
  const now = new Date().toISOString();
  await storage.setMemory({
    key: `packages/${packageId}/manifest`,
    ownerGaii: row.ownerGaii,
    value: manifest,
    visibility: manifestRecordVisibility(manifest),
    tags: row.record.tags || ['knowledge-package'],
    ttlHours: null,
    version: (row.record.version || 0) + 1,
    createdAt: row.record.createdAt || now,
    updatedAt: now,
  });
}

/** Change the package's sharing: its audience, its catalogue listing, whether it may be cloned. */
export async function setKnowledgeSharing(
  deps: Deps, row: KnowledgeManifestRow, packageId: string, change: KnowledgeSharingChange,
): Promise<{ manifest: KnowledgeManifest }> {
  const { storage, config } = deps;
  const { audience, catalog_listed, allow_clone } = change;
  const manifest = manifestOf(row.record);
  // A manifest stored before 4.0.0 carries sharing.morsel_price; the write-back stores it as
  // sharing.toll_morsels, the name the response and every later read use.
  manifest.sharing = manifest.sharing
    ? presentKnowledgeManifest(manifest).sharing
    : { catalog_listed: false, allow_clone: false, toll_morsels: 0 };

  if (audience !== undefined) {
    manifest.sharing.catalog_listed = audience === 'public';
    manifest.sharing.audience = audience as NonNullable<KnowledgeManifest['sharing']['audience']>;
  } else if (catalog_listed !== undefined) {
    manifest.sharing.catalog_listed = !!catalog_listed;
    // Listing makes it public; unlisting a public package leaves it with its author.
    if (catalog_listed) manifest.sharing.audience = 'public';
    else if (manifest.sharing.audience === 'public') manifest.sharing.audience = 'owner';
  }
  if (allow_clone !== undefined) manifest.sharing.allow_clone = !!allow_clone;
  // If catalog_listed enabled, ensure allow_clone is also enabled
  if (manifest.sharing.catalog_listed && !manifest.sharing.allow_clone && allow_clone === undefined) {
    manifest.sharing.allow_clone = true;
  }
  manifest.updated = new Date().toISOString();
  await writeManifest(storage, row, packageId, manifest);

  emitChange('knowledge');
  // Public landing feed — only on the private→public catalogue edge (don't re-announce).
  if (manifest.sharing.catalog_listed && row.record.visibility !== 'public') {
    void recordPublicActivity(storage, config, {
      category: 'agents',
      actor: (manifest.author as string) || row.ownerGaii,
      summary: `Knowledge package "${manifest.name}" published`,
      detail: manifest.synthesis?.description || '',
      link: `/v1/knowledge/${packageId}`,
    }).catch(err => { logger.warn('actor: feed is best-effort', { error: String(err) }); });
  }
  return { manifest };
}

/** The entry of a manifest by its full key or its short name, or undefined. */
export function findKnowledgeEntry(manifest: KnowledgeManifest, entryKey: string) {
  return (manifest.entries || []).find((e) => e.key === entryKey || e.key.endsWith('/' + entryKey));
}

/** The memory key an entry's record is stored under. */
export function knowledgeEntryKey(packageId: string, key: string): string {
  return key.startsWith('packages/') ? key : `packages/${packageId}/${key}`;
}

/**
 * Change one entry's visibility: its line in the manifest and its own record. Answers false when the
 * manifest has no such entry, and writes nothing then.
 */
export async function setKnowledgeEntryVisibility(
  deps: Deps, row: KnowledgeManifestRow, packageId: string, entryKey: string, visibility: string, groupId?: string,
): Promise<boolean> {
  const { storage } = deps;
  const manifest = manifestOf(row.record);
  const entry = findKnowledgeEntry(manifest, entryKey);
  if (!entry) return false;

  entry.visibility = visibility as typeof entry.visibility;
  manifest.updated = new Date().toISOString();
  await writeManifest(storage, row, packageId, manifest);

  // Also update the individual entry's memory record visibility, on the record's version
  // (record-cas.ts), so an edit of the entry that lands meanwhile keeps its text.
  await updateMemoryRecord(storage, row.ownerGaii, knowledgeEntryKey(packageId, entry.key), (entryRecord) => (entryRecord
    ? { visibility: entryRecordVisibility(visibility), groupId: visibility === 'group' ? groupId : undefined }
    : UNCHANGED));
  emitChange('knowledge');
  return true;
}
